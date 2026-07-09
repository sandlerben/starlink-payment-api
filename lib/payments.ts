import "server-only"

import crypto from "crypto"
import Stripe from "stripe"
import { Receipt } from "mppx"
import { evm, Mppx, stripe as stripeMpp, tempo } from "mppx/server"
import { solana } from "@solana/mpp/server"
import { facilitator as cdpFacilitator } from "@coinbase/x402"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-04.preview" as Stripe.LatestApiVersion,
})

// --- Config ---

const mppSecretKey = process.env.MPP_SECRET_KEY || crypto.randomBytes(32).toString("base64")
const PATH_USD_TESTNET = "0x20c0000000000000000000000000000000000000"
const PATH_USD_MAINNET = "0x20c000000000000000000000b9537d11c60e8b50"
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const CARD_PRICE = "0.50"
const CRYPTO_PRICE = "0.01"
const SOLANA_ATOMIC_PRICE = "10000"

// --- Stripe deposit addresses ---

type DepositAddressResponse = { id: string; address: string; network: string }

const depositAddressCache = new Map<string, Promise<string>>()

async function getOrCreateDepositAddress(network: string): Promise<`0x${string}`> {
  if (!depositAddressCache.has(network)) {
    depositAddressCache.set(
      network,
      (async () => {
        const list = (await stripe.rawRequest(
          "GET",
          `/v1/crypto/deposit_addresses?network=${network}&limit=1`,
        )) as { data?: DepositAddressResponse[] }

        if (list.data && list.data.length > 0) return list.data[0].address

        const created = (await stripe.rawRequest("POST", "/v1/crypto/deposit_addresses", {
          network,
        })) as DepositAddressResponse
        return created.address
      })(),
    )
  }
  return depositAddressCache.get(network)! as Promise<`0x${string}`>
}

// --- x402 facilitator (Coinbase CDP) ---

const x402Facilitator = (() => {
  const { url, createAuthHeaders } = cdpFacilitator
  return {
    async verify(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      const res = await fetch(`${url}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers.verify },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })
      return res.json()
    },
    async settle(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      const res = await fetch(`${url}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers.settle },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })
      return res.json()
    },
  }
})()

// --- Stripe PI recording ---

function recordCryptoPayment(transactionHash: string, network: string, amountCents: number) {
  stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    payment_method_types: ["crypto"],
    payment_method_data: { type: "crypto" },
    payment_method_options: {
      crypto: {
        mode: "transaction_verification",
        transaction_verification_options: { transaction_hash: transactionHash, network },
      },
    } as unknown as Record<string, unknown>,
    confirm: true,
  }).catch((err) => console.error("Failed to record crypto payment:", err))
}

function extractCryptoTxHash(response: Response): { hash: string; network: string } | null {
  const header = response.headers.get("Payment-Receipt")
  if (!header) return null
  try {
    const receipt = Receipt.deserialize(header)
    if (receipt.method === "tempo") return { hash: receipt.reference, network: "tempo" }
    if (receipt.method === "evm") return { hash: receipt.reference, network: "base" }
    if (receipt.method === "solana") return { hash: receipt.reference, network: "solana" }
  } catch {}
  return null
}

// --- Main payment handler ---

type PaymentResult =
  | { paid: false; challenge: Response }
  | { paid: true; withReceipt: (response: Response) => Response }

export async function handlePayment(request: Request, description: string): Promise<PaymentResult> {
  const isTestnet = process.env.TEMPO_TESTNET === "true"

  const [tempoRecipient, baseRecipient, solanaRecipient] = await Promise.all([
    getOrCreateDepositAddress("tempo").catch(() => null),
    getOrCreateDepositAddress("base").catch(() => null),
    getOrCreateDepositAddress("solana").catch(() => null),
  ])

  const recipientAddress: `0x${string}` | null =
    tempoRecipient ?? (process.env.TEMPO_RECIPIENT_ADDRESS as `0x${string}` | undefined) ?? null

  const realm = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? undefined

  const methods = [
    ...(baseRecipient
      ? [evm.charge({
          currency: isTestnet ? evm.assets.baseSepolia.USDC : evm.assets.base.USDC,
          recipient: baseRecipient,
          x402: { facilitator: x402Facilitator },
        })]
      : []),
    ...(solanaRecipient
      ? [solana.charge({
          recipient: solanaRecipient,
          currency: SOLANA_USDC,
          decimals: 6,
          network: isTestnet ? "devnet" : "mainnet-beta",
        })]
      : []),
    ...(recipientAddress
      ? [tempo.charge({
          currency: isTestnet ? PATH_USD_TESTNET : PATH_USD_MAINNET,
          recipient: recipientAddress,
          testnet: isTestnet,
        })]
      : []),
    stripeMpp.charge({
      networkId: process.env.STRIPE_PROFILE_ID || "internal",
      paymentMethodTypes: ["card", "link"],
      secretKey: process.env.STRIPE_SECRET_KEY!,
    }),
  ]

  const mppx = Mppx.create({ methods, realm, secretKey: mppSecretKey })

  const cryptoOpts = { amount: CRYPTO_PRICE, description } as const
  const solanaOpts = { amount: SOLANA_ATOMIC_PRICE, description } as const
  const cardOpts = { amount: CARD_PRICE, currency: 'usd', decimals: 2, description } as const

  const result = await mppx.compose(
    ...[
      baseRecipient && ['evm/charge', cryptoOpts],
      solanaRecipient && ['solana/charge', solanaOpts],
      recipientAddress && ['tempo/charge', cryptoOpts],
      ['stripe/charge', cardOpts],
    ].filter(Boolean),
  )(request)

  if (result.status === 402) {
    return { paid: false, challenge: result.challenge }
  }

  return {
    paid: true,
    withReceipt: (response: Response) => {
      const finalResponse = result.withReceipt(response)
      const cryptoTx = extractCryptoTxHash(finalResponse)
      if (cryptoTx) recordCryptoPayment(cryptoTx.hash, cryptoTx.network, 1)
      return finalResponse
    },
  }
}
