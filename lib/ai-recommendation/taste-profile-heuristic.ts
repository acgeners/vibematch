import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import type {
  RatedWorkInput,
  TasteProfilePayload,
  ProfileTag,
  ProfileCriterionPreference,
} from "@/lib/ai-recommendation/types"
import type { DeclaredTagPref } from "@/server/queries/tag-preferences"

// ============================================================
// TasteProfile heurístico (plano Free, zero LLM)
// ============================================================
// Deriva o perfil só por estatística sobre as obras com user_score:
//  - loved/avoided_tags: correlação point-biserial entre presença da tag e nota
//  - criterion_preferences: quartis 25–75 dos atributos nas obras nota ≥ 8,
//    e weight pela diferença média entre obras top (≥8) e bottom (≤5)
// narrative_patterns/summary ricos ficam só no plano Pago (LLM).

const MIN_TAG_OCCURRENCES = 3
const MAX_LOVED = 30
const MAX_AVOIDED = 15
const TOP_SCORE = 8
const BOTTOM_SCORE = 5

// ---------- Prior declarado com encolhimento (shrinkage) ----------
// As tags declaradas (amo/evito) entram como PRIOR e são misturadas com o
// sinal APRENDIDO (point-biserial) pesando pela evidência:
//   λ(n) = n / (n + k)   força_final = λ·aprendido + (1−λ)·declarado
// n = nº de obras avaliadas com a tag. k = "pseudo-contagem" (quanto a
// declaração vale em obras). n=0 → λ=0 → prior puro (cold-start); muito
// dado → λ→1 → o dado domina ("amo é sobreponível pelo dado").
/** Força de uma declaração na escala 0–1 (multiplicada por weight 1–2). */
const DECLARED_BASE = 0.5
/** k do "amo": declaração ~= 5 obras de evidência. */
const K_LOVE = 5
/** k do "evito": MAIOR → mais teimoso, resiste mais ao dado contrário (evito é mais confiável). */
const K_AVOID = 8

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Correlação point-biserial entre uma máscara binária e os scores. */
function pointBiserial(present: boolean[], scores: number[]): number {
  const n = scores.length
  if (n < 2) return 0
  const mean = scores.reduce((a, b) => a + b, 0) / n
  const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / n
  const sd = Math.sqrt(variance)
  if (sd === 0) return 0
  const withIdx = present.map((p, i) => (p ? i : -1)).filter((i) => i >= 0)
  const p = withIdx.length / n
  if (p === 0 || p === 1) return 0
  const m1 = withIdx.reduce((a, i) => a + scores[i], 0) / withIdx.length
  const m0 =
    (scores.reduce((a, s) => a + s, 0) - withIdx.reduce((a, i) => a + scores[i], 0)) / (n - withIdx.length)
  return ((m1 - m0) / sd) * Math.sqrt(p * (1 - p))
}

/** Chave de identidade da tag pro merge — nome normalizado (robusto à
 *  representação do grupo, que varia entre id e nome conforme o caller). */
function tagNameKey(name: string): string {
  return name.toLowerCase().trim()
}

/**
 * Conta, entre as obras AVALIADAS, em quantas cada tag aparece (1× por obra).
 * É o `n` (evidência) do shrinkage. Exportado pra o recalc reusar quando aplica
 * o merge sobre o perfil persistido (onde não chama buildTasteProfileHeuristic).
 */
