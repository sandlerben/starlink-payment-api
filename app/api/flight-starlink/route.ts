import crypto from "node:crypto"
import Stripe from "stripe"
import { Receipt } from "mppx"
import { facilitator as cdpFacilitator } from "@coinbase/x402"
import { solana } from "@solana/mpp/server"
import { evm, Mppx, stripe, tempo } from "mppx/server"
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, isSupportedAirline } from "@/lib/fleet"
import { NextRequest } from "next/server"

// --- Constants ---

const TEMPO_USDC_TESTNET = "0x20c0000000000000000000000000000000000000" as `0x${string}`
const TEMPO_USDC_MAINNET = "0x20c000000000000000000000b9537d11c60e8b50" as `0x${string}`
const SOLANA_USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
const SOLANA_USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"

// --- x402 facilitator (Coinbase CDP) ---

function buildCdpFacilitator() {
  const { url, createAuthHeaders } = cdpFacilitator as {
    url: string
    createAuthHeaders: () => Promise<{ verify: Record<string, string>; settle: Record<string, string> }>
  }
  return {
    async verify(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      const response = await fetch(`${url}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers.verify },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })
      return response.json()
    },
    async settle(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      const response = await fetch(`${url}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers.settle },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })
      return response.json()
    },
  }
}

// --- MPP setup (lazy-init for Vercel) ---

let stripeClient: Stripe | null = null

async function setup() {
  const secretKey = process.env.STRIPE_SECRET_KEY!
  const isTestMode = secretKey.includes("_test_")

  stripeClient = new Stripe(secretKey)

  // Resolve deposit addresses from Stripe
  const stripeHeaders = {
    Authorization: `Basic ${btoa(`${secretKey}:`)}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": "2026-02-25.preview",
  }

  async function getDepositAddress(network: string): Promise<string | null> {
    try {
      const listRes = await fetch(
        `https://api.stripe.com/v1/crypto/deposit_addresses?network=${network}&limit=1`,
        { headers: stripeHeaders },
      )
      if (listRes.ok) {
        const list = await listRes.json()
        if (list.data?.length) return list.data[0].address
      }
      const createRes = await fetch("https://api.stripe.com/v1/crypto/deposit_addresses", {
        method: "POST",
        headers: stripeHeaders,
        body: new URLSearchParams({ network }),
      })
      if (createRes.ok) return (await createRes.json()).address
      return null
    } catch {
      return null
    }
  }

  const [tempoAddress, baseAddress, solanaAddress] = await Promise.all([
    getDepositAddress("tempo"),
    getDepositAddress("base"),
    getDepositAddress("solana"),
  ])

  const mppSecretKey = crypto
    .createHmac("sha256", secretKey)
    .update("mpp-challenge-signing")
    .digest("base64")

  const methods = [
    ...(tempoAddress
      ? [
          tempo.charge({
            currency: isTestMode ? TEMPO_USDC_TESTNET : TEMPO_USDC_MAINNET,
            recipient: tempoAddress as `0x${string}`,
            ...(isTestMode && { testnet: true }),
          }),
        ]
      : []),
    ...(baseAddress
      ? [
          evm.charge({
            currency: isTestMode ? evm.assets.baseSepolia.USDC : evm.assets.base.USDC,
            recipient: baseAddress as `0x${string}`,
            x402: { facilitator: buildCdpFacilitator() },
          }),
        ]
      : []),
    ...(solanaAddress
      ? [
          solana.charge({
            recipient: solanaAddress,
            currency: isTestMode ? SOLANA_USDC_DEVNET : SOLANA_USDC_MAINNET,
            decimals: 6,
            network: isTestMode ? "devnet" : "mainnet-beta",
          }),
        ]
      : []),
    stripe.charge({
      secretKey,
      networkId: process.env.STRIPE_PROFILE_ID || "internal",
      paymentMethodTypes: ["card", "link"],
    }),
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Mppx.create({ methods, secretKey: mppSecretKey }) as any
}

type MppxInstance = Awaited<ReturnType<typeof setup>>
let mppxInstance: MppxInstance | null = null
let setupPromise: Promise<MppxInstance> | null = null

export async function getMppx() {
  if (mppxInstance) return mppxInstance
  if (!setupPromise)
    setupPromise = setup().then((instance) => {
      mppxInstance = instance
      return instance
    })
  return setupPromise
}

// --- Crypto PI recording (fire-and-forget) ---

export async function recordCryptoPayment(response: Response, amountCents: number) {
  const receiptHeader = response.headers.get("Payment-Receipt")
  if (!receiptHeader || !stripeClient) return
  try {
    const receipt = Receipt.deserialize(receiptHeader)
    const network =
      receipt.method === "tempo" ? "tempo" :
      receipt.method === "evm" ? "base" :
      receipt.method === "solana" ? "solana" :
      null
    if (!network) return
    await stripeClient.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      confirm: true,
      payment_method_data: { type: "crypto" } as any,
      payment_method_types: ["crypto"],
      payment_method_options: {
        crypto: {
          mode: "transaction_verification",
          transaction_verification_options: { network, transaction_hash: receipt.reference },
        },
      } as any,
    }, {
      apiVersion: "2026-02-25.preview" as any,
      idempotencyKey: receipt.reference,
    })
  } catch (err) {
    console.error("[stripe] failed to record crypto payment:", err)
  }
}

// --- Route handler ---

export async function POST(request: NextRequest) {
  try {
    const body = await request.clone().json().catch(() => ({}))
    const flightNumber = body.flightNumber as string | undefined
    const date = body.date as string | undefined

    if (!flightNumber) {
      return Response.json(
        { error: "Missing flight number", example: { flightNumber: "UA2145" } },
        { status: 400 },
      )
    }

    const airlineCode = flightNumber.match(/^([A-Z]{2,3})/i)?.[1]?.toUpperCase() || ""
    if (!isSupportedAirline(airlineCode)) {
      return Response.json(
        { error: "Unsupported airline", supportedAirlines: ["UA"] },
        { status: 400 },
      )
    }

    const flightInfo = await getFlightFromAeroAPI(flightNumber, date)
    if (!flightInfo) {
      return Response.json({ flightNumber: flightNumber.toUpperCase(), found: false }, { status: 404 })
    }

    const description = `Flight Starlink Check: ${flightNumber.toUpperCase()}`
    const mppx = await getMppx()
    const result = await mppx.compose(
      ["tempo/charge", { amount: "0.01", description }],
      ["evm/charge", { amount: "0.01", description }],
      ["solana/charge", { amount: "10000", description }],
      ["stripe/charge", { amount: "0.50", currency: "usd", decimals: 2, description }],
    )(request)

    if (result.status === 402) return result.challenge

    const tailNumber = flightInfo.tailNumber
    const aircraftInfo = tailNumber ? getAircraftWifiProvider(tailNumber) : null

    const response = result.withReceipt(
      Response.json({
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
      }),
    )
    await recordCryptoPayment(response, 1)
    return response
  } catch (error) {
    console.error("API Error:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
