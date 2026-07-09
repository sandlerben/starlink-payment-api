import crypto from "crypto"
import { Receipt } from "mppx"
import { evm, Mppx, stripe as stripeMpp, tempo } from "mppx/server"
import { solana } from "@solana/mpp/server"
import { facilitator as cdpFacilitator } from "@coinbase/x402"
import Stripe from "stripe"
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, isSupportedAirline } from "@/lib/fleet"
import { NextRequest } from "next/server"

// --- Payment config ---

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-04.preview" as Stripe.LatestApiVersion,
})

const mppSecretKey = process.env.MPP_SECRET_KEY || crypto.randomBytes(32).toString("base64")
const PATH_USD_TESTNET = "0x20c0000000000000000000000000000000000000"
const PATH_USD_MAINNET = "0x20c000000000000000000000b9537d11c60e8b50"
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const CARD_PRICE = "0.50"
const CRYPTO_PRICE = "0.01"
const SOLANA_ATOMIC_PRICE = "10000"

// Stripe deposit address cache (lives for the process lifetime)
const depositAddressCache = new Map<string, Promise<string>>()

function getOrCreateDepositAddress(network: string): Promise<`0x${string}`> {
  if (!depositAddressCache.has(network)) {
    depositAddressCache.set(network, (async () => {
      const list = await stripe.rawRequest("GET", `/v1/crypto/deposit_addresses?network=${network}&limit=1`) as { data?: { address: string }[] }
      if (list.data?.length) return list.data[0].address
      const created = await stripe.rawRequest("POST", "/v1/crypto/deposit_addresses", { network }) as { address: string }
      return created.address
    })())
  }
  return depositAddressCache.get(network)! as Promise<`0x${string}`>
}

// x402 facilitator (Coinbase CDP with JWT auth)
const x402Facilitator = (() => {
  const { url, createAuthHeaders } = cdpFacilitator
  return {
    async verify(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      return (await fetch(`${url}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers.verify },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })).json()
    },
    async settle(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      return (await fetch(`${url}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers.settle },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })).json()
    },
  }
})()

// --- Payment handler ---

async function handlePayment(request: Request, description: string) {
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
    ...(baseRecipient ? [evm.charge({
      currency: isTestnet ? evm.assets.baseSepolia.USDC : evm.assets.base.USDC,
      recipient: baseRecipient,
      x402: { facilitator: x402Facilitator },
    })] : []),
    ...(solanaRecipient ? [solana.charge({
      recipient: solanaRecipient, currency: SOLANA_USDC, decimals: 6,
      network: isTestnet ? "devnet" : "mainnet-beta",
    })] : []),
    ...(recipientAddress ? [tempo.charge({
      currency: isTestnet ? PATH_USD_TESTNET : PATH_USD_MAINNET,
      recipient: recipientAddress, testnet: isTestnet,
    })] : []),
    stripeMpp.charge({
      networkId: process.env.STRIPE_PROFILE_ID || "internal",
      paymentMethodTypes: ["card", "link"],
      secretKey: process.env.STRIPE_SECRET_KEY!,
    }),
  ]

  const mppx = Mppx.create({ methods, realm, secretKey: mppSecretKey })

  const result = await mppx.compose(
    ...[
      baseRecipient && ['evm/charge', { amount: CRYPTO_PRICE, description }],
      solanaRecipient && ['solana/charge', { amount: SOLANA_ATOMIC_PRICE, description }],
      recipientAddress && ['tempo/charge', { amount: CRYPTO_PRICE, description }],
      ['stripe/charge', { amount: CARD_PRICE, currency: 'usd', decimals: 2, description }],
    ].filter(Boolean),
  )(request)

  if (result.status === 402) return { paid: false as const, challenge: result.challenge }

  return {
    paid: true as const,
    withReceipt: (response: Response) => {
      const finalResponse = result.withReceipt(response)
      // Record on-chain payments in Stripe asynchronously
      const header = finalResponse.headers.get("Payment-Receipt")
      if (header) {
        try {
          const receipt = Receipt.deserialize(header)
          const network = receipt.method === "tempo" ? "tempo" : receipt.method === "evm" ? "base" : receipt.method === "solana" ? "solana" : null
          if (network) {
            stripe.paymentIntents.create({
              amount: 1, currency: "usd", payment_method_types: ["crypto"],
              payment_method_data: { type: "crypto" },
              payment_method_options: { crypto: { mode: "transaction_verification", transaction_verification_options: { transaction_hash: receipt.reference, network } } } as unknown as Record<string, unknown>,
              confirm: true,
            }).catch((err) => console.error("Failed to record crypto payment:", err))
          }
        } catch {}
      }
      return finalResponse
    },
  }
}

// --- Routes ---

export async function POST(request: NextRequest) {
  try {
    const body = await request.clone().json().catch(() => ({}))
    const flightNumber = body.flightNumber as string | undefined
    const date = body.date as string | undefined

    if (!flightNumber) {
      return Response.json(
        { error: "Missing flight number", example: { flightNumber: "UA2145", date: "2026-07-10" } },
        { status: 400 },
      )
    }

    const airlineCode = flightNumber.match(/^([A-Z]{2,3})/i)?.[1]?.toUpperCase() || ""
    if (!isSupportedAirline(airlineCode)) {
      return Response.json({ error: "Unsupported airline", supportedAirlines: ["UA"] }, { status: 400 })
    }

    const payment = await handlePayment(request, `Flight Starlink Check: ${flightNumber.toUpperCase()}`)
    if (!payment.paid) return payment.challenge

    const flightInfo = await getFlightFromAeroAPI(flightNumber, date)
    if (!flightInfo) {
      return payment.withReceipt(Response.json({ flightNumber: flightNumber.toUpperCase(), found: false }, { status: 404 }))
    }

    const tailNumber = flightInfo.tailNumber
    const aircraftInfo = tailNumber ? getAircraftWifiProvider(tailNumber) : null

    return payment.withReceipt(Response.json({
      flightNumber: flightInfo.flightNumber,
      origin: flightInfo.origin,
      destination: flightInfo.destination,
      departureTime: flightInfo.departureTime,
      arrivalTime: flightInfo.arrivalTime,
      status: flightInfo.status,
      aircraftType: flightInfo.aircraftType,
      tailNumber,
      hasStarlink: aircraftInfo?.hasStarlink ?? null,
      wifiProvider: aircraftInfo?.wifiProvider ?? "Unknown",
    }))
  } catch (error) {
    console.error("API Error:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
