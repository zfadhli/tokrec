import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RecordEvent } from "../src/lib/config"
import type { Logger } from "../src/lib/logger"
import { createRecordingJob } from "../src/session/job"

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} }
const dirs: string[] = []

function tempFile(name: string, bytes = 10): string {
  const dir = mkdtempSync(join(tmpdir(), "tokrec-job-"))
  dirs.push(dir)
  const file = join(dir, name)
  writeFileSync(file, "x".repeat(bytes))
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("RecordingJob", () => {
  test("conversion emits start → end → convert done and returns the mp4", async () => {
    const input = tempFile("stream.ts")
    const events: RecordEvent[] = []
    const job = createRecordingJob({
      result: { file: input, duration: 12, size: 10 },
      cfg: { segmentMinutes: 0 },
      logger,
      converter: {
        convert: async (file) => file.replace(/\.ts$/, ".mp4"),
        segment: async () => "",
      },
      audioNormalizer: null,
      signal: new AbortController().signal,
      emitRecord: (event) => events.push(event),
      emitProgress: () => {},
      emitFailure: () => {},
      setState: () => {},
    })

    const files = await job.finish()
    expect(files).toEqual([{ file: input.replace(/\.ts$/, ".mp4"), duration: 12, size: 10 }])
    expect(
      events.map((event) => `${event.phase}:${"status" in event ? event.status : ""}`),
    ).toEqual(["convert:start", "end:", "convert:done"])
  })

  test("segmenting uses the ffmpeg CSV list for names, durations, and utimes", async () => {
    const input = tempFile("stream.ts")
    const mtime = new Date("2026-01-01T00:00:00Z")
    utimesSync(input, mtime, mtime)
    const events: RecordEvent[] = []

    const job = createRecordingJob({
      result: { file: input, duration: 3, size: 10 },
      cfg: { segmentMinutes: 1 },
      logger,
      converter: {
        convert: async (file) => file,
        segment: async (_input, segmentSeconds, outputPattern) => {
          expect(segmentSeconds).toBe(60)
          const first = outputPattern.replace("%d", "1")
          const second = outputPattern.replace("%d", "2")
          writeFileSync(first, "1")
          writeFileSync(second, "2")
          return `${first},0,2\n${second},2,3\n`
        },
      },
      audioNormalizer: null,
      signal: new AbortController().signal,
      emitRecord: (event) => events.push(event),
      emitProgress: () => {},
      emitFailure: () => {},
      setState: () => {},
    })

    const files = await job.finish()
    expect(files.map((file) => file.file.split("/").pop())).toEqual([
      "stream_part1.mp4",
      "stream_part2.mp4",
    ])
    expect(files.map((file) => file.duration)).toEqual([2, 1])
    expect(events.filter((event) => event.phase === "segment")).toEqual([
      expect.objectContaining({ status: "start" }),
      { phase: "segment", status: "end", segments: 2 },
    ])

    const firstMtime = statSync(join(files[0]?.file ?? "")).mtimeMs
    expect(Math.abs(firstMtime - (mtime.getTime() - 3000))).toBeLessThan(1000)
  })
})
