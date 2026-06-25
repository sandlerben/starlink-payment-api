import crypto from "crypto"
import { Mppx, stripe as stripeMpp, tempo } from "mppx/server"
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, getFleetStats, isSupportedAirline } from "@/lib/fleet"
import { NextRequest } from "next/server"

// MPP secret key for securing payment challenges
const mppSecretKey = process.env.MPP_SECRET_KEY || crypto.randomBytes(32).toString("base64")

// Tempo USD token addresses
const PATH_USD_TESTNET = "0x20c0000000000000000000000000000000000000"
const PATH_USD_MAINNET = "0x20c000000000000000000000b9537d11c60e8b50"

const isTestnet = process.env.TEMPO_TESTNET !== "false"

// Prices: $0.50 for card, $0.01 for crypto
const CARD_PRICE = "0.50"
const CRYPTO_PRICE = "0.01"

export async function POST(request: NextRequest) {
  try {
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

    // Recipient address for crypto payments (configure via env var)
    const recipientAddress = process.env.TEMPO_RECIPIENT_ADDRESS as `0x${string}` | undefined

    // Create MPP handler with both Tempo (crypto) and Stripe (card)
    const mppx = Mppx.create({
      methods: [
        ...(recipientAddress
          ? [
              tempo.charge({
                currency: isTestnet ? PATH_USD_TESTNET : PATH_USD_MAINNET,
                recipient: recipientAddress,
                testnet: isTestnet,
              }),
            ]
          : []),
        stripeMpp.charge({
          networkId: process.env.STRIPE_PROFILE_ID || "internal",
          paymentMethodTypes: ["card", "link"],
          secretKey: process.env.STRIPE_SECRET_KEY!,
        }),
      ],
      secretKey: mppSecretKey,
    })

    // Per-method pricing: $0.01 crypto, $0.50 card
    const result = recipientAddress
      ? await mppx.compose(
          ['tempo/charge', { amount: CRYPTO_PRICE, description }],
          ['stripe/charge', { amount: CARD_PRICE, currency: 'usd', decimals: 2, description }],
        )(request)
      : await mppx.charge({
          amount: CARD_PRICE,
          currency: 'usd',
          decimals: 2,
          description,
        })(request)

    // If payment is required, return the challenge
    if (result.status === 402) {
      return result.challenge
    }

    // Payment successful - look up flight info via FlightAware
    const flightInfo = await getFlightFromAeroAPI(flightNumber, date)

    if (!flightInfo) {
      return result.withReceipt(
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
      return result.withReceipt(
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
      return result.withReceipt(
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
    return result.withReceipt(
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
    paymentMethods: ["Crypto (USDC via Tempo)", "Card (via Stripe SPT)"],
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
