/**
 * HTTP port — the transport contract adapters implement.
 *
 * Ports hold interfaces only: no runtime code, no imports outside `ports/`.
 */

// BodyInit is only available inside declare module "bun" in bun-types, not as a global
// under the ES2022 lib. We explicitly import it to keep lib focused on ES2022.
export type HttpBody = import("bun").BodyInit

export interface HttpClient {
  get: (url: string) => Promise<Response>
  post: (url: string, body?: HttpBody, headers?: Record<string, string>) => Promise<Response>
  close: () => Promise<void>
}
