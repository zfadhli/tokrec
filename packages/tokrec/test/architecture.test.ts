/**
 * Architecture guardrail — freezes the layer bands in `src/`.
 *
 * The bands are the design (docs/architecture-proposal.html §8). This test is
 * the convention: cross-band imports, I/O in the pure bands, import cycles, and
 * a barrel that leaks internals all fail here instead of in review.
 *
 * Type-only edges are exempt: they erase at compile time and cannot couple
 * runtime behaviour. That exemption is what lets `lib/config.ts` borrow
 * `LiveReason` from `domain/verdict.ts` until config itself moves into `domain/`.
 */

import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

const SRC = resolve(import.meta.dir, "..", "src")

type Zone = "domain" | "policy" | "ports" | "adapters" | "session" | "lib" | "root"

/** Which zones each zone may import. Same-zone edges are always allowed. */
const ALLOWED: Record<Zone, Zone[]> = {
  domain: ["domain"],
  policy: ["domain", "policy"],
  ports: ["ports"],
  adapters: ["domain", "ports", "lib", "adapters"],
  session: ["domain", "policy", "ports", "adapters", "lib", "session"],
  lib: ["lib"],
  root: ["domain", "policy", "ports", "adapters", "session", "lib"],
}

/** Pure bands: no Node/Bun built-ins, directly or transitively by convention. */
const PURE: Zone[] = ["domain", "policy"]

interface Edge {
  from: string
  to: string
  fromZone: Zone
  toZone: Zone
  spec: string
  typeOnly: boolean
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return walk(path)
    return path.endsWith(".ts") ? [path] : []
  })
}

function zoneOf(file: string): Zone {
  const head = relative(SRC, file).split(sep)[0]
  const zones: Zone[] = ["domain", "policy", "ports", "adapters", "session", "lib"]
  return zones.find((zone) => zone === head) ?? "root"
}

function resolveSpecifier(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec)
  if (existsSync(`${base}.ts`)) return `${base}.ts`
  if (existsSync(join(base, "index.ts"))) return join(base, "index.ts")
  return null
}

const STATEMENT = /^[ \t]*(?:import|export)\s+(type\s+)?[\s\S]*?\bfrom\s+["']([^"']+)["']/gm

const files = walk(SRC)

const edges: Edge[] = files.flatMap((file) => {
  const source = readFileSync(file, "utf8")
  return [...source.matchAll(STATEMENT)].flatMap(([, typeOnly, spec]) => {
    if (spec === undefined || !spec.startsWith(".")) return []
    const to = resolveSpecifier(file, spec)
    if (!to) throw new Error(`${relative(SRC, file)}: unresolvable relative import "${spec}"`)
    return [
      {
        from: file,
        to,
        fromZone: zoneOf(file),
        toZone: zoneOf(to),
        spec,
        typeOnly: typeOnly !== undefined,
      },
    ]
  })
})

const runtimeEdges = edges.filter((edge) => !edge.typeOnly)

describe("architecture — bands", () => {
  test("every runtime import crosses only allowed bands", () => {
    const violations = runtimeEdges
      .filter((edge) => !ALLOWED[edge.fromZone].includes(edge.toZone))
      .map(
        (edge) => `${relative(SRC, edge.from)} (${edge.fromZone}) → ${edge.spec} (${edge.toZone})`,
      )
    expect(violations).toEqual([])
  })

  test("domain/ and policy/ import no node:* or bun:* module", () => {
    const violations = files
      .filter((file) => PURE.includes(zoneOf(file)))
      .flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(STATEMENT)]
          .map(([, , spec]) => spec)
          .filter((spec) => spec !== undefined && /^(node|bun):/.test(spec))
          .map((spec) => `${relative(SRC, file)} → ${spec}`),
      )
    expect(violations).toEqual([])
  })

  test("no import cycle", () => {
    const graph = new Map<string, string[]>()
    for (const edge of runtimeEdges) {
      graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge.to])
    }

    const state = new Map<string, "visiting" | "done">()
    const stack: string[] = []
    const cycles: string[] = []

    const visit = (file: string) => {
      if (state.get(file) === "done") return
      if (state.get(file) === "visiting") {
        cycles.push(
          [...stack.slice(stack.indexOf(file)), file].map((f) => relative(SRC, f)).join(" → "),
        )
        return
      }
      state.set(file, "visiting")
      stack.push(file)
      for (const next of graph.get(file) ?? []) visit(next)
      stack.pop()
      state.set(file, "done")
    }

    for (const file of files) visit(file)
    expect(cycles).toEqual([])
  })

  test("index.ts exports only from domain/, session/, lib/", () => {
    const barrel = join(SRC, "index.ts")
    const violations = [...readFileSync(barrel, "utf8").matchAll(STATEMENT)]
      .map(([, , spec]) => spec)
      .filter((spec): spec is string => spec?.startsWith(".") === true)
      .map((spec) => {
        const to = resolveSpecifier(barrel, spec)
        if (!to) throw new Error(`index.ts: unresolvable export "${spec}"`)
        return { spec, zone: zoneOf(to) }
      })
      .filter(({ zone }) => !["domain", "session", "lib"].includes(zone))
      .map(({ spec, zone }) => `${spec} (${zone})`)
    expect(violations).toEqual([])
  })
})
