// Mock flight database with Starlink availability info
export interface Flight {
  flightNumber: string
  airline: string
  aircraft: string
  route: {
    departure: string
    arrival: string
  }
  hasStarlink: boolean
  starlinkDetails?: {
    speed: string
    availability: string
    coverage: string
  }
}

// Sample flight data - in production this would come from a real database
export const flights: Record<string, Flight> = {
  UA123: {
    flightNumber: "UA123",
    airline: "United Airlines",
    aircraft: "Boeing 737 MAX 9",
    route: {
      departure: "San Francisco (SFO)",
      arrival: "New York (JFK)",
    },
    hasStarlink: true,
    starlinkDetails: {
      speed: "Up to 350 Mbps",
      availability: "Full flight coverage",
      coverage: "Continental US + Atlantic approach",
    },
  },
  DL456: {
    flightNumber: "DL456",
    airline: "Delta Air Lines",
    aircraft: "Airbus A321neo",
    route: {
      departure: "Los Angeles (LAX)",
      arrival: "Miami (MIA)",
    },
    hasStarlink: false,
  },
  AA789: {
    flightNumber: "AA789",
    airline: "American Airlines",
    aircraft: "Boeing 787-9",
    route: {
      departure: "Dallas (DFW)",
      arrival: "London (LHR)",
    },
    hasStarlink: true,
    starlinkDetails: {
      speed: "Up to 220 Mbps",
      availability: "Partial coverage over Atlantic",
      coverage: "Continental US + Transatlantic corridor",
    },
  },
  SW101: {
    flightNumber: "SW101",
    airline: "Southwest Airlines",
    aircraft: "Boeing 737-800",
    route: {
      departure: "Chicago (ORD)",
      arrival: "Denver (DEN)",
    },
    hasStarlink: false,
  },
  JB202: {
    flightNumber: "JB202",
    airline: "JetBlue Airways",
    aircraft: "Airbus A320",
    route: {
      departure: "Boston (BOS)",
      arrival: "Los Angeles (LAX)",
    },
    hasStarlink: true,
    starlinkDetails: {
      speed: "Up to 300 Mbps",
      availability: "Full flight coverage",
      coverage: "Transcontinental US",
    },
  },
}

export function getFlightInfo(flightNumber: string): Flight | null {
  const normalizedFlightNumber = flightNumber.toUpperCase().replace(/\s/g, "")
  return flights[normalizedFlightNumber] || null
}

export function getAllFlightNumbers(): string[] {
  return Object.keys(flights)
}
