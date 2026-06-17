import { describe, expect, test } from "bun:test"
import { findStreamUrlRecursively } from "../src/core/api/tiktok"

describe("findStreamUrlRecursively", () => {
  test("finds direct FLV URL in a simple object", () => {
    const obj = { url: "https://example.com/stream.flv?token=abc" }
    expect(findStreamUrlRecursively(obj)).toBe("https://example.com/stream.flv?token=abc")
  })

  test("finds direct HLS URL", () => {
    const obj = { url: "https://example.com/stream.m3u8" }
    expect(findStreamUrlRecursively(obj)).toBe("https://example.com/stream.m3u8")
  })

  test("finds URL nested deeply in objects", () => {
    const obj = {
      a: {
        b: {
          c: {
            main: { flv: "https://cdn.example.com/live/stream_hd.flv?expire=123&sign=abc" },
          },
        },
      },
    }
    expect(findStreamUrlRecursively(obj)).toBe(
      "https://cdn.example.com/live/stream_hd.flv?expire=123&sign=abc",
    )
  })

  test("finds URL inside a JSON string (stream_data pattern)", () => {
    const obj = {
      stream_data: JSON.stringify({
        data: {
          hd: { main: { flv: "https://pull.example.com/stream_hd.flv?expire=123" } },
          ld: { main: { flv: "https://pull.example.com/stream_ld.flv?expire=123" } },
        },
      }),
    }
    // Should find it even though it's a JSON-encoded string
    expect(findStreamUrlRecursively(obj)).toBe("https://pull.example.com/stream_hd.flv?expire=123")
  })

  test("prefers higher quality (hd over ld) in JSON string", () => {
    const obj = {
      stream_data: JSON.stringify({
        data: {
          hd: { main: { flv: "https://example.com/hd.flv" } },
          ld: { main: { flv: "https://example.com/ld.flv" } },
        },
      }),
    }
    expect(findStreamUrlRecursively(obj)).toBe("https://example.com/hd.flv")
  })

  test("tries all quality keys including origin", () => {
    const obj = {
      stream_data: JSON.stringify({
        data: {
          origin: { main: { flv: "https://example.com/origin.flv" } },
        },
      }),
    }
    expect(findStreamUrlRecursively(obj)).toBe("https://example.com/origin.flv")
  })

  test("returns null for offline/no stream", () => {
    const obj = { status: 4, user: { id: "123" } }
    expect(findStreamUrlRecursively(obj)).toBeNull()
  })

  test("searches through arrays", () => {
    const obj = {
      qualities: [{ name: "720p", url: "https://example.com/hd.flv" }],
    }
    expect(findStreamUrlRecursively(obj)).toBe("https://example.com/hd.flv")
  })

  test("handles null and primitive values gracefully", () => {
    expect(findStreamUrlRecursively(null)).toBeNull()
    expect(findStreamUrlRecursively(42)).toBeNull()
    expect(findStreamUrlRecursively("just a string")).toBeNull()
  })
})
