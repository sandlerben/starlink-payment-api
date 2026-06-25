/**
 * Fleet Data Lookup
 * 
 * Reads scraped fleet data and provides WiFi provider lookup by tail number.
 */

import fleetData from "@/data/fleet.json"

export type WifiProvider = "Starlink" | "Viasat" | "Panasonic" | "Thales" | "None" | "Unknown"

export interface AircraftInfo {
  tailNumber: string
  wifiProvider: WifiProvider
  hasStarlink: boolean
  lastUpdated: string
}

/**
 * Look up WiFi provider by tail number
 */
export function getAircraftWifiProvider(tailNumber: string): AircraftInfo | null {
  const normalized = tailNumber.toUpperCase().trim()
  
  const aircraft = (fleetData.aircraft as Record<string, { provider: string; scrapedAt: string }>)[normalized]
  
  if (!aircraft) {
    return null
  }
  
  const provider = aircraft.provider as WifiProvider
  
  return {
    tailNumber: normalized,
    wifiProvider: provider,
    hasStarlink: provider === "Starlink",
    lastUpdated: aircraft.scrapedAt
  }
}

/**
 * Get fleet statistics
 */
export function getFleetStats() {
  const aircraft = fleetData.aircraft as Record<string, { provider: string }>
  
  const stats: Record<string, number> = {}
  
  for (const data of Object.values(aircraft)) {
    stats[data.provider] = (stats[data.provider] || 0) + 1
  }
  
  return {
    lastUpdated: fleetData.lastUpdated,
    totalAircraft: fleetData.totalAircraft,
    byProvider: stats
  }
}

/**
 * Check if we have data for this airline (based on tail number prefix patterns)
 */
export function isSupportedAirline(airlineCode: string): boolean {
  // Currently we only have United data
  const supportedAirlines = ["UA", "UAL"]
  return supportedAirlines.includes(airlineCode.toUpperCase())
}
