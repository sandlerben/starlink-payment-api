import crypto from "crypto"
import { evm, Mppx, stripe as stripeMpp, tempo } from "mppx/server"
import { solana } from "@solana/mpp/server"
import { facilitator as cdpFacilitator } from "@coinbase/x402"
import { getFlightFromAeroAPI } from "@/lib/flightaware"
import { getAircraftWifiProvider, isSupportedAirline } from "@/lib/fleet"
import { extractCryptoTxHash, getOrCreateDepositAddress, recordCryptoPayment } from "@/lib/crypto-payments"
import { NextRequest } from "next/server"

const mppSecretKey = process.env.MPP_SECRET_KEY || crypto.randomBytes(32).toString("base64")

const PATH_USD_TESTNET = "0x20c0000000000000000000000000000000000000"
const PATH_USD_MAINNET = "0x20c000000000000000000000b9537d11c60e8b50"
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

const CARD_PRICE = "0.50"
const CRYPTO_PRICE = "0.01"

const x402Facilitator = (() => {
  const { url, createAuthHeaders } = cdpFacilitator
  return {
    async verify(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      const response = await fetch(`${url}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers.verify },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })
      return response.json()
    },
    async settle(paymentPayload: unknown, paymentRequirements: unknown) {
      const headers = await createAuthHeaders()
      const response = await fetch(`${url}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers.settle },
        body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
      })
      return response.json()
    },
  }
})()

// GET /api/flight-starlink/UA2145 - x402-compatible paid GET endpoint
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ flightNumber: string }> }
) {
  try {
    const { flightNumber } = await params
    const isTestnet = process.env.TEMPO_TESTNET === "true"

    const airlineMatch = flightNumber.match(/^([A-Z]{2,3})/i)
    const airlineCode = airlineMatch?.[1]?.toUpperCase() || ""

    if (!isSupportedAirline(airlineCode)) {
      return Response.json(
        { error: "Unsupported airline", supportedAirlines: ["UA"] },
        { status: 400 }
      )
    }

    const description = `Flight Starlink Check: ${flightNumber.toUpperCase()}`

    const [tempoRecipient, baseRecipient, solanaRecipient] = await Promise.all([
      getOrCreateDepositAddress("tempo").catch(() => null),
      getOrCreateDepositAddress("base").catch(() => null),
      getOrCreateDepositAddress("solana").catch(() => null),
    ])

    const recipientAddress: `0x${string}` | null =
      tempoRecipient ?? (process.env.TEMPO_RECIPIENT_ADDRESS as `0x${string}` | undefined) ?? null

    const realm = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? undefined

    const methods = [
      ...(baseRecipient
        ? [evm.charge({
            currency: isTestnet ? evm.assets.baseSepolia.USDC : evm.assets.base.USDC,
            recipient: baseRecipient,
            x402: { facilitator: x402Facilitator },
          })]
        : []),
      ...(solanaRecipient
        ? [solana.charge({
            recipient: solanaRecipient,
            currency: SOLANA_USDC,
            decimals: 6,
            network: isTestnet ? "devnet" : "mainnet-beta",
          })]
        : []),
      ...(recipientAddress
        ? [tempo.charge({
            currency: isTestnet ? PATH_USD_TESTNET : PATH_USD_MAINNET,
            recipient: recipientAddress,
            testnet: isTestnet,
          })]
        : []),
      stripeMpp.charge({
        networkId: process.env.STRIPE_PROFILE_ID || "internal",
        paymentMethodTypes: ["card", "link"],
        secretKey: process.env.STRIPE_SECRET_KEY!,
      }),
    ]

    const mppx = Mppx.create({ methods, realm, secretKey: mppSecretKey })

    const cryptoOpts = { amount: CRYPTO_PRICE, description } as const
    const cardOpts = { amount: CARD_PRICE, currency: 'usd', decimals: 2, description } as const

    const result = await mppx.compose(
      ...[
        baseRecipient && ['evm/charge', cryptoOpts],
        solanaRecipient && ['solana/charge', cryptoOpts],
        recipientAddress && ['tempo/charge', cryptoOpts],
        ['stripe/charge', cardOpts],
      ].filter(Boolean),
    )(request)

    if (result.status === 402) {
      return result.challenge
    }

    const withReceiptAndRecord = (response: Response) => {
      const finalResponse = result.withReceipt(response)
      const cryptoTx = extractCryptoTxHash(finalResponse)
      if (cryptoTx) {
        recordCryptoPayment(cryptoTx.hash, cryptoTx.network, 1)
          .catch((err) => console.error("Failed to record crypto payment:", err))
      }
      return finalResponse
    }

    const flightInfo = await getFlightFromAeroAPI(flightNumber)

    if (!flightInfo) {
      return withReceiptAndRecord(
        Response.json({ flightNumber: flightNumber.toUpperCase(), found: false }, { status: 404 })
      )
    }

    const tailNumber = flightInfo.tailNumber
    const aircraftInfo = tailNumber ? getAircraftWifiProvider(tailNumber) : null

    return withReceiptAndRecord(
      Response.json({
        flightNumber: flightInfo.flightNumber,
        origin: flightInfo.origin,
        destination: flightInfo.destination,
        departureTime: flightInfo.departureTime,
        status: flightInfo.status,
        tailNumber,
        hasStarlink: aircraftInfo?.hasStarlink ?? null,
        wifiProvider: aircraftInfo?.wifiProvider ?? "Unknown",
      })
    )
  } catch (error) {
    console.error("API Error:", error)
    return Response.json(
      { error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
