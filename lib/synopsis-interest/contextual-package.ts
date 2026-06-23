/**
 * Políticas PURAS do pacote CONTEXTUAL de rotulagem (Plano 3 Fase B2.1D):
 *  - seleção determinística das tags exibidas (`selectContextualTags`);
 *  - sanitização do `review_digest` para exibição neutra (`sanitizeDigestForLabeling`).
 *
 * Sem banco, sem LLM, sem `server-only`. Prepara o futuro pacote contextual
 * (snapshot-enriched `enriched-1`); NÃO gera digest nem busca tags aqui.
 */

import type { ReviewDigest } from "@/lib/ai-recommendation/types"
import type { TextOnlyDigest } from "./digest-text-only"

// ── Política de tags ─────────────────────────────────────────────────────────

export interface ContextualTag {
  name: string
  group: string | null
}

/**
 * Grupos EXCLUÍDOS por padrão da rotulagem contextual: administrativos/estruturais,
 * sem significado para a decisão de leitura. `format` = estrutura (Long Strip, Full
 * Color…); `other` = catch-all não classificado (ruído). Demais grupos são
 * mantidos (themes, romance, tone_mood, female_lead, conflict, etc. importam).
 */
export const DEFAULT_EXCLUDED_TAG_GROUPS = new Set<string>(["format", "other"])

export const MAX_CONTEXTUAL_TAGS = 30

/**
 * Versão da política de SELEÇÃO de tags contextuais (`selectContextualTags`). Faz
 * parte da assinatura de equivalência de display (label-reuse): se mudar
 * `DEFAULT_EXCLUDED_TAG_GROUPS`, o dedupe, a ordenação ou `MAX_CONTEXTUAL_TAGS`,
 * **bump** esta versão para invalidar reaproveitamento de labels.
 */
export const TAG_SELECTION_POLICY_VERSION = "tag-priority-v1"

/**
 * Versão da política de SANITIZAÇÃO do digest (`sanitizeDigestForLabeling`). Idem:
 * mudar o scrubbing (RECOMMENDATION_RE/RATING_RE) ou os campos exibidos exige bump.
 */
export const DIGEST_SANITIZATION_POLICY_VERSION = "digest-sanitize-v1"

/** Chave de normalização para dedupe (lowercase, alfanum, colapsa espaços). */
function normalizeTagKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

export interface SelectContextualTagsOptions {
  excludedGroups?: Set<string>
  maxTags?: number
}

/**
 * Política DETERMINÍSTICA. Exclui grupos administrativos; remove duplicatas
 * semânticas (mesma chave normalizada — "Romance " ≡ "romance"); ordena
 * canonicamente (grupo → nome); limita a `maxTags`. NÃO inventa nem busca tags.
 * `[]` (S078) → `[]` (o display mostra mensagem neutra, não finge ausência legítima).
 */
