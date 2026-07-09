import { handlePayment, CARD_PRICE, CRYPTO_PRICE } from "@/lib/mpp"
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, getFleetStats, isSupportedAirline } from "@/lib/fleet"
import { NextRequest } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const clonedRequest = request.clone()
    const body = await clonedRequest.json().catch(() => ({}))
    const flightNumber = body.flightNumber as string | undefined
    const date = body.date as string | undefined

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

    const airlineMatch = flightNumber.match(/^([A-Z]{2,3})/i)
    const airlineCode = airlineMatch?.[1]?.toUpperCase() || ""

    if (!isSupportedAirline(airlineCode)) {
      return Response.json(
        {
          error: "Unsupported airline",
          message: "Currently only United Airlines (UA) flights are supported.",
          supportedAirlines: ["UA (United Airlines)"],
        },
        { status: 400 }
      )
    }

    const description = `Flight Starlink Check: ${flightNumber.toUpperCase()}`
    const payment = await handlePayment(request, description)

    if (!payment.paid) return payment.challenge

    const flightInfo = await getFlightFromAeroAPI(flightNumber, date)

    if (!flightInfo) {
      return payment.withReceipt(
        Response.json(
          {
            flightNumber: flightNumber.toUpperCase(),
            found: false,
            message: "Flight not found in FlightAware. Check the flight number and try again.",
          },
          { status: 404 }
        )
      )
    }

    const tailNumber = flightInfo.tailNumber
    const aircraftInfo = tailNumber ? getAircraftWifiProvider(tailNumber) : null

    return payment.withReceipt(
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
        message: aircraftInfo?.hasStarlink
          ? `Great news! This flight (${tailNumber}) has Starlink WiFi!`
          : `This flight (${tailNumber}) has ${aircraftInfo?.wifiProvider ?? "Unknown"} WiFi, not Starlink.`,
        dataFreshness: aircraftInfo?.lastUpdated,
      })
    )
  } catch (error) {
    console.error("API Error:", error)
    return Response.json(
      { error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function GET() {
  const stats = getFleetStats()

  return Response.json({
    service: "Flight Starlink Checker API",
    description: "Check if a United Airlines flight has Starlink WiFi",
    price: { card: `$${CARD_PRICE}`, crypto: `$${CRYPTO_PRICE}` },
    paymentMethods: ["EVM/x402 (USDC on Base)", "Solana (USDC)", "Tempo (USDC)", "Card/Link (Stripe)"],
    usage: {
      method: "POST",
      endpoint: "/api/flight-starlink",
      body: { flightNumber: "string (e.g., 'UA2145')", date: "string (optional, YYYY-MM-DD)" },
    },
    fleetStats: {
      lastUpdated: stats.lastUpdated,
      totalAircraft: stats.totalAircraft,
      byProvider: stats.byProvider,
    },
    supportedAirlines: ["United Airlines (UA)"],
  })
}
