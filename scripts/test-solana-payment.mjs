import { createKeyPairSignerFromBytes } from '@solana/kit'
import { solana, Mppx } from '@solana/mpp/client'
import bs58 from 'bs58'
const { decode } = bs58

const SECRET_KEY = process.env.SOLANA_SECRET_KEY || 'E6TEvMrVv29z6sVSLZqV9FWvryFpcbrKtrtfCuh2ccHcrM4xaPnb1hp9DU1qH2ERNGHQjjjikgePYEGuT5GmQQR'
const API_URL = process.env.API_URL || 'https://v0-starlink-payment-api.vercel.app/api/flight-starlink/UA2145'

const secretBytes = decode(SECRET_KEY)
const signer = await createKeyPairSignerFromBytes(secretBytes)
console.log('Signer address:', signer.address)

const mppx = Mppx.create({
  methods: [
    solana.charge({
      signer,
      broadcast: true,
    }),
  ],
})

console.log('Requesting:', API_URL)
const response = await mppx.fetch(API_URL)
console.log('Status:', response.status)
console.log('Payment-Receipt:', response.headers.get('payment-receipt'))
const body = await response.json()
console.log('Response:', JSON.stringify(body, null, 2))
