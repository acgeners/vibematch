import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildTasteProfileHeuristic } from "./taste-profile-heuristic"
import { computeInputHash } from "./taste-profile"
import { getRatedWorksForProfile } from "@/server/queries/recommendations"
import { classifyProfileStaleness, type HeuristicFingerprint } from "./profile-staleness"
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
 *
 * ⚠️ O GATE em si (limiares + `classifyProfileStaleness` + a escada de exibição) mora
 * em `./profile-staleness`, que é PURO: o card do perfil é client component e precisa
 * dos mesmos números pra desenhar a barra. Este arquivo re-exporta tudo — importar de
 * qualquer um dos dois dá a mesma coisa, mas só o puro serve pro cliente.
 */
export * from "./profile-staleness"

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

export interface ProfileDriftResult {
  /** false quando não há fingerprint salvo (perfil antigo / pré-migration) → drift desconhecido. */
  available: boolean
  /** perfil considerado desatualizado pelo gate composto (drift ∨ fração ∨ idade). */
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

  const { data: row, error } = await supabase
    .from("taste_profile")
    .select("input_hash, heuristic_fingerprint, n_works_used, created_at")
    .eq("is_current", true)
    .maybeSingle()
  if (error || !row) return base
  const r = row as { input_hash: string; heuristic_fingerprint: HeuristicFingerprint | null; n_works_used: number; created_at: string }

  const st = classifyProfileStaleness({
    savedFingerprint: r.heuristic_fingerprint ?? null,
    currentFingerprint: computeHeuristicFingerprint(rated),
    savedInputHash: r.input_hash,
    currentInputHash: computeInputHash(rated),
    savedNWorks: r.n_works_used ?? 0,
    currentNWorks: rated.length,
    savedCreatedAt: r.created_at ?? null,
    nowMs: Date.now(),
  })
  // available=false quando não há fingerprint (drift heurístico não medível);
  // stale ainda reflete o gate (que cai no legado do input_hash nesse caso).
  return {
    available: r.heuristic_fingerprint != null,
    stale: st.stale,
    driftPct: st.driftPct,
    lovedJaccard: st.lovedJaccard,
    avoidedJaccard: st.avoidedJaccard,
    changedTags: st.changedTags,
    ratedNow: rated.length,
  }
}
