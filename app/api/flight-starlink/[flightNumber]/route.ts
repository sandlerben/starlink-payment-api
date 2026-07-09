import { handlePayment } from "@/lib/payments"
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, isSupportedAirline } from "@/lib/fleet"
import { NextRequest } from "next/server"

// x402-compatible GET endpoint: GET /api/flight-starlink/UA2145
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ flightNumber: string }> }
) {
  try {
    const { flightNumber } = await params

    const airlineCode = flightNumber.match(/^([A-Z]{2,3})/i)?.[1]?.toUpperCase() || ""
    if (!isSupportedAirline(airlineCode)) {
      return Response.json({ error: "Unsupported airline", supportedAirlines: ["UA"] }, { status: 400 })
    }

    const payment = await handlePayment(request, `Flight Starlink Check: ${flightNumber.toUpperCase()}`)
    if (!payment.paid) return payment.challenge

    const flightInfo = await getFlightFromAeroAPI(flightNumber)
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
      status: flightInfo.status,
      tailNumber,
      hasStarlink: aircraftInfo?.hasStarlink ?? null,
      wifiProvider: aircraftInfo?.wifiProvider ?? "Unknown",
    }))
  } catch (error) {
    console.error("API Error:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
