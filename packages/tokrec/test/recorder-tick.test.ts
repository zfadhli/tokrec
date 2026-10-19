import { describe, expect, test } from "bun:test"
import { decideTick } from "../src/session/index"
import type { LiveInfo } from "../src/session/probe"

function info(reason: LiveInfo["reason"]): LiveInfo {
  return {
    roomId: "123",
    isLive: reason !== "offline",
    streamUrl: null,
    title: null,
    reason,
    source: "sigi",
  }
}

describe("decideTick", () => {
  test("live → isLive true", () => {
    expect(decideTick(info("live"))).toEqual({ isLive: true, reason: "live" })
  })
  test("restricted → isLive true", () => {
    expect(decideTick(info("restricted"))).toEqual({ isLive: true, reason: "restricted" })
  })
  test("no-stream-url → isLive true", () => {
    expect(decideTick(info("no-stream-url"))).toEqual({ isLive: true, reason: "no-stream-url" })
  })
  test("offline → isLive false", () => {
    expect(decideTick(info("offline"))).toEqual({ isLive: false, reason: "offline" })
  })
  test("no-room-id → isLive false", () => {
    expect(decideTick(info("no-room-id"))).toEqual({ isLive: false, reason: "no-room-id" })
  })
  test("error → isLive false", () => {
    expect(decideTick(info("error"))).toEqual({ isLive: false, reason: "error" })
  })
})
