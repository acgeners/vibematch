import { z } from "zod"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import type { ProfileCriterionPreference } from "./types"

const criterionSlugSchema = z.enum([...CRITERION_SLUGS] as [string, ...string[]])

const profileTagSchema = z.object({
  name: z.string().min(1),
  group: z.string().nullable().optional().transform((g) => g ?? null),
  strength: z.number().min(0).max(1),
})

const criterionPreferenceSchema = z.object({
  ideal_min: z.number().min(0).max(10),
  ideal_max: z.number().min(0).max(10),
  weight: z.number().min(0).max(1),
  note: z.string().nullable().optional(),
})

// Modelos às vezes retornam null/undefined em campos string declarados como
// required no JSONSchema do tool. Tratamos o caso em vez de descartar o
// perfil inteiro — a maior parte do conteúdo (tags, critérios, narrativas)
// tem valor mesmo sem o summary.
const SUMMARY_FALLBACK =
  "(perfil gerado sem resumo — clique em Recomputar perfil pra atualizar)"

const tolerantSummary = z
  .string()
  .nullish()
  .transform((s) => {
    const trimmed = s?.trim()
    return trimmed && trimmed.length > 0 ? trimmed : SUMMARY_FALLBACK
  })

const tolerantStringArray = z
  .array(z.string().nullish())
  .transform((arr) =>
    arr
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item) && (item ?? "").length > 0),
  )

// O perfil é PARCIAL por contrato: o prompt manda omitir critério sem evidência,
// o JSONSchema da tool não exige nenhum slug e o tipo é Partial<Record<…>>. Não
// use `z.record(enum, …)` aqui — no Zod 4 ele virou EXAUSTIVO (exige os 9 slugs)
// e descartava o perfil inteiro por um critério ausente. Slug fora do catálogo é
// dropado sozinho, sem custar o resto do perfil.
const tolerantCriterionPreferences = z
  .record(z.string(), criterionPreferenceSchema.nullish())
  .transform((rec) => {
    const out: Partial<Record<CriterionSlug, ProfileCriterionPreference>> = {}
    for (const [slug, pref] of Object.entries(rec)) {
      if (pref && criterionSlugSchema.safeParse(slug).success) {
        out[slug as CriterionSlug] = pref
      }
    }
    return out
  })

export const tasteProfileToolPayloadSchema = z.object({
  loved_tags: z.array(profileTagSchema),
  avoided_tags: z.array(profileTagSchema),
  loved_themes: tolerantStringArray,
  avoided_themes: tolerantStringArray,
  criterion_preferences: tolerantCriterionPreferences,
  narrative_patterns: tolerantStringArray,
  summary: tolerantSummary,
})

export type TasteProfileToolPayload = z.infer<typeof tasteProfileToolPayloadSchema>

// Mesmo espírito do `tolerantSummary`: o modelo às vezes omite o mode_summary
// (visto em prod junto com o `rankings` duplo-encodado). O valor real do payload
// são os `rankings` — descartar 20 obras já rankeadas por causa do parágrafo de
// resumo ausente é o mau negócio. Ausência vira fallback; o ranking sobrevive.
const RANKING_SUMMARY_FALLBACK = "(ranking gerado sem resumo)"

const tolerantModeSummary = z
  .string()
  .nullish()
  .transform((s) => {
    const trimmed = s?.trim()
    return trimmed && trimmed.length > 0 ? trimmed : RANKING_SUMMARY_FALLBACK
  })

export const rankingToolPayloadSchema = z.object({
  mode_summary: tolerantModeSummary,
  rankings: z.array(
    z.object({
      work_id: z.string().min(1),
      alignment_score: z.number().min(0).max(100),
      justification: z.string().min(1),
      top_match_factors: z.array(z.string().min(1)),
      // ============ Sub-fase 2.3 — Smart Shortlist enriquecido ============
      // Todos opcionais pra back-compat (runs antigas não têm).
      /**
       * Confiança do modelo no alignment_score, 0–1. Permite UI mostrar
       * "match forte / médio / incerto" sem o user ter que adivinhar.
       */
      confidence: z.number().min(0).max(1).nullable().optional(),
      /**
       * 1–3 razões pra NÃO ler essa obra (mesmo que o match seja alto).
       * Ex.: "tem tag tragedy que você evita", "MeanPostScore baixo em
       * obras similares". Frases curtas em PT-BR.
       */
      risks: z.array(z.string().min(1)).optional(),
      /**
       * IDs (work_id) de 1–2 obras na biblioteca que você AMA e que esta
       * lembra — base pra "se você gostou de X, vai gostar disto".
       */
      similar_loved: z.array(z.string().min(1)).optional(),
      /**
       * Idem, mas pras que você AVALIOU MAL — sinal de risco.
       */
      similar_avoided: z.array(z.string().min(1)).optional(),
      /**
       * 1–2 quotes curtos de reviews (entre aspas) que sustentam o match
       * ou expõem o risco. Não inventar — só usar reviews fornecidas.
       */
      review_quotes: z.array(z.string().min(1)).optional(),
      /**
       * Fit com mood/contexto explícito do user, 0–1. NULL quando não
       * houve mood na request — não confunde "neutro" com "ausente".
       */
      mood_fit: z.number().min(0).max(1).nullable().optional(),
    })
  ),
})

export type RankingToolPayload = z.infer<typeof rankingToolPayloadSchema>

/** Payload por candidato (extraído do array). Útil pra UI components. */
export type RankingEntryPayload = RankingToolPayload["rankings"][number]
