import { defineConfig } from 'mppx/cli'
import { evm } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'

const account = privateKeyToAccount(process.env.MPPX_PRIVATE_KEY as `0x${string}` || '0xfcc6105d8cc4f5b77626a7747e780b5f31a472d9c7d2a733b9dc1e0099cf2e10')

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
