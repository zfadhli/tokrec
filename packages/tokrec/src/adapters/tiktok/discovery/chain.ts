import type { Evidence, EvidenceOutcome } from "../../../domain/verdict"
import type { Candidate, DiscoverySource, ResolveContext } from "./types"

function outcomeOf(candidate: Candidate): EvidenceOutcome {
  switch (candidate.kind) {
    case "room":
      return "hit"
    case "denied":
      return "denied"
    case "failed":
      return "error"
    case "miss":
      return "miss"
  }
}

/**
 * Run discovery sources in order. A throw — sync or async — becomes a
 * `failed` candidate and the chain continues: the `probe.ts:154` dead end,
 * inverted. A room or a gate refusal ends the chain; the first failure
 * outranks a later miss.
 */
export async function discover(
  sources: readonly DiscoverySource[],
  ctx: ResolveContext,
): Promise<{ candidate: Candidate; evidence: Evidence[] }> {
  const evidence: Evidence[] = []
  let best: Candidate = { kind: "miss", note: "no sources configured" }

  for (const source of sources) {
    const candidate = await (async (): Promise<Candidate> => {
      try {
        return await source.find(ctx)
      } catch (error) {
        ctx.debug(
          `discover: ${source.id} threw — ${error instanceof Error ? error.message : error}`,
        )
        return { kind: "failed", error: error instanceof Error ? error : new Error(String(error)) }
      }
    })()
    evidence.push({
      source:
        candidate.kind === "room" || candidate.kind === "denied" ? candidate.source : source.id,
      outcome: outcomeOf(candidate),
    })
    if (candidate.kind === "room" || candidate.kind === "denied") return { candidate, evidence }
    // First failure is the root cause; a later failure must not overwrite it.
    if (candidate.kind === "failed" && best.kind !== "failed") best = candidate
  }

  return { candidate: best, evidence }
}