export function buildRatedTagCounts(
  ratedWorks: Array<{ tags: Array<{ name: string }> }>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const w of ratedWorks) {
    const seen = new Set<string>()
    for (const t of w.tags) {
      const k = tagNameKey(t.name)
      if (seen.has(k)) continue
      seen.add(k)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Mistura as preferências DECLARADAS no perfil já construído, via shrinkage.
 * Opera sobre qualquer TasteProfilePayload finalizado (heurístico ou LLM), então
 * roda tanto na geração do perfil quanto, defensivamente, no recalc (idempotente:
 * re-mergear o mesmo declarado dá o mesmo resultado).
 *
 * Tags declaradas NÃO são truncadas pelos caps (a escolha explícita do usuário
 * nunca some). Onde declarado e aprendido discordam, λ(n) decide quem manda.
 */
export function mergeDeclaredTagPreferences(
  profile: TasteProfilePayload,
  declared: DeclaredTagPref[],
  ratedTagCounts: Map<string, number>,
): TasteProfilePayload {
  if (declared.length === 0) return profile

  // Sinal aprendido atual, com sinal: amada = +strength, evitada = −strength.
  const learnedSigned = new Map<string, number>()
  for (const t of profile.loved_tags) learnedSigned.set(tagNameKey(t.name), clamp01(t.strength))
  for (const t of profile.avoided_tags) learnedSigned.set(tagNameKey(t.name), -clamp01(t.strength))

  // Blend declarado⊕aprendido por tag.
  const declaredKeys = new Set<string>()
  const blendedLoved: ProfileTag[] = []
  const blendedAvoided: ProfileTag[] = []
  for (const d of declared) {
    const key = tagNameKey(d.name)
    if (declaredKeys.has(key)) continue
    declaredKeys.add(key)
    const n = ratedTagCounts.get(key) ?? 0
    const k = d.stance === "avoid" ? K_AVOID : K_LOVE
    const lambda = n / (n + k)
    const learned = learnedSigned.get(key) ?? 0
    const declaredSigned = (d.stance === "love" ? 1 : -1) * clamp01(DECLARED_BASE * d.weight)
    const blended = lambda * learned + (1 - lambda) * declaredSigned
    if (blended > 1e-6) blendedLoved.push({ name: d.name, group: d.group, strength: clamp01(blended) })
    else if (blended < -1e-6) blendedAvoided.push({ name: d.name, group: d.group, strength: clamp01(-blended) })
    // blended ≈ 0 → dado e declaração se cancelam → tag fica neutra (dropada).
  }

  // Mantém o aprendido que NÃO foi declarado; declaradas entram pinadas na frente.
  const keepLoved = profile.loved_tags.filter((t) => !declaredKeys.has(tagNameKey(t.name)))
  const keepAvoided = profile.avoided_tags.filter((t) => !declaredKeys.has(tagNameKey(t.name)))

  return {
    ...profile,
    loved_tags: [...blendedLoved, ...keepLoved].sort((a, b) => b.strength - a.strength),
    avoided_tags: [...blendedAvoided, ...keepAvoided].sort((a, b) => b.strength - a.strength),
  }
}

export function buildTasteProfileHeuristic(
  works: RatedWorkInput[],
  declared: DeclaredTagPref[] = [],
): TasteProfilePayload {
  const rated = works.filter((w) => w.userScore != null) as Array<RatedWorkInput & { userScore: number }>
  const scores = rated.map((w) => w.userScore)

  // ---------- tags via point-biserial ----------
  const tagGroups = new Map<string, string | null>()
  const tagCounts = new Map<string, number>()
  for (const w of rated) {
    const seen = new Set<string>()
    for (const t of w.tags) {
      if (seen.has(t.name)) continue
      seen.add(t.name)
      tagCounts.set(t.name, (tagCounts.get(t.name) ?? 0) + 1)
      if (!tagGroups.has(t.name)) tagGroups.set(t.name, t.group)
    }
  }

  const tagCorr: Array<{ name: string; group: string | null; corr: number }> = []
  for (const [name, count] of tagCounts) {
    if (count < MIN_TAG_OCCURRENCES) continue
    const present = rated.map((w) => w.tags.some((t) => t.name === name))
    tagCorr.push({ name, group: tagGroups.get(name) ?? null, corr: pointBiserial(present, scores) })
  }

  const loved_tags: ProfileTag[] = tagCorr
    .filter((t) => t.corr > 0)
    .sort((a, b) => b.corr - a.corr)
    .slice(0, MAX_LOVED)
    .map((t) => ({ name: t.name, group: t.group, strength: clamp01(t.corr) }))

  const avoided_tags: ProfileTag[] = tagCorr
    .filter((t) => t.corr < 0)
    .sort((a, b) => a.corr - b.corr)
    .slice(0, MAX_AVOIDED)
    .map((t) => ({ name: t.name, group: t.group, strength: clamp01(-t.corr) }))

  // ---------- criterion_preferences (9 atributos) ----------
  const topWorks = rated.filter((w) => w.userScore >= TOP_SCORE)
  const bottomWorks = rated.filter((w) => w.userScore <= BOTTOM_SCORE)
  const criterion_preferences: Partial<Record<CriterionSlug, ProfileCriterionPreference>> = {}

  for (const slug of CRITERION_SLUGS) {
    const topVals = topWorks
      .map((w) => w.categoryScores[slug as CriterionSlug])
      .filter((v): v is number => v != null)
    if (topVals.length < MIN_TAG_OCCURRENCES) continue // poucos dados pra esse atributo
    const sorted = [...topVals].sort((a, b) => a - b)
    const ideal_min = Math.round(quantile(sorted, 0.25) * 10) / 10
    const ideal_max = Math.round(quantile(sorted, 0.75) * 10) / 10

    const meanTop = topVals.reduce((a, b) => a + b, 0) / topVals.length
    const bottomVals = bottomWorks
      .map((w) => w.categoryScores[slug as CriterionSlug])
      .filter((v): v is number => v != null)
    const meanBottom = bottomVals.length
      ? bottomVals.reduce((a, b) => a + b, 0) / bottomVals.length
      : meanTop
    // weight pela separação top/bottom: diff de 3 pontos ≈ importância máxima.
    const weight = clamp01(Math.abs(meanTop - meanBottom) / 3)

    criterion_preferences[slug as CriterionSlug] = { ideal_min, ideal_max, weight }
  }

  // ---------- prior declarado com encolhimento ----------
  // Mistura as tags amo/evito declaradas (se houver) ANTES do summary, pra ele
  // já refletir o gosto efetivo. Sem declaração, retorna o perfil intacto.
  const merged = mergeDeclaredTagPreferences(
    {
      loved_tags,
      avoided_tags,
      loved_themes: [],
      avoided_themes: [],
      criterion_preferences,
      narrative_patterns: [],
      summary: "",
    },
    declared,
    buildRatedTagCounts(rated),
  )

  // ---------- summary template (sem prosa LLM) ----------
  const topLoved = merged.loved_tags.slice(0, 3).map((t) => t.name)
  const topAvoided = merged.avoided_tags.slice(0, 2).map((t) => t.name)
  const strongCrit = Object.entries(criterion_preferences)
    .sort((a, b) => (b[1]?.weight ?? 0) - (a[1]?.weight ?? 0))
    .slice(0, 3)
    .map(([slug]) => CRITERIA_INFO[slug]?.name ?? slug)

  const parts: string[] = [`Perfil heurístico (${rated.length} obras avaliadas).`]
  if (topLoved.length) parts.push(`Tende a gostar de: ${topLoved.join(", ")}.`)
  if (topAvoided.length) parts.push(`Costuma evitar: ${topAvoided.join(", ")}.`)
  if (strongCrit.length) parts.push(`Atributos que mais separam suas notas: ${strongCrit.join(", ")}.`)
  parts.push("Análise narrativa rica disponível no plano Pago.")

  return { ...merged, summary: parts.join(" ") }
}
