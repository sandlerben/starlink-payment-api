# starlink-payment-api

A Next.js 16 app that checks whether a given flight has Starlink WiFi, gated behind a micropayment via Stripe MPP. Built from a v0 scaffold at https://v0.app/chat/starlink-payment-api-fzMEtvTvJUX.

## Stack

- **Framework**: Next.js 16 (App Router)
- **Payments**: `mppx` — Stripe for card/link/crypto, Tempo for direct on-chain
- **Data**: United Airlines fleet scraped to `data/fleet.json`; real-time flight→aircraft via FlightAware AeroAPI
- **UI**: shadcn/ui + Radix + Tailwind v4
- **Package manager**: pnpm

## Key files

- `app/api/flight-starlink/` — the payment-gated API route (POST)
- `lib/mpp.ts` — mppx charge composition; use `mppx.compose()` for per-method pricing
- `lib/stripe.ts` — Stripe client (needs API version `2026-03-04.preview` for crypto)
- `lib/flightaware.ts` — FlightAware AeroAPI integration (flight number → tail number)
- `lib/fleet.ts` — fleet lookup from `data/fleet.json`
- `lib/crypto-payments.ts` — Stripe PaymentIntent crypto deposit flow
- `scripts/scrape-fleet.ts` — scraper to refresh fleet data quarterly
- `FRICTION_LOG.md` — detailed mppx/Stripe pain points from building this

## Environment variables

These are already configured on the `v0-starlink-payment-api` Vercel project — do not redeploy to a new project or they'll be missing.

```
FLIGHTAWARE_API_KEY
STRIPE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
```

## Vercel deployment

The project is **already linked** to the correct Vercel project (`v0-starlink-payment-api`, not a new one):
- `.vercel/project.json` → `prj_oPcUSzKP7to0e9AnS3z3KJb2OW72`
- Production URL: **https://v0-starlink-payment-api.vercel.app**

```bash
# Preview deploy
vercel

# Production deploy (use this one — env vars are on this project)
vercel --prod
```

**Important:** Do NOT run `vercel` without `--prod` and then assume production is updated. Always use `vercel --prod` and verify against `v0-starlink-payment-api.vercel.app` (not `starlink-payment-api.vercel.app` — that's a stale separate deployment from a failed session).

## Payment method commands (for testing)

### Card via Stripe Link CLI

```bash
# Install (needs --min-release-age override due to ~/.npmrc policy)
npm i -g @stripe/link-cli --min-release-age=0
# or from tarball:
npm i -g https://registry.npmjs.org/@stripe/link-cli/-/link-cli-0.5.0.tgz

# Authenticate (opens browser)
link-cli auth login

# Create a spend request — must use the network ID from the 402 challenge
# Decode the 402 WWW-Authenticate header first:
link-cli mpp decode <challenge-from-www-authenticate>

# Then create a spend request with the extracted network_id:
link-cli spend-request create \
  --amount 50 \
  --credential-type shared_payment_token \
  --network-id <network_id_from_decode> \
  --payment-method-id <pm_id_from: link-cli payment-method list>

# Pay once approved:
link-cli mpp pay <url> \
  --method POST \
  --data '{"flightNumber":"UA123"}' \
  --spend-request-id <srq_...>
```

**Known gotchas with link-cli:**
- Spend request approval requires a passkey in the Link app (you added one during testing)
- The `--network-id` must match the merchant's registered Stripe Business Network ID from the decoded 402 — passing `"internal"` or guessing will fail with "could not retrieve merchant information"
- The server's 402 must return a real network ID (not `"internal"`) — this was a bug that was fixed; the correct ID is `profile_61UfVbHEBmn7ZqLikA6UfVbH2OSQQ9DwyyzrkHRRoO9A` (Merchant: "Starlink API")

### Crypto via mppx

```bash
npx mppx account create    # creates a local wallet
npx mppx account fund      # funds from testnet faucet (often drained — may fail)
npx mppx https://v0-starlink-payment-api.vercel.app/api/flight-starlink \
  --method POST \
  --data '{"flightNumber":"UA123"}'
```

**Known issue:** The mppx testnet faucet liquidity pool is frequently drained. Mainnet requires real funds. Crypto path may be unreliable for testing.

## Pricing notes

- Stripe minimum charge: **$0.50** (card/link)
- Crypto (Tempo/on-chain): can be as low as $0.01
- Use `mppx.compose()` for per-method pricing — it's in the type definitions but not documented on mpp.dev

```ts
const result = await mppx.compose(
  ['tempo/charge', { amount: '0.01', description }],
  ['stripe/charge', { amount: '0.50', currency: 'usd', decimals: 2, description }],
)(request)
```

## MPP/Stripe crypto architecture distinction

- **Stripe crypto** (`method="stripe"`, type `"crypto"`): server creates a PaymentIntent, Stripe provides a deposit address, client sends crypto to that address. Stripe confirms settlement. The mppx client sees `method="stripe"` and uses the Stripe SDK.
- **Tempo** (`method="tempo"`): direct on-chain payment — mppx client sees a recipient address in the challenge and sends crypto directly from a wallet. No Stripe involvement.

Adding `"crypto"` to `paymentMethodTypes` in the Stripe MPP charge makes the `WWW-Authenticate` header advertise crypto support.

## Common commands

```bash
pnpm dev                              # start dev server
pnpm build
pnpm tsx scripts/scrape-fleet.ts      # refresh fleet data (quarterly)
```
