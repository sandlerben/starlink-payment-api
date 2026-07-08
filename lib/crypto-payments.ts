import "server-only"

import { Receipt } from "mppx"
import { stripe } from "./stripe"

type DepositAddressResponse = {
  id: string
  address: string
  network: string
}

// Cache one deposit address per network for the lifetime of the process
const depositAddressCache = new Map<string, Promise<string>>()

export async function getOrCreateDepositAddress(network: string = "tempo"): Promise<`0x${string}`> {
  if (!depositAddressCache.has(network)) {
    depositAddressCache.set(
      network,
      (async () => {
        // Reuse an existing deposit address if one already exists
        const list = (await stripe.rawRequest("GET", "/v1/crypto/deposit_addresses", {
          network,
          limit: 1,
        })) as { data?: DepositAddressResponse[] }

        if (list.data && list.data.length > 0) {
          console.log(`Reusing deposit address ${list.data[0].id} for network ${network}`)
          return list.data[0].address
        }

        // Create a new one
        const created = (await stripe.rawRequest("POST", "/v1/crypto/deposit_addresses", {
          network,
        })) as DepositAddressResponse

        console.log(`Created deposit address ${created.id} for network ${network}: ${created.address}`)
        return created.address
      })(),
    )
  }

  return depositAddressCache.get(network)! as Promise<`0x${string}`>
}

// Records a settled on-chain transaction as a Stripe PaymentIntent.
// Fire-and-forget: call without await and catch errors so failures don't block the response.
export async function recordCryptoPayment(
  transactionHash: string,
  network: string,
  amountCents: number,
): Promise<void> {
  await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    payment_method_types: ["crypto"],
    payment_method_data: { type: "crypto" },
    payment_method_options: {
      crypto: {
        mode: "transaction_verification",
        transaction_verification_options: {
          transaction_hash: transactionHash,
          network,
        },
      },
    } as unknown as Record<string, unknown>,
    confirm: true,
  })
}

// Extracts the transaction hash from a Payment-Receipt response header, if the method is tempo.
export function extractTempoTxHash(response: Response): string | null {
  const receiptHeader = response.headers.get("Payment-Receipt")
  if (!receiptHeader) return null
  try {
    const receipt = Receipt.deserialize(receiptHeader)
    if (receipt.method === "tempo") return receipt.reference
  } catch {
    // ignore parse errors
  }
  return null
}