export function selectContextualTags(
  tags: ContextualTag[],
  opts: SelectContextualTagsOptions = {},
): ContextualTag[] {
  const excluded = opts.excludedGroups ?? DEFAULT_EXCLUDED_TAG_GROUPS
  const maxTags = opts.maxTags ?? MAX_CONTEXTUAL_TAGS
  const repr = (t: ContextualTag): string => `${t.group ?? "~"}::${t.name}`

  // Dedupe por chave normalizada. O REPRESENTATIVO é determinístico (menor por
  // grupo→nome), independente da ordem de entrada.
  const byKey = new Map<string, ContextualTag>()
  for (const t of tags) {
    const name = (t.name ?? "").trim()
    if (!name) continue
    if (t.group && excluded.has(t.group)) continue
    const key = normalizeTagKey(name)
    if (!key) continue
    const candidate: ContextualTag = { name, group: t.group ?? null }
    const existing = byKey.get(key)
    if (!existing || repr(candidate) < repr(existing)) byKey.set(key, candidate)
  }
  const kept = [...byKey.values()]
  // Ordenação canônica: grupo (null por último) → nome (case-insensitive).
  kept.sort((a, b) => {
    const ga = a.group ?? "~"
    const gb = b.group ?? "~"
    if (ga !== gb) return ga.localeCompare(gb)
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
  return kept.slice(0, maxTags)
}

// ── Seleção por PRIORIDADE de grupo (B2.2U, pedido humano 2026-06-22) ─────────

/**
 * Ordem de PRIORIDADE de grupos para exibição contextual (menor nº = mais prioritário). Quando há
 * corte no teto, mantém-se primeiro os grupos mais decisivos para o INTERESSE na obra. Grupos fora
 * do mapa caem em LOW. `format`/`other` seguem EXCLUÍDOS (administrativos), não rebaixados. Dentro
 * de male_lead/female_lead, tags de APARÊNCIA ("Looks") são rebaixadas para LOW (só traços/papel
 * ficam em alta). Substitui a ordem alfabética enviesada da `selectContextualTags`.
 */
export const CONTEXTUAL_TAG_GROUP_PRIORITY: Record<string, number> = {
  tone_mood: 1,
  superpowers: 2,
  romance: 3,
  male_lead: 4, // exceto Looks (ver isLooksLeadTag)
  female_lead: 5, // exceto Looks
  fantasy: 6,
  content_indicator: 7,
  social_political: 8,
  character_profile: 9,
  character_context: 10,
  activities: 11,
}
const CONTEXTUAL_TAG_PRIORITY_LOW = 99

/**
 * Heurística de "Looks" (APARÊNCIA física) dentro de male_lead/female_lead — não há fonte
 * autoritativa de sub-grupo (migration 044 cria só o schema, sem dados, e não está aplicada).
 * Cobre cor de cabelo/olho, pele, beleza, altura/corpo e acessórios/marcas. Tags de
 * traço/papel/personalidade (Kind, Yandere, Knight, Strong, Noble…) NÃO são Looks.
 */
export function isLooksLeadTag(name: string): boolean {
  const n = (name ?? "").toLowerCase()
  if (/-haired|-eyed/.test(n)) return true
  if (/\bdark\/tan skin\b/.test(n)) return true
  return /^(handsome|beautiful|cute|ugly|unattractive|tall|fat|scarred|tattooed|bearded|glasses-wearing|choker-wearing|androgynous)\b/.test(n)
}

/**
 * Variante de `selectContextualTags` que ordena por PRIORIDADE de grupo (não alfabética) antes do
 * corte — assim, em obras tag-pesadas, os grupos decisivos (tom, romance, leads-traço, fantasia,
 * indicador de conteúdo…) sobrevivem ao teto em vez de serem cortados por virem "tarde" no alfabeto.
 * Mesma exclusão (format/other) e dedupe da `selectContextualTags`. Determinística (code-unit).
 */
export function selectContextualTagsByPriority(
  tags: ContextualTag[],
  opts: SelectContextualTagsOptions = {},
): ContextualTag[] {
  const excluded = opts.excludedGroups ?? DEFAULT_EXCLUDED_TAG_GROUPS
  const maxTags = opts.maxTags ?? MAX_CONTEXTUAL_TAGS
  const repr = (t: ContextualTag): string => `${t.group ?? "~"}::${t.name}`
  const byKey = new Map<string, ContextualTag>()
  for (const t of tags) {
    const name = (t.name ?? "").trim()
    if (!name) continue
    if (t.group && excluded.has(t.group)) continue
    const key = normalizeTagKey(name)
    if (!key) continue
    const candidate: ContextualTag = { name, group: t.group ?? null }
    const existing = byKey.get(key)
    if (!existing || repr(candidate) < repr(existing)) byKey.set(key, candidate)
  }
  const priorityOf = (t: ContextualTag): number => {
    const g = t.group ?? ""
    if ((g === "male_lead" || g === "female_lead") && isLooksLeadTag(t.name)) return CONTEXTUAL_TAG_PRIORITY_LOW
    return CONTEXTUAL_TAG_GROUP_PRIORITY[g] ?? CONTEXTUAL_TAG_PRIORITY_LOW
  }
  const lc = (s: string): string => s.toLowerCase()
  const kept = [...byKey.values()]
  kept.sort((a, b) => {
    const pa = priorityOf(a)
    const pb = priorityOf(b)
    if (pa !== pb) return pa - pb
    const ga = a.group ?? "~"
    const gb = b.group ?? "~"
    if (ga !== gb) return ga < gb ? -1 : 1 // code-unit (locale-independente)
    return lc(a.name) < lc(b.name) ? -1 : lc(a.name) > lc(b.name) ? 1 : 0
  })
  return kept.slice(0, maxTags)
}

// ── Sanitização do digest ────────────────────────────────────────────────────

export type DigestFieldPolicy = "permitido" | "permitido_sanitizado" | "proibido"

/** Classificação de cada campo do `review_digest` para exibição à avaliadora. */
export const DIGEST_FIELD_POLICY: Record<string, DigestFieldPolicy> = {
  consensus: "permitido_sanitizado",
  divergence: "permitido_sanitizado",
  execution: "permitido_sanitizado",
  "salient_traits.trait": "permitido_sanitizado",
  "salient_traits.polarity": "permitido",
  "salient_traits.axis": "permitido",
  content_warnings: "permitido",
  // Não existem como campos no schema, mas se aparecerem no TEXTO são removidos:
  numeric_ratings: "proibido",
  recommendation_language: "proibido",
}

// Linguagem de recomendação / previsão de gosto (proibida) — removida do texto.
// Unicode-aware (`u`): `\p{L}*` cobre continuações ACENTUADAS (recomendável,
// recomendação…) que `\w` (ASCII) deixava passar. Sem `\b` (incompatível com acento).
const RECOMMENDATION_RE =
  /(voc[êe] vai (gostar|amar|adorar)|recomend\p{L}*|vale a pena|imperd[ií]ve\p{L}*|leitura obrigat\p{L}*|must[- ]read|you(?:'| wi)ll (?:love|enjoy)|highly recommend\p{L}*)/giu
// Notas/estrelas/rankings (proibidos).
const RATING_RE = /\d{1,2}(?:[.,]\d)?\s*\/\s*(?:10|5)|★+|⭐+|\d(?:[.,]\d)?\s*(?:stars?|estrelas?)/giu

function scrub(text: string | null | undefined): string {
  return (text ?? "")
    .replace(RECOMMENDATION_RE, "")
    .replace(RATING_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim()
}

export interface SanitizedDigest {
  traits: Array<{ trait: string; polarity: "positive" | "negative" | "mixed"; axis: string }>
  consensus: string
  divergence: string
  execution: string
  contentWarnings: string[]
}

/**
 * Sanitiza o digest para exibição NEUTRA: descreve traços recorrentes (positivos e
 * negativos), sem recomendar a obra, sem prever o interesse da avaliadora, sem
 * notas/estrelas/rankings, minimizando linguagem de gosto. Formato uniforme entre
 * obras. Mantém `content_warnings` (avisos) e a polaridade/eixo do consenso.
 */
export function sanitizeDigestForLabeling(digest: ReviewDigest): SanitizedDigest {
  return {
    traits: (digest.salient_traits ?? []).map((t) => ({
      trait: scrub(t.trait),
      polarity: t.polarity,
      axis: t.axis,
    })),
    consensus: scrub(digest.consensus),
    divergence: scrub(digest.divergence),
    execution: scrub(digest.execution),
    contentWarnings: [...(digest.content_warnings ?? [])],
  }
}

/**
 * Adapta o digest `text-only-v1` (B2.2S) ao MESMO display `SanitizedDigest` da política aprovada —
 * REUSA o `scrub` (RECOMMENDATION_RE/RATING_RE inalterados; DIGEST_SANITIZATION_POLICY_VERSION
 * mantida: o scrubbing e os CAMPOS exibidos não mudam, só o schema de ORIGEM). Mapeamento:
 * recurring_positives→traits(positive), recurring_negatives→traits(negative), narrative_traits→
 * execution ("execução narrativa percebida"), consensus/divergence/content_warnings scrubbed.
 * `axis` fica "" (text-only não tem eixo). Avisos também passam pelo `scrub` (defesa anti-nota/rec).
 */
export function sanitizeTextOnlyDigestForLabeling(d: TextOnlyDigest): SanitizedDigest {
  const traits = [
    ...(d.recurring_positives ?? []).map((t) => ({ trait: scrub(t), polarity: "positive" as const, axis: "" })),
    ...(d.recurring_negatives ?? []).map((t) => ({ trait: scrub(t), polarity: "negative" as const, axis: "" })),
  ].filter((t) => t.trait)
  return {
    traits,
    consensus: scrub(d.consensus),
    divergence: scrub(d.divergence),
    execution: (d.narrative_traits ?? []).map((t) => scrub(t)).filter(Boolean).join("; "),
    contentWarnings: (d.content_warnings ?? []).map((t) => scrub(t)).filter(Boolean),
  }
}
