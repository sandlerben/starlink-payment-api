"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Wifi, WifiOff, Plane, CreditCard, Bitcoin, Loader2, Database, RefreshCw } from "lucide-react"

interface FlightResult {
  success: boolean
  flightNumber: string
  origin?: string
  destination?: string
  departureTime?: string
  arrivalTime?: string
  status?: string
  aircraftType?: string
  tailNumber?: string | null
  hasStarlink?: boolean | null
  wifiProvider?: string
  message: string
  found?: boolean
  dataFreshness?: string
}

interface ApiInfo {
  service: string
  description: string
  price: string
  paymentMethods: string[]
  dataSource: {
    flightInfo: string
    wifiProvider: string
  }
  fleetStats: {
    lastUpdated: string
    totalAircraft: number
    byProvider: Record<string, number>
  }
  supportedAirlines: string[]
  comingSoon: string[]
}

export default function FlightStarlinkChecker() {
  const [flightNumber, setFlightNumber] = useState("")
  const [date, setDate] = useState("")
  const [result, setResult] = useState<FlightResult | null>(null)
  const [apiInfo, setApiInfo] = useState<ApiInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchApiInfo = async () => {
    try {
      const response = await fetch("/api/flight-starlink")
      const data = await response.json()
      setApiInfo(data)
    } catch {
      console.error("Failed to fetch API info")
    }
  }

  useEffect(() => {
    fetchApiInfo()
  }, [])

  const checkFlight = async () => {
    if (!flightNumber.trim()) {
      setError("Please enter a flight number")
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/api/flight-starlink", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          flightNumber: flightNumber.trim(),
          ...(date && { date })
        }),
      })

      const data = await response.json()

      if (response.status === 402) {
        setError(
          `Payment required: ${data.detail || "This API requires payment via MPP protocol. Use the mppx CLI or link-cli to make a payment."}`
        )
        return
      }

      if (!response.ok && response.status !== 404) {
        setError(data.message || data.error || "An error occurred")
        return
      }

      setResult(data)
    } catch {
      setError("Failed to connect to the API")
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString()
    } catch {
      return isoString
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 md:p-12">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <Plane className="h-10 w-10 text-primary" />
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              Flight Starlink Checker
            </h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
            Check if your United flight has Starlink WiFi. Real-time flight data from FlightAware
            combined with aircraft WiFi equipment tracking.
          </p>
        </div>

        {/* Fleet Stats Card */}
        {apiInfo?.fleetStats && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5" />
                United Fleet WiFi Status
              </CardTitle>
              <CardDescription>
                Tracking {apiInfo.fleetStats.totalAircraft.toLocaleString()} aircraft
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(apiInfo.fleetStats.byProvider)
                  .sort((a, b) => b[1] - a[1])
                  .map(([provider, count]) => (
                    <div
                      key={provider}
                      className={`p-3 rounded-lg ${
                        provider === "Starlink"
                          ? "bg-green-500/20 border border-green-500/30"
                          : "bg-muted"
                      }`}
                    >
                      <div className="text-2xl font-bold">{count}</div>
                      <div className="text-sm text-muted-foreground">{provider}</div>
                    </div>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Last updated: {formatDate(apiInfo.fleetStats.lastUpdated)}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Payment Info Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <CreditCard className="h-5 w-5" />
              Payment Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <span className="text-muted-foreground">Price per lookup:</span>
                <span className="ml-2 font-semibold text-foreground">$0.01</span>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Bitcoin className="h-3 w-3" />
                  Crypto (USDC)
                </Badge>
                <Badge variant="secondary" className="flex items-center gap-1">
                  <CreditCard className="h-3 w-3" />
                  Card (SPT)
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search Card */}
        <Card>
          <CardHeader>
            <CardTitle>Check Flight Starlink Status</CardTitle>
            <CardDescription>
              Enter a United Airlines flight number (e.g., UA2145) to check WiFi provider
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <Input
                placeholder="Flight number (e.g., UA2145)"
                value={flightNumber}
                onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && checkFlight()}
                className="flex-1"
              />
              <Input
                type="date"
                placeholder="Date (optional)"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full md:w-44"
              />
              <Button onClick={checkFlight} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  "Check Flight"
                )}
              </Button>
            </div>

            <div className="text-sm text-muted-foreground">
              <span>Currently supported: </span>
              <span className="font-semibold">United Airlines (UA)</span>
              {apiInfo?.comingSoon && (
                <span className="ml-2 text-xs">
                  Coming soon: {apiInfo.comingSoon.join(", ")}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error Display */}
        {error && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="pt-6">
              <p className="text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Result Display */}
        {result && (
          <Card
            className={
              result.hasStarlink === true
                ? "border-green-500/50 bg-green-500/5"
                : result.hasStarlink === false
                  ? "border-orange-500/50 bg-orange-500/5"
                  : "border-muted"
            }
          >
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="flex items-center gap-3">
                  {result.hasStarlink === true ? (
                    <Wifi className="h-6 w-6 text-green-500" />
                  ) : result.hasStarlink === false ? (
                    <WifiOff className="h-6 w-6 text-orange-500" />
                  ) : (
                    <RefreshCw className="h-6 w-6 text-muted-foreground" />
                  )}
                  {result.flightNumber}
                </CardTitle>
                <Badge
                  variant={
                    result.hasStarlink === true
                      ? "default"
                      : result.hasStarlink === false
                        ? "secondary"
                        : "outline"
                  }
                >
                  {result.wifiProvider || "Unknown WiFi"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {result.found === false ? (
                <p className="text-muted-foreground">{result.message}</p>
              ) : (
                <>
                  {/* Flight Details */}
                  <div className="grid grid-cols-2 gap-4">
                    {result.origin && result.destination && (
                      <div>
                        <span className="text-muted-foreground text-sm">Route</span>
                        <p className="font-semibold text-lg">
                          {result.origin} → {result.destination}
                        </p>
                      </div>
                    )}

                    {result.status && (
                      <div>
                        <span className="text-muted-foreground text-sm">Status</span>
                        <p className="font-semibold">{result.status}</p>
                      </div>
                    )}

                    {result.departureTime && (
                      <div>
                        <span className="text-muted-foreground text-sm">Departure</span>
                        <p className="font-medium">{formatDate(result.departureTime)}</p>
                      </div>
                    )}

                    {result.arrivalTime && (
                      <div>
                        <span className="text-muted-foreground text-sm">Arrival</span>
                        <p className="font-medium">{formatDate(result.arrivalTime)}</p>
                      </div>
                    )}
                  </div>

                  {/* Aircraft Details */}
                  {(result.tailNumber || result.aircraftType) && (
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <h4 className="font-semibold mb-2">Aircraft Information</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {result.tailNumber && (
                          <div>
                            <span className="text-muted-foreground">Tail Number:</span>
                            <span className="ml-2 font-mono">{result.tailNumber}</span>
                          </div>
                        )}
                        {result.aircraftType && (
                          <div>
                            <span className="text-muted-foreground">Aircraft:</span>
                            <span className="ml-2">{result.aircraftType}</span>
                          </div>
                        )}
                        {result.wifiProvider && (
                          <div>
                            <span className="text-muted-foreground">WiFi Provider:</span>
                            <span className="ml-2 font-semibold">{result.wifiProvider}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Result Message */}
                  <p
                    className={`text-lg font-medium mt-4 ${
                      result.hasStarlink === true
                        ? "text-green-600 dark:text-green-400"
                        : result.hasStarlink === false
                          ? "text-orange-600 dark:text-orange-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {result.message}
                  </p>

                  {result.dataFreshness && (
                    <p className="text-xs text-muted-foreground">
                      WiFi data last updated: {formatDate(result.dataFreshness)}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Data Sources Card */}
        {apiInfo?.dataSource && (
          <Card>
            <CardHeader>
              <CardTitle>Data Sources</CardTitle>
              <CardDescription>Where we get our flight and WiFi information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-3">
                <Badge variant="outline">Flight Data</Badge>
                <span className="text-sm text-muted-foreground">
                  {apiInfo.dataSource.flightInfo}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="outline">WiFi Provider</Badge>
                <span className="text-sm text-muted-foreground">
                  {apiInfo.dataSource.wifiProvider}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* API Documentation Card */}
        <Card>
          <CardHeader>
            <CardTitle>API Documentation</CardTitle>
            <CardDescription>How to use this payment-protected API</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <h4 className="font-semibold">Endpoint</h4>
              <code className="block p-3 bg-muted rounded-lg text-sm">
                POST /api/flight-starlink
              </code>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold">Request Body</h4>
              <pre className="p-3 bg-muted rounded-lg text-sm overflow-x-auto">
                {JSON.stringify({ flightNumber: "UA2145", date: "2026-05-15" }, null, 2)}
              </pre>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold">Testing with MPP CLI</h4>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">For crypto payments:</p>
                <code className="block p-3 bg-muted rounded-lg text-sm whitespace-pre-wrap">
                  npx mppx account create{"\n"}
                  npx mppx account fund{"\n"}
                  npx mppx https://v0-starlink-payment-api.vercel.app/api/flight-starlink --method POST --data
                  {" '{\"flightNumber\":\"UA2145\"}'"}
                </code>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">For card payments (SPT):</p>
                <code className="block p-3 bg-muted rounded-lg text-sm whitespace-pre-wrap">
                  npx @stripe/link-cli auth login{"\n"}
                  npx @stripe/link-cli spend-request create --amount 1 --credential-type
                  shared_payment_token --test --request-approval{"\n"}
                  npx @stripe/link-cli mpp pay https://v0-starlink-payment-api.vercel.app/api/flight-starlink --method
                  POST --data {`'{"flightNumber":"UA2145"}'`}
                </code>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="text-center text-sm text-muted-foreground pt-8 border-t">
          <p>
            Built with{" "}
            <a
              href="https://mpp.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              MPP Protocol
            </a>
            {" | "}
            <a
              href="https://flightaware.com/aeroapi"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              FlightAware AeroAPI
            </a>
            {" | "}
            <a
              href="https://unitedstarlinktracker.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              United Starlink Tracker
            </a>
          </p>
        </footer>
      </div>
    </main>
  )
}
