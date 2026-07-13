const doc = {
  openapi: "3.1.0",
  info: {
    title: "Flight Starlink Checker API",
    version: "2.0.0",
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
        summary: "Check if a flight has Starlink WiFi (POST with body)",
        "x-payment-required": true,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["flightNumber"],
                properties: {
                  flightNumber: { type: "string", example: "UA2145" },
                  date: { type: "string", example: "2026-07-10" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Flight found with Starlink WiFi status" },
          "402": { description: "Payment required" },
          "400": { description: "Missing or unsupported flight number" },
          "404": { description: "Flight not found" },
        },
      },
    },
    "/api/flight-starlink/{flightNumber}": {
      get: {
        summary: "Check if a flight has Starlink WiFi (x402-compatible GET)",
        "x-payment-required": true,
        parameters: [
          {
            name: "flightNumber",
            in: "path",
            required: true,
            schema: { type: "string", example: "UA2145" },
          },
        ],
        responses: {
          "200": { description: "Flight found with Starlink WiFi status" },
          "402": { description: "Payment required" },
          "400": { description: "Unsupported airline" },
          "404": { description: "Flight not found" },
        },
      },
    },
  },
}

export function GET() {
  return Response.json(doc)
}
