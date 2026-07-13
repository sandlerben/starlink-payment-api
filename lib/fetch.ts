type FetchOptions = RequestInit & {
  retries?: number
  retryDelay?: number
  timeout?: number
}

export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { retries = 2, retryDelay = 500, timeout = 10000, ...fetchOptions } = options

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      })

      clearTimeout(timer)

      if ((response.status >= 500 || response.status === 429) && attempt < retries) {
        console.warn(`[fetch] ${url} returned ${response.status}, retrying (${attempt + 1}/${retries})`)
        await sleep(retryDelay * (attempt + 1))
        continue
      }

      return response
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError"
      const label = isTimeout ? "timeout" : "network error"

      if (attempt < retries) {
        console.warn(`[fetch] ${url} ${label}, retrying (${attempt + 1}/${retries})`)
        await sleep(retryDelay * (attempt + 1))
        continue
      }

      console.error(`[fetch] ${url} ${label} after ${retries + 1} attempts`)
      throw error
    }
  }

  throw new Error(`[fetch] ${url} failed after ${retries + 1} attempts`)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
