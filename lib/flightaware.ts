/**
 * FlightAware AeroAPI Client
 * 
 * Uses the free Personal tier (10 requests/minute).
 * Sign up at: https://flightaware.com/aeroapi
 */

import { fetchWithRetry } from "./fetch"

const AEROAPI_BASE = "https://aeroapi.flightaware.com/aeroapi"

// Map IATA airline codes to ICAO codes (FlightAware uses ICAO)
const IATA_TO_ICAO: Record<string, string> = {
  "UA": "UAL",  // United Airlines
  "DL": "DAL",  // Delta Air Lines
  "AA": "AAL",  // American Airlines
  "SW": "SWA",  // Southwest Airlines
  "WN": "SWA",  // Southwest (alternate code)
  "JB": "JBU",  // JetBlue
  "B6": "JBU",  // JetBlue (alternate code)
  "AS": "ASA",  // Alaska Airlines
  "NK": "NKS",  // Spirit Airlines
  "F9": "FFT",  // Frontier Airlines
  "HA": "HAL",  // Hawaiian Airlines
}

export interface FlightInfo {
  flightNumber: string
  icaoFlightId: string
  tailNumber: string | null
  aircraftType: string | null
  origin: string | null
  destination: string | null
  departureTime: string | null
  arrivalTime: string | null
  status: string | null
}

/**
 * Normalize a flight number to ICAO format
 * UA2145 -> UAL2145
 */
function normalizeFlightNumber(flightNumber: string): string {
  // Extract airline code and number
  const match = flightNumber.match(/^([A-Z]{2,3})(\d+)$/i)
  if (!match) {
    return flightNumber.toUpperCase()
  }
  
  const [, airlineCode, number] = match
  const upperCode = airlineCode.toUpperCase()
  
  // Convert IATA to ICAO if needed
  const icaoCode = IATA_TO_ICAO[upperCode] || upperCode
  
  return `${icaoCode}${number}`
}

/**
 * Get flight information from FlightAware AeroAPI
 */
export async function getFlightFromAeroAPI(
  flightNumber: string,
  date?: string // YYYY-MM-DD format
): Promise<FlightInfo | null> {
  const apiKey = process.env.FLIGHTAWARE_API_KEY
  
  if (!apiKey) {
    console.error("FLIGHTAWARE_API_KEY not set")
    return null
  }
  
  const icaoFlightId = normalizeFlightNumber(flightNumber)
  
  // Build URL with optional date filter
  let url = `${AEROAPI_BASE}/flights/${icaoFlightId}`
  if (date) {
    url += `?start=${date}T00:00:00Z&end=${date}T23:59:59Z`
  }
  
  try {
    const response = await fetchWithRetry(url, {
      headers: {
        "x-apikey": apiKey,
        "Accept": "application/json"
      }
    })

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      console.error(`FlightAware API error: ${response.status}`)
      return null
    }

    const data = await response.json()

    const flights = data.flights || []
    if (flights.length === 0) {
      return null
    }

    const flight = flights.find((f: any) =>
      f.status === "Scheduled" || f.status === "En Route"
    ) || flights[0]

    return {
      flightNumber: flightNumber.toUpperCase(),
      icaoFlightId,
      tailNumber: flight.registration || null,
      aircraftType: flight.aircraft_type || null,
      origin: flight.origin?.code_iata || flight.origin?.code || null,
      destination: flight.destination?.code_iata || flight.destination?.code || null,
      departureTime: flight.scheduled_out || flight.estimated_out || null,
      arrivalTime: flight.scheduled_in || flight.estimated_in || null,
      status: flight.status || null
    }
  } catch (error) {
    console.error("FlightAware API request failed:", error)
    return null
  }
}

/**
 * Get just the tail number for a flight
 */
export async function getTailNumber(
  flightNumber: string,
  date?: string
): Promise<string | null> {
  const flightInfo = await getFlightFromAeroAPI(flightNumber, date)
  return flightInfo?.tailNumber || null
}
