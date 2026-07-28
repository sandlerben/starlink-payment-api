import crypto from 'node:crypto'
import { facilitator as cdpFacilitator } from '@coinbase/x402'
import { solana } from '@solana/mpp/server'
import { Mppx, stripe } from 'mppx/server'
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, isSupportedAirline } from "@/lib/fleet"
import { NextRequest } from "next/server"

// --- MPP setup ---

async function setup() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY!
  const mppSecretKey = crypto
    .createHmac('sha256', stripeSecretKey)
    .update('mpp-challenge-signing')
    .digest('base64')
  const isTestMode = stripeSecretKey.includes('_test_')

  const methods = await stripe({
    secretKey: stripeSecretKey,
    profileId: process.env.STRIPE_PROFILE_ID!,
    additional: [
      { network: 'base', x402: { facilitator: buildCdpFacilitator() } },
      {
        network: 'solana',
        configure: (address) =>
          solana.charge({
            recipient: address,
            currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            decimals: 6,
            network: isTestMode ? 'devnet' : 'mainnet-beta',
          }),
      },
    ],
  })
  return Mppx.create({ methods, secretKey: mppSecretKey })
}

function buildCdpFacilitator() {
  const { url, createAuthHeaders } = cdpFacilitator as {
    url: string
    createAuthHeaders: () => Promise<{ verify: Record<string, string>; settle: Record<string, string> }>
  }
  return {
    async verify(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      const response = await fetch(`${url}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers.verify },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })
      return response.json()
    },
    async settle(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      const response = await fetch(`${url}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers.settle },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })
      return response.json()
    },
  }
}

let mppxInstance: Awaited<ReturnType<typeof setup>> | null = null
let setupPromise: Promise<Awaited<ReturnType<typeof setup>>> | null = null

export async function getMppx() {
  if (mppxInstance) return mppxInstance
  if (!setupPromise) setupPromise = setup().then((instance) => {
    mppxInstance = instance
    return instance
  })
  return setupPromise
}

// --- Route handler ---

export async function POST(request: NextRequest) {
  try {
    const body = await request.clone().json().catch(() => ({}))
    const flightNumber = body.flightNumber as string | undefined
    const date = body.date as string | undefined

    if (!flightNumber) {
      return Response.json({ error: "Missing flight number", example: { flightNumber: "UA2145" } }, { status: 400 })
    }

    const airlineCode = flightNumber.match(/^([A-Z]{2,3})/i)?.[1]?.toUpperCase() || ""
    if (!isSupportedAirline(airlineCode)) {
      return Response.json({ error: "Unsupported airline", supportedAirlines: ["UA"] }, { status: 400 })
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

    return result.withReceipt(Response.json({
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
