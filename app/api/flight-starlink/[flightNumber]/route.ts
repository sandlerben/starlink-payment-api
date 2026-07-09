import { StripeMPP } from "stripe-mpp"
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, isSupportedAirline } from "@/lib/fleet"
import { NextRequest } from "next/server"

const mpp = await StripeMPP.create({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  profileId: process.env.STRIPE_PROFILE_ID || "internal",
})

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

    const flightInfo = await getFlightFromAeroAPI(flightNumber)
    if (!flightInfo) {
      return Response.json({ flightNumber: flightNumber.toUpperCase(), found: false }, { status: 404 })
    }

    const result = await mpp.handlePayment(request, {
      amount: (method) => method === "stripe/charge" ? "0.50" : "0.01",
      description: `Flight Starlink Check: ${flightNumber.toUpperCase()}`,
    })

    if (result.status === 402) return result.challenge

    const tailNumber = flightInfo.tailNumber
    const aircraftInfo = tailNumber ? getAircraftWifiProvider(tailNumber) : null

    return result.withReceipt(Response.json({
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
