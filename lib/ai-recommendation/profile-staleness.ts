/**
 * Gate de STALENESS do perfil de gosto — PURO (nem banco, nem `server-only`).
 *
 * Mora separado de `profile-drift.ts` de propósito: aquele arquivo é `server-only`
 * (lê Supabase), e o card do perfil é um client component que precisa dos MESMOS
 * limiares pra desenhar a barra de defasagem. Duplicar os números na UI seria a
 * receita clássica do teto que diverge da execução — o bug do lote de Interesse
 * (PR #206) foi exatamente isso. Aqui há uma fonte só; `profile-drift.ts`
 * re-exporta tudo pra não quebrar quem já importava de lá.
 *
 * Ver `STALENESS-MATERIALIDADE.md` pra calibração do θ.
 */

export interface HeuristicFingerprint {
  /** Tags amadas (nomes lowercased, ordenados) do perfil heurístico no gen. */
  loved: string[]
  avoided: string[]
  /** Critérios com preferência (slugs). */
  criteria: string[]
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

/**
 * Drift heurístico acima do qual vale a pena REGENERAR o perfil mesmo num fluxo
 * gated por custo (lote "Reprocessar/Prever Interesse"). É um patamar MAIS ALTO que
 * o de staleness: "materialmente movido" (0.15) apenas marca o perfil como
 * desatualizado; "muito defasado" (este) é o que justifica pagar os ~$0,60 da
 * regeneração antes de prever. Abaixo dele, um perfil stale (por drift pequeno,
 * idade ou fração de obras novas) é USADO como está e a previsão roda contra ele
 * (~$0,05 em vez de ~$0,65). Heurístico (2× o limiar de staleness), NÃO calibrado —
 * ajuste aqui se quiser regenerar com mais/menos frequência.
 */
export const PROFILE_DRIFT_REGEN_THRESHOLD = 0.3

/**
 * "Muito defasado": o drift MEDIDO justifica pagar a regeneração. Só o drift
 * heurístico conta — idade e fração-de-obras-novas são proxies de staleness, não
 * evidência de que o gosto se moveu muito. Perfil legado sem fingerprint
 * (driftPct = 0) ⇒ não-severo (usa-se como está; não força cobrança inesperada).
 */
export function isProfileDriftSevere(driftPct: number): boolean {
  return driftPct >= PROFILE_DRIFT_REGEN_THRESHOLD
}

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

// ---------------------------------------------------------------------------
// ESCADA DE EXIBIÇÃO — o "quão defasado", pra UI
//
// O gate acima é binário por construção (fresh × stale): é o que decide se um
// fluxo pago regenera. Mas "quando vale a pena recomputar?" é uma pergunta
// graduada, e responder com um alerta que só liga/desliga não ajuda — a linha
// antiga do card ("⚠ pode estar defasado") acendia igual pra 15% e pra 60%.
//
// A escada NÃO inventa limiar: reusa os três já calibrados. O único número novo
// é a METADE de cada um, que separa "em dia" de "começando a mudar" — puramente
// cosmético, nenhum fluxo pago olha pra ele.
// ---------------------------------------------------------------------------

export type ProfileStalenessLevel = "fresh" | "moving" | "stale" | "severe"

/** Fração dos limiares a partir da qual a UI começa a avisar (só cosmético). */
const EARLY_WARN_FRACTION = 0.5

/**
 * PURO: nível de exibição a partir do gate. `severe` é o único que muda dinheiro
 * (é o mesmo corte que autoriza pagar a regeneração no lote de Interesse), por
 * isso vem ANTES de `stale` na ordem.
 */
export function classifyProfileStalenessLevel(st: ProfileStaleness): ProfileStalenessLevel {
  if (isProfileDriftSevere(st.driftPct)) return "severe"
  if (st.stale) return "stale"
  const early =
    st.driftPct >= PROFILE_DRIFT_THRESHOLD * EARLY_WARN_FRACTION ||
    st.fractionNew >= PROFILE_STALE_FRACTION_NEW * EARLY_WARN_FRACTION ||
    (st.ageDays != null && st.ageDays >= PROFILE_STALE_AGE_DAYS * EARLY_WARN_FRACTION)
  return early ? "moving" : "fresh"
}

/**
 * Quais dos três gatilhos do gate composto de fato dispararam. A UI acende só
 * esses — sem isto, um perfil marcado por IDADE mostraria a barra de drift em
 * ~0% e pareceria um alerta sem causa.
 */
export function profileStalenessTriggers(st: ProfileStaleness): {
  drift: boolean
  fractionNew: boolean
  age: boolean
} {
  return {
    drift: st.driftPct >= PROFILE_DRIFT_THRESHOLD,
    fractionNew: st.fractionNew >= PROFILE_STALE_FRACTION_NEW,
    age: st.ageDays != null && st.ageDays >= PROFILE_STALE_AGE_DAYS,
  }
}
