/**
 * Políticas PURAS do pacote CONTEXTUAL de rotulagem (Plano 3 Fase B2.1D):
 *  - seleção determinística das tags exibidas (`selectContextualTags`);
 *  - sanitização do `review_digest` para exibição neutra (`sanitizeDigestForLabeling`).
 *
 * Sem banco, sem LLM, sem `server-only`. Prepara o futuro pacote contextual
 * (snapshot-enriched `enriched-1`); NÃO gera digest nem busca tags aqui.
 */

import type { ReviewDigest } from "@/lib/ai-recommendation/types"

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
