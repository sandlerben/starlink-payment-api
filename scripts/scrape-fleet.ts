/**
 * Fleet Data Scraper
 * 
 * Scrapes unitedstarlinktracker.com/fleet to extract tail numbers and WiFi providers.
 * Run this script daily/weekly via cron to keep data fresh.
 * 
 * Usage: npx tsx scripts/scrape-fleet.ts
 */

import { writeFileSync } from "fs"
import { join } from "path"

interface FleetData {
  [tailNumber: string]: {
    provider: string
    scrapedAt: string
  }
}

async function scrapeFleet(): Promise<FleetData> {
  console.log("Fetching fleet data from unitedstarlinktracker.com/fleet...")
  
  const response = await fetch("https://unitedstarlinktracker.com/fleet")
  
  if (!response.ok) {
    throw new Error(`Failed to fetch fleet page: ${response.status}`)
  }
  
  const html = await response.text()
  
  // Extract title="N501GJ · Starlink" patterns
  const titleRegex = /title="(N[A-Z0-9]+)\s*·\s*([^"]+)"/g
  const fleetData: FleetData = {}
  
  let match
  while ((match = titleRegex.exec(html)) !== null) {
    const tailNumber = match[1].trim()
    const provider = match[2].trim()
    
    fleetData[tailNumber] = {
      provider: provider === "?" ? "Unknown" : provider,
      scrapedAt: new Date().toISOString()
    }
  }
  
  const count = Object.keys(fleetData).length
  console.log(`Extracted ${count} aircraft records`)
  
  // Count by provider
  const providerCounts: Record<string, number> = {}
  for (const data of Object.values(fleetData)) {
    providerCounts[data.provider] = (providerCounts[data.provider] || 0) + 1
  }
  
  console.log("\nBreakdown by provider:")
  for (const [provider, count] of Object.entries(providerCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${provider}: ${count}`)
  }
  
  return fleetData
}

async function main() {
  try {
    const fleetData = await scrapeFleet()
    
    const outputPath = join(process.cwd(), "data", "fleet.json")
    
    // Ensure data directory exists
    const { mkdirSync } = await import("fs")
    mkdirSync(join(process.cwd(), "data"), { recursive: true })
    
    const output = {
      lastUpdated: new Date().toISOString(),
      totalAircraft: Object.keys(fleetData).length,
      aircraft: fleetData
    }
    
    writeFileSync(outputPath, JSON.stringify(output, null, 2))
    console.log(`\nFleet data saved to ${outputPath}`)
    
  } catch (error) {
    console.error("Scrape failed:", error)
    process.exit(1)
  }
}

main()
