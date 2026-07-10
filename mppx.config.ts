import { defineConfig } from 'mppx/cli'
import { evm } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

if (!process.env.MPPX_PRIVATE_KEY) throw new Error("MPPX_PRIVATE_KEY env var required")
const account = privateKeyToAccount(process.env.MPPX_PRIVATE_KEY as `0x${string}`)

export default defineConfig({
  methods: [
    evm.charge({
      account,
      currencies: [evm.assets.base.USDC, evm.assets.baseSepolia.USDC],
      maxAmount: '1.00',
    }),
  ],
  plugins: [],
})
