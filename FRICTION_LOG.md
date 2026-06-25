# MPP Friction Log

## Context
Building a payment-gated API (flight Starlink checker) using mppx with both Stripe card and crypto payment methods. Goal: charge $0.50 for card, $0.01 for crypto.

## Issues Encountered

### 1. Unclear relationship between Stripe crypto and Tempo
**Problem:** It's confusing whether "crypto" means Stripe's native crypto deposit flow (`payment_method_types: ["crypto"]`) or the Tempo blockchain method (`method="tempo"` in MPP). These are two fundamentally different things:
- Stripe crypto: server creates a PaymentIntent, gets a deposit address, client pays on-chain, Stripe confirms
- Tempo via MPP: client sees `method="tempo"` in WWW-Authenticate, pays directly on-chain to a recipient address

**Impact:** We initially added `"crypto"` to `paymentMethodTypes` in `stripe.charge()`, thinking that would enable crypto payments. But mppx clients see `method="stripe"` and try to use the Stripe SDK (which needs a key client-side). The client can't know to send an on-chain transaction from a `method="stripe"` challenge.

**Suggestion:** The docs should clearly explain: "If you want clients to pay with crypto wallets, use `tempo.charge()` — not `stripe.charge()` with `paymentMethodTypes: ['crypto']`. Stripe's crypto deposit flow is for generating the *recipient address* that feeds into the Tempo method."

### 2. createPayToAddress blocks the 402 response
**Problem:** The Stripe docs show calling `createPayToAddress(request)` before issuing the 402 challenge. This creates a PaymentIntent on every request, meaning:
- If the Stripe account doesn't have crypto enabled, the entire endpoint 500s
- Even when it works, you're making a Stripe API call before you even know if the client will pay with crypto
- If the PaymentIntent creation fails (wrong API version, crypto not enabled), you can't even return a card-only 402

**Suggestion:** Either:
- Make `createPayToAddress` lazy (only called when a client actually presents a Tempo credential)
- Or clearly document that you need a static wallet address for the challenge, and only create the PaymentIntent during verification
- Or support a `TEMPO_RECIPIENT_ADDRESS` env var pattern where you use your own wallet and Stripe handles settlement separately

### 3. API version confusion for crypto
**Problem:** The `lib/stripe.ts` was configured with `apiVersion: "2025-04-30.preview"` but the Stripe MPP docs reference `"2026-03-04.preview"`. There's no clear error message — just a generic rejection of the `payment_method_options[crypto][mode]` parameter.

**Suggestion:** The error response should say something like "Crypto payment methods require API version 2026-03-04.preview or later" rather than a generic parameter validation error.

### 4. Per-method pricing not documented on mpp.dev
**Problem:** We needed different prices for different methods ($0.50 card, $0.01 crypto). The `mppx.compose()` API supports this, and it's shown in the type definitions, but it's not documented on mpp.dev. We only found it by reading the `.d.ts` files.

**Suggestion:** Add a "Per-method pricing" section to mpp.dev docs showing the `compose()` pattern:
```ts
const result = await mppx.compose(
  ['tempo/charge', { amount: '0.01', description }],
  ['stripe/charge', { amount: '0.50', currency: 'usd', decimals: 2, description }],
)(request)
```

### 5. mpp.dev vs docs.stripe.com/payments/machine/mpp gap
**Problem:** The Stripe-specific docs (`docs.stripe.com/payments/machine/mpp.md`) have critical implementation details (createPayToAddress pattern, API version requirements, testnet setup) that don't appear on mpp.dev. A developer starting from mpp.dev won't find the Stripe crypto integration path.

**Suggestion:** Cross-link between the two, or consolidate the Stripe crypto + MPP setup into one guide that covers the full flow end-to-end.

### 6. No clear "enable crypto" path
**Problem:** When Stripe crypto isn't enabled on an account, the error doesn't guide you toward enabling it. We had to guess whether it was an API version issue, an account capability issue, or a parameter format issue.

**Suggestion:** Return an actionable error: "Crypto payments are not enabled on this account. Enable them at dashboard.stripe.com/settings/payment_methods or contact support."
