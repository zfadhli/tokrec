/**
 * One cancellation scope per recorder run. Everything that can block accepts
 * `scope.signal`; `close()` aborts in-flight work immediately.
 */

export interface AbortScope {
  readonly signal: AbortSignal
  close(reason?: string): void
}

export function abortScope(parent?: AbortSignal): AbortScope {
  const controller = new AbortController()
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason)
    else parent.addEventListener("abort", () => controller.abort(parent.reason), { once: true })
  }
  return { signal: controller.signal, close: (reason) => controller.abort(reason) }
}
