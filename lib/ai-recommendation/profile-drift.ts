import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildTasteProfileHeuristic } from "./taste-profile-heuristic"
import { computeInputHash } from "./taste-profile"
import { getRatedWorksForProfile } from "@/server/queries/recommendations"
import type { RatedWorkInput, ProfileTag } from "./types"

/**
 * DRIFT do perfil — método-free. O perfil LLM é caro de regenerar (~$0,40: re-destila
 * o catálogo rotulado inteiro). Pra saber se vale a pena, gravamos no momento da
 * geração um FINGERPRINT determinístico (heurístico — grátis) e, depois, comparamos
 * com o heurístico ATUAL. Como ambos são heurísticos, a diferença isola o quanto as
 * mudanças acumuladas moveram o gosto (sem o ruído de método heurístico×LLM).
 *
 * Ressalva: o heurístico NÃO lê sinopse → pode não captar mudança de tema. Use como
 * sinal conservador de "imaterial", não como veredito fino.
 */
export interface HeuristicFingerprint {
  /** Tags amadas (nomes lowercased, ordenados) do perfil heurístico no gen. */
  loved: string[]
  avoided: string[]
  /** Critérios com preferência (slugs). */
  criteria: string[]
}

const tagNames = (ts: ProfileTag[] | undefined): string[] =>
  [...new Set((ts ?? []).map((t) => t.name.toLowerCase()))].sort()

/** Fingerprint heurístico de um conjunto de obras rotuladas (determinístico, $0). */
export function computeHeuristicFingerprint(ratedWorks: RatedWorkInput[]): HeuristicFingerprint {
  const h = buildTasteProfileHeuristic(ratedWorks)
  return {
    loved: tagNames(h.loved_tags),
    avoided: tagNames(h.avoided_tags),
    criteria: Object.entries(h.criterion_preferences ?? {})
      .filter(([, v]) => v != null)
      .map(([k]) => k)
      .sort(),
  }
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b)
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  const union = A.size + B.size - inter
  return union === 0 ? 1 : inter / union
}

export interface FingerprintComparison {
  /** 0..1: 1 − média(Jaccard loved, Jaccard avoided). Alto = gosto mudou muito. */
  driftPct: number
  lovedJaccard: number
  avoidedJaccard: number
  /** Nº de tags loved/avoided que entraram ou saíram. */
  changedTags: number
}

/** PURO: compara dois fingerprints heurísticos (gravado × atual). */
export function compareFingerprints(saved: HeuristicFingerprint, now: HeuristicFingerprint): FingerprintComparison {
  const lovedJaccard = jaccard(saved.loved, now.loved)
  const avoidedJaccard = jaccard(saved.avoided, now.avoided)
  const changed = (a: string[], b: string[]) => {
    const A = new Set(a), B = new Set(b)
    return a.filter((x) => !B.has(x)).length + b.filter((x) => !A.has(x)).length
  }
  return {
    driftPct: 1 - (lovedJaccard + avoidedJaccard) / 2,
    lovedJaccard,
    avoidedJaccard,
    changedTags: changed(saved.loved, now.loved) + changed(saved.avoided, now.avoided),
  }
}

export interface ProfileDriftResult {
  /** false quando não há fingerprint salvo (perfil antigo / pré-migration) → drift desconhecido. */
  available: boolean
  /** input_hash diverge do atual (= o app considera o perfil stale). */
  stale: boolean
  /** 0..1: 1 − média(Jaccard loved, Jaccard avoided). Alto = gosto mudou muito. */
  driftPct: number
  lovedJaccard: number
  avoidedJaccard: number
  /** Nº de tags loved/avoided que entraram ou saíram desde o gen. */
  changedTags: number
  ratedNow: number
}

export async function getProfileDrift(): Promise<ProfileDriftResult> {
  const supabase = createAdminClient()
  const rated = await getRatedWorksForProfile()
  const base: ProfileDriftResult = {
    available: false, stale: false, driftPct: 0, lovedJaccard: 1, avoidedJaccard: 1, changedTags: 0, ratedNow: rated.length,
  }

  // input_hash (coluna antiga, sempre existe) → staleness.
  const { data: hashRow } = await supabase
    .from("taste_profile").select("input_hash").eq("is_current", true).maybeSingle()
  if (!hashRow) return base
  const stale = (hashRow as { input_hash: string }).input_hash !== computeInputHash(rated)

  // fingerprint (coluna nova) — tolera ausência (pré-migration) → available=false.
  const { data: fpRow, error } = await supabase
    .from("taste_profile").select("heuristic_fingerprint").eq("is_current", true).maybeSingle()
  const fp = !error ? ((fpRow as { heuristic_fingerprint: HeuristicFingerprint | null } | null)?.heuristic_fingerprint ?? null) : null
  if (!fp) return { ...base, stale }

  const now = computeHeuristicFingerprint(rated)
  return { available: true, stale, ...compareFingerprints(fp, now), ratedNow: rated.length }
}
