import { getMppx } from "../route"
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, isSupportedAirline } from "@/lib/fleet"
import { NextRequest } from "next/server"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ flightNumber: string }> }
) {
  try {
    const { flightNumber } = await params

    const airlineCode = flightNumber.match(/^([A-Z]{2,3})/i)?.[1]?.toUpperCase() || ""
    if (!isSupportedAirline(airlineCode)) {
      return Response.json(
        { error: "Unsupported airline", supportedAirlines: ["UA"] },
        { status: 400 },
      )
    }

    const flightInfo = await getFlightFromAeroAPI(flightNumber)
    if (!flightInfo) {
      return Response.json({ flightNumber: flightNumber.toUpperCase(), found: false }, { status: 404 })
    }

    const description = `Flight Starlink Check: ${flightNumber.toUpperCase()}`
    const mppx = await getMppx()
    const result = await mppx.compose(
      ["tempo/charge", { amount: "0.01", description }],
      ["evm/charge", { amount: "0.01", description }],
      ["solana/charge", { amount: "10000", description }] as any,
      ["stripe/charge", { amount: "0.50", description }],
    )(request)

    if (result.status === 402) return result.challenge

    const tailNumber = flightInfo.tailNumber
    const aircraftInfo = tailNumber ? getAircraftWifiProvider(tailNumber) : null

    return result.withReceipt(
      Response.json({
        flightNumber: flightInfo.flightNumber,
        origin: flightInfo.origin,
        destination: flightInfo.destination,
        departureTime: flightInfo.departureTime,
        status: flightInfo.status,
        tailNumber,
        hasStarlink: aircraftInfo?.hasStarlink ?? null,
        wifiProvider: aircraftInfo?.wifiProvider ?? "Unknown",
      }),
    )
  } catch (error) {
    console.error("API Error:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
