import crypto from "crypto"
import { evm, Mppx, stripe as stripeMpp, tempo } from "mppx/server"
import { solana } from "@solana/mpp/server"
import { facilitator as cdpFacilitator } from "@coinbase/x402"
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, getFleetStats, isSupportedAirline } from "@/lib/fleet"
import { extractCryptoTxHash, getOrCreateDepositAddress, recordCryptoPayment } from "@/lib/crypto-payments"
import { NextRequest } from "next/server"

// MPP secret key for securing payment challenges
const mppSecretKey = process.env.MPP_SECRET_KEY || crypto.randomBytes(32).toString("base64")

// Tempo USD token addresses
const PATH_USD_TESTNET = "0x20c0000000000000000000000000000000000000"
const PATH_USD_MAINNET = "0x20c000000000000000000000b9537d11c60e8b50"

// Prices: $0.50 for card, $0.01 for crypto
const CARD_PRICE = "0.50"
const CRYPTO_PRICE = "0.01"

// x402 facilitator: CDP (Coinbase) with JWT auth
const x402Facilitator = (() => {
  const { url, createAuthHeaders } = cdpFacilitator
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
})()

// Solana USDC mint address
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

export async function POST(request: NextRequest) {
  try {
    // Read at request time so env vars are picked up correctly per deployment
    const isTestnet = process.env.TEMPO_TESTNET === "true"

    // Clone the request to read the body
    const clonedRequest = request.clone()
    const body = await clonedRequest.json().catch(() => ({}))
    const flightNumber = body.flightNumber as string | undefined
    const date = body.date as string | undefined // Optional: YYYY-MM-DD format

    // Validate flight number is provided
    if (!flightNumber) {
      return Response.json(
        {
          error: "Missing flight number",
          message: "Please provide a flight number in the request body",
          example: { flightNumber: "UA2145", date: "2026-05-15" },
        },
        { status: 400 }
      )
    }

    // Extract airline code to check if supported
    const airlineMatch = flightNumber.match(/^([A-Z]{2,3})/i)
    const airlineCode = airlineMatch?.[1]?.toUpperCase() || ""

    if (!isSupportedAirline(airlineCode)) {
      return Response.json(
        {
          error: "Unsupported airline",
          message: `Currently only United Airlines (UA) flights are supported. More airlines coming soon!`,
          supportedAirlines: ["UA (United Airlines)"],
        },
        { status: 400 }
      )
    }

    const description = `Flight Starlink Check: ${flightNumber.toUpperCase()}`

    // Get Stripe-managed deposit addresses for each supported network
    const [tempoRecipient, baseRecipient, solanaRecipient] = await Promise.all([
      getOrCreateDepositAddress("tempo").catch(() => null),
      getOrCreateDepositAddress("base").catch(() => null),
      getOrCreateDepositAddress("solana").catch(() => null),
    ])

    // Fall back to env var for Tempo if deposit address API not available
    const recipientAddress: `0x${string}` | null =
      tempoRecipient ?? (process.env.TEMPO_RECIPIENT_ADDRESS as `0x${string}` | undefined) ?? null

    // Use the incoming host as the realm so it matches any alias or custom domain
    const realm = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? undefined

    // Build payment methods: EVM/x402 (Base), Solana, Tempo, and Stripe cards
    const methods = [
      // EVM/x402: Base USDC with x402 facilitator
      ...(baseRecipient
        ? [
            evm.charge({
              currency: isTestnet ? evm.assets.baseSepolia.USDC : evm.assets.base.USDC,
              recipient: baseRecipient,
              x402: { facilitator: x402Facilitator },
            }),
          ]
        : []),
      // Solana: USDC via SPL transfer
      ...(solanaRecipient
        ? [
            solana.charge({
              recipient: solanaRecipient,
              currency: SOLANA_USDC,
              decimals: 6,
              network: isTestnet ? "devnet" : "mainnet-beta",
            }),
          ]
        : []),
      // Tempo: direct on-chain stablecoin
      ...(recipientAddress
        ? [
            tempo.charge({
              currency: isTestnet ? PATH_USD_TESTNET : PATH_USD_MAINNET,
              recipient: recipientAddress,
              testnet: isTestnet,
            }),
          ]
        : []),
      // Stripe: card and link via SPT
      stripeMpp.charge({
        networkId: process.env.STRIPE_PROFILE_ID || "internal",
        paymentMethodTypes: ["card", "link"],
        secretKey: process.env.STRIPE_SECRET_KEY!,
      }),
    ]

    const mppx = Mppx.create({ methods, realm, secretKey: mppSecretKey })

    // Compose all available payment methods with per-method pricing
    const cryptoOpts = { amount: CRYPTO_PRICE, description } as const
    const cardOpts = { amount: CARD_PRICE, currency: 'usd', decimals: 2, description } as const

    const result = await mppx.compose(
      ...[
        baseRecipient && ['evm/charge', cryptoOpts],
        solanaRecipient && ['solana/charge', cryptoOpts],
        recipientAddress && ['tempo/charge', cryptoOpts],
        ['stripe/charge', cardOpts],
      ].filter(Boolean),
    )(request)

    // If payment is required, return the challenge
    if (result.status === 402) {
      return result.challenge
    }

    // Wrap withReceipt to also record Tempo payments asynchronously
    const withReceiptAndRecord = (response: Response) => {
      const finalResponse = result.withReceipt(response)
      const cryptoTx = extractCryptoTxHash(finalResponse)
      if (cryptoTx) {
        recordCryptoPayment(cryptoTx.hash, cryptoTx.network, 1)
          .catch((err) => console.error("Failed to record crypto payment:", err))
      }
      return finalResponse
    }

    // Payment successful - look up flight info via FlightAware
    const flightInfo = await getFlightFromAeroAPI(flightNumber, date)

    if (!flightInfo) {
      return withReceiptAndRecord(
        Response.json(
          {
            success: true,
            flightNumber: flightNumber.toUpperCase(),
            found: false,
            message: "Flight not found in FlightAware. Check the flight number and try again.",
            tip: "Make sure to use the correct format: UA1234, not United 1234",
          },
          { status: 404 }
        )
      )
    }

    // Look up aircraft WiFi provider from our fleet database
    const tailNumber = flightInfo.tailNumber

    if (!tailNumber) {
      return withReceiptAndRecord(
        Response.json({
          success: true,
          flightNumber: flightInfo.flightNumber,
          origin: flightInfo.origin,
          destination: flightInfo.destination,
          departureTime: flightInfo.departureTime,
          status: flightInfo.status,
          tailNumber: null,
          hasStarlink: null,
          wifiProvider: "Unknown",
          message: "Aircraft not yet assigned to this flight. Check back closer to departure.",
        })
      )
    }

    const aircraftInfo = getAircraftWifiProvider(tailNumber)

    if (!aircraftInfo) {
      return withReceiptAndRecord(
        Response.json({
          success: true,
          flightNumber: flightInfo.flightNumber,
          origin: flightInfo.origin,
          destination: flightInfo.destination,
          departureTime: flightInfo.departureTime,
          status: flightInfo.status,
          aircraftType: flightInfo.aircraftType,
          tailNumber: tailNumber,
          hasStarlink: null,
          wifiProvider: "Unknown",
          message: `Aircraft ${tailNumber} not found in our fleet database.`,
        })
      )
    }

    // Return the complete flight Starlink information with payment receipt
    return withReceiptAndRecord(
      Response.json({
        success: true,
        flightNumber: flightInfo.flightNumber,
        origin: flightInfo.origin,
        destination: flightInfo.destination,
        departureTime: flightInfo.departureTime,
        arrivalTime: flightInfo.arrivalTime,
        status: flightInfo.status,
        aircraftType: flightInfo.aircraftType,
        tailNumber: tailNumber,
        hasStarlink: aircraftInfo.hasStarlink,
        wifiProvider: aircraftInfo.wifiProvider,
        message: aircraftInfo.hasStarlink
          ? `Great news! This flight (${tailNumber}) has Starlink WiFi!`
          : `This flight (${tailNumber}) has ${aircraftInfo.wifiProvider} WiFi, not Starlink.`,
        dataFreshness: aircraftInfo.lastUpdated,
      })
    )
  } catch (error) {
    console.error("API Error:", error)
    return Response.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    )
  }
}

// GET endpoint to show API info and fleet stats
export async function GET() {
  const stats = getFleetStats()
  
  return Response.json({
    service: "Flight Starlink Checker API",
    description: "Check if a United Airlines flight has Starlink WiFi",
    price: { card: `$${CARD_PRICE}`, crypto: `$${CRYPTO_PRICE}` },
    paymentMethods: [
      "EVM/x402 (USDC on Base)",
      "Solana (USDC via SPL)",
      "Tempo (USDC on-chain)",
      "Card/Link (via Stripe SPT)",
    ],
    usage: {
      method: "POST",
      endpoint: "/api/flight-starlink",
      body: {
        flightNumber: "string (e.g., 'UA2145')",
        date: "string (optional, YYYY-MM-DD format)",
      },
    },
    dataSource: {
      flightInfo: "FlightAware AeroAPI (real-time)",
      wifiProvider: "unitedstarlinktracker.com (daily updates)",
    },
    fleetStats: {
      lastUpdated: stats.lastUpdated,
      totalAircraft: stats.totalAircraft,
      byProvider: stats.byProvider,
    },
    supportedAirlines: ["United Airlines (UA)"],
    comingSoon: ["Delta (DL)", "American (AA)", "JetBlue (B6)"],
  })
}
