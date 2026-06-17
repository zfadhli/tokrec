/**
 * Token-bucket rate limiter — limits API request frequency to prevent
 * TikTok WAF triggering on rapid polling or URL refresh loops.
 *
 * Design:
 * - Token bucket with configurable refill rate (tokens/sec)
 * - AbortSignal-aware wait so cancellation works through the queue
 * - Thread-safe for cooperative JS concurrency (all awaiters share
 *   the same monotonically-increasing last-token timestamp)
 */

export interface RateLimiter {
  /** Wait until a rate-limit token is available, then consume it. */
  acquire(signal?: AbortSignal): Promise<void>
}

/**
 * Create a token-bucket rate limiter.
 *
 * @param tokensPerSecond  Max sustained requests per second.
 *                         0 or negative = unlimited (no waiting).
 */
export function createRateLimiter(tokensPerSecond: number): RateLimiter {
  // Unlimited mode — no-op acquire
  if (tokensPerSecond <= 0) {
    return { acquire: async () => {} }
  }

  const MIN_INTERVAL_MS = 1000 / tokensPerSecond
  let lastTokenTime = 0

  return {
    async acquire(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) return

      const now = Date.now()
      const waitTime = Math.max(0, lastTokenTime + MIN_INTERVAL_MS - now)

      if (waitTime > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, waitTime)
          if (signal) {
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer)
                resolve()
              },
              { once: true },
            )
          }
        })
      }

      lastTokenTime = Date.now()
    },
  }
}
