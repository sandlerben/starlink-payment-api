const PATH_USD = "0x20c0000000000000000000000000000000000000"

const doc = {
  openapi: "3.1.0",
  info: {
    title: "Flight Starlink Checker API",
    version: "1.0.0",
  },
  "x-service-info": {
    categories: ["data", "travel"],
    docs: {
      homepage: "https://v0-starlink-payment-api.vercel.app",
    },
  },
  paths: {
    "/api/flight-starlink": {
      post: {
        summary: "Check if a United Airlines flight has Starlink WiFi",
        "x-payment-info": {
          method: "tempo",
          intent: "charge",
          amount: "10000",
          currency: PATH_USD,
          description: "Check if a United Airlines flight has Starlink WiFi ($0.01 crypto / $0.50 card)",
        },
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["flightNumber"],
                properties: {
                  flightNumber: {
                    type: "string",
                    example: "UA2145",
                  },
                  date: {
                    type: "string",
                    example: "2026-06-25",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Flight found with Starlink WiFi status" },
          "402": { description: "Payment required" },
          "400": { description: "Missing or unsupported flight number" },
          "404": { description: "Flight not found in FlightAware" },
        },
      },
    },
  },
}

export function GET() {
  return Response.json(doc)
}
