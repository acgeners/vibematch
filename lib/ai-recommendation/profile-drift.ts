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

// ---------------------------------------------------------------------------
// Gate de STALENESS por MATERIALIDADE (θ calibrado — ver
// scripts/calibrate-profile-drift-threshold.ts). Substitui o gate binário
// `input_hash` (que marcava stale a CADA edição): acumula alterações e só
// considera desatualizado quando o gosto destilado de fato se move. Enviesado
// LIBERAL — catálogo pré-filtrado ⇒ poucas edições quase nunca movem o perfil.
//
// Composto (OR): magnitude do drift heurístico, OU fração de obras novas (pega
// drift TEMÁTICO que o heurístico não lê — ele ignora sinopse), OU idade (pega
// drift lento + updates de modelo/prompt). `input_hash` deixa de decidir
// staleness, mas continua sendo a IDENTIDADE/dedup da geração.
// ---------------------------------------------------------------------------

/** Drift heurístico (1 − Jaccard médio de tags amadas/evitadas) que marca stale. */
export const PROFILE_DRIFT_THRESHOLD = 0.15
/** |ΔnObras| / nObras_geração que marca stale (rede p/ o ponto cego temático). */
export const PROFILE_STALE_FRACTION_NEW = 0.15
/** Idade do perfil (dias) que marca stale independentemente do drift. */
export const PROFILE_STALE_AGE_DAYS = 90

export type ProfileStaleReason = "fresh" | "identical" | "drift" | "fraction_new" | "age" | "legacy_hash"

export interface ProfileStalenessArgs {
  /** Fingerprint gravado na geração do perfil corrente (null p/ perfis pré-migration 118). */
  savedFingerprint: HeuristicFingerprint | null
  /** Fingerprint heurístico da biblioteca ATUAL (computeHeuristicFingerprint). */
  currentFingerprint: HeuristicFingerprint
  /** input_hash do perfil corrente × da biblioteca atual — identidade/fallback. */
  savedInputHash: string
  currentInputHash: string
  /** n_works_used na geração × nº de obras rotuladas hoje. */
  savedNWorks: number
  currentNWorks: number
  /** created_at do perfil corrente (ISO) — null desativa o teto de idade. */
  savedCreatedAt: string | null
  /** Date.now() injetado (testabilidade). */
  nowMs: number
}

export interface ProfileStaleness {
  stale: boolean
  reason: ProfileStaleReason
  driftPct: number
  changedTags: number
  lovedJaccard: number
  avoidedJaccard: number
  fractionNew: number
  ageDays: number | null
}

/**
 * PURO: decide staleness do perfil pelo gate composto. Não lê o banco.
 * Ordem de curto-circuito: biblioteca idêntica (input_hash igual) → fresh;
 * sem fingerprint → cai na regra LEGADA (input_hash diverge = stale); senão,
 * OR de drift / fração-de-obras-novas / idade.
 */
export function classifyProfileStaleness(a: ProfileStalenessArgs): ProfileStaleness {
  const ageDays = a.savedCreatedAt ? (a.nowMs - Date.parse(a.savedCreatedAt)) / 86_400_000 : null
  const fractionNew = a.savedNWorks > 0 ? Math.abs(a.currentNWorks - a.savedNWorks) / a.savedNWorks : 0
  const ageStale = ageDays != null && ageDays >= PROFILE_STALE_AGE_DAYS
  const base = { fractionNew, ageDays }

  // Biblioteca byte-idêntica: nada mudou (só pode virar stale por idade).
  if (a.savedInputHash === a.currentInputHash) {
    return { stale: ageStale, reason: ageStale ? "age" : "identical", driftPct: 0, changedTags: 0, lovedJaccard: 1, avoidedJaccard: 1, ...base }
  }
  // Sem fingerprint gravado ⇒ não dá pra medir materialidade → regra legada
  // (input_hash mudou = stale). Só atinge perfis pré-migration 118.
  if (!a.savedFingerprint) {
    return { stale: true, reason: "legacy_hash", driftPct: 0, changedTags: 0, lovedJaccard: 1, avoidedJaccard: 1, ...base }
  }
  const cmp = compareFingerprints(a.savedFingerprint, a.currentFingerprint)
  const driftStale = cmp.driftPct >= PROFILE_DRIFT_THRESHOLD
  const fractionStale = fractionNew >= PROFILE_STALE_FRACTION_NEW
  const stale = driftStale || fractionStale || ageStale
  const reason: ProfileStaleReason = !stale ? "fresh" : driftStale ? "drift" : fractionStale ? "fraction_new" : "age"
  return { stale, reason, driftPct: cmp.driftPct, changedTags: cmp.changedTags, lovedJaccard: cmp.lovedJaccard, avoidedJaccard: cmp.avoidedJaccard, ...base }
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
