import "server-only"

import crypto from "crypto"
import { Mppx, stripe as stripeMpp } from "mppx/server"

const mppSecretKey = process.env.MPP_SECRET_KEY || crypto.randomBytes(32).toString("base64")

export function createMppHandler() {
  return Mppx.create({
    methods: [
      stripeMpp.charge({
        networkId: process.env.STRIPE_PROFILE_ID!,
        paymentMethodTypes: ["card", "link", "crypto"],
        secretKey: process.env.STRIPE_SECRET_KEY!,
      }),
    ],
    secretKey: mppSecretKey,
  })
}

export { mppSecretKey }
