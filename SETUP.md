# Flight Starlink Checker - Setup Guide

## Overview
This is a payment-protected API that tells you if a given flight has Starlink WiFi. It uses real data from:
1. **United Airlines Fleet Data** - Scraped from their Starlink tracker page
2. **FlightAware AeroAPI** - Real-time flight to aircraft mapping
3. **Payment via Stripe MPP** - Supports crypto and card payments ($0.01 per check)

## Prerequisites

1. **FlightAware API Key** (Free)
   - Sign up at https://flightaware.com/aeroapi
   - Personal tier: 10 requests/minute, no monthly minimum
   - Add your key as environment variable: `FLIGHTAWARE_API_KEY`

2. **Stripe Integration** (Already configured)
   - Supports both card payments and crypto (via MPP protocol)

## Getting Started

```bash
# Install dependencies
pnpm install

# The fleet data is already scraped and stored at data/fleet.json
# To re-scrape (optional):
pnpm tsx scripts/scrape-fleet.ts

# Start dev server
pnpm dev
```

## How It Works

### Data Flow
1. User submits a flight number (e.g., "UA123")
2. API validates payment (returns 402 Payment Required if needed)
3. **FlightAware lookup**: Maps flight → aircraft tail number
4. **Fleet lookup**: Uses tail number to check if aircraft has Starlink
5. Returns result with WiFi provider and availability

### Keeping Data Fresh

**Fleet Data** (Updated quarterly)
```bash
# Re-scrape United's fleet page
pnpm tsx scripts/scrape-fleet.ts

# This updates data/fleet.json with latest aircraft equipment
```

**Flight Data** (Real-time)
- FlightAware API is queried live for each request
- Provides current aircraft assignments

**Maintenance Strategy**
- Schedule weekly re-scrapes to catch equipment updates
- Monitor FlightAware API quota (10 req/min on free tier)
- Consider Supabase for caching results to reduce API calls

## API Endpoint

### GET /api/flight-starlink
Returns available flights for testing and API documentation.

### POST /api/flight-starlink
**Parameters:**
```json
{
  "flightNumber": "UA123",
  "paymentToken": "stripe_token_or_crypto_token"
}
```

**Response (Success):**
```json
{
  "flightNumber": "UA123",
  "tailNumber": "N12345",
  "hasStarlink": true,
  "wifiProvider": "Starlink",
  "airline": "United Airlines"
}
```

**Response (Payment Required):**
```json
{
  "error": "Payment required",
  "amount": "0.01",
  "currency": "USD",
  "mppChallenge": {...}
}
```

## Environment Variables

- `FLIGHTAWARE_API_KEY` - Your FlightAware AeroAPI key
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_PUBLISHABLE_KEY` - Stripe publishable key
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Client-side Stripe key

## Troubleshooting

**"FlightAware API rate limit exceeded"**
- Free tier has 10 requests/minute
- Consider upgrading or implementing caching

**"Flight not found"**
- FlightAware may not have data for that flight number
- Try a real United Airlines flight number

**"Aircraft not in fleet database"**
- Re-run the scraper to get latest data
- Not all aircraft are in the US fleet database

## Future Enhancements

1. **Supabase Caching** - Cache flight→aircraft mappings
2. **Multiple Airlines** - Extend scraper for Delta, American, JetBlue
3. **Historical Data** - Track when aircraft were equipped with Starlink
4. **Webhooks** - Notify users when their flight gets Starlink
