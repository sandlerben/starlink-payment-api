import "server-only"

import { Credential } from "mppx"
import NodeCache from "node-cache"
import { stripe } from "./stripe"

// In-memory cache for deposit addresses (TTL: 5 minutes)
// NOTE: For production, use a distributed cache like Redis
const paymentCache = new NodeCache({ stdTTL: 300, checkperiod: 60 })

export async function createPayToAddress(request: Request): Promise<`0x${string}`> {
  const authHeader = request.headers.get("authorization")

  // If there's already a payment credential, extract the address from it
  if (authHeader && Credential.extractPaymentScheme(authHeader)) {
    const credential = Credential.fromRequest(request)
    const toAddress = credential.challenge.request.recipient as `0x${string}`

    if (!toAddress) {
      throw new Error("PaymentIntent did not return expected crypto deposit details")
    }
    if (!paymentCache.has(toAddress)) {
      throw new Error("Invalid payTo address: not found in server cache")
    }
    return toAddress
  }

  // Create a new PaymentIntent for crypto deposit
  const decimals = 6
  const amountInCents = Number(10000) / 10 ** (decimals - 2) // $0.10 for API access

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: "usd",
    payment_method_types: ["crypto"],
    payment_method_data: {
      type: "crypto",
    },
    payment_method_options: {
      crypto: {
        mode: "deposit",
        deposit_options: {
          networks: ["tempo"],
        },
      },
    } as unknown as Record<string, unknown>,
    confirm: true,
  })

  if (
    !paymentIntent.next_action ||
    !("crypto_display_details" in paymentIntent.next_action)
  ) {
    throw new Error("PaymentIntent did not return expected crypto deposit details")
  }

  const depositDetails = paymentIntent.next_action.crypto_display_details as unknown as {
    deposit_addresses?: Record<string, { address?: string }>
  }
  const payToAddress = depositDetails.deposit_addresses?.tempo?.address

  if (!payToAddress) {
    throw new Error("PaymentIntent did not return expected crypto deposit details")
  }

  console.log(
    `Created PaymentIntent ${paymentIntent.id} for $${(amountInCents / 100).toFixed(2)} -> ${payToAddress}`
  )

  paymentCache.set(payToAddress, true)
  return payToAddress as `0x${string}`
}
