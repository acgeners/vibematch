import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserId, getOwnerUserId } from "@/server/queries/current-user"
import { pickCoverUrls, pickPrimarySynopsis } from "@/lib/work-derived"

/**
 * Os 8 eixos de gosto, NA ORDEM DA TELA (esta lista é a fonte da ordem — `getTasteCriteria`
 * ordena por ela, não pelo `id` do banco). Personagens desagrupados (mig 158) vêm primeiro.
 *
 * `like_leads_score` (o antigo "Protagonistas & Casal" agrupado) e `like_overall_score` (o veredito
 * manual) saíram daqui de propósito: leads virou FL/ML/Casal; o veredito foi substituído pela nota
 * de gosto CALCULADA. As colunas continuam no banco (dado preservado) — só não são mais lidas/escritas
 * nem renderizadas. O DROP delas é uma fase 2 separada.
 */
export const TASTE_SCORE_KEYS = [
  "like_female_lead_score",
  "like_male_lead_score",
  "like_couple_score",
  "like_setting_score",
  "like_tone_score",
  "like_art_score",
  "like_pacing_score",
  "like_ending_score",
] as const

export type TasteScoreKey = (typeof TASTE_SCORE_KEYS)[number]

/**
 * Os eixos que COMPÕEM o rótulo de gosto (`user_score`): os 7 aspectos, SEM o "Final"
 * (`like_ending_score`). O experimento de rótulo (PR #153, `scripts/taste-label-experiment.ts`)
 * mostrou que incluir o Final como componente do rótulo PIORA a previsão (R² 0.472 → 0.419);
 * ele continua sendo exibido e pode virar feature, mas não entra no rótulo. Conjunto FIXO de
 * propósito — ver `computeTasteUserScore`.
 */
export const TASTE_LABEL_KEYS = TASTE_SCORE_KEYS.filter(
  (k) => k !== "like_ending_score",
) as Array<Exclude<TasteScoreKey, "like_ending_score">>

/**
 * Deriva a nota pessoal (`user_score`) da avaliação por GOSTO: média simples dos 7 eixos
 * fixos (`TASTE_LABEL_KEYS`). É esta a nota que treina o Ridge do dono, a Chance e o ledger.
 *
 * ⚠️ Conjunto FIXO, tudo-ou-nada: se QUALQUER um dos 7 falta, devolve `null` (não grava). O
 * experimento mostrou que "média dos disponíveis" injeta ruído (nº de eixos heterogêneo derruba
 * o R² 0.472 → 0.419) — por isso não caímos numa média parcial.
 */
export function computeTasteUserScore(
  scores: Partial<Record<TasteScoreKey, number | null>>,
): number | null {
  const vals: number[] = []
  for (const k of TASTE_LABEL_KEYS) {
    const v = scores[k]
    if (v == null || !Number.isFinite(Number(v))) return null
    vals.push(Number(v))
  }
  if (vals.length === 0) return null
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  return Math.round(mean * 10) / 10
}

export interface TasteCriterion {
  slug: string
  key: TasteScoreKey
  name: string
  emoji: string
  description: string
  hints: string[]
  allowsNa: boolean
  isOverall: boolean
}

export interface PilotWork {
  id: string
  title: string
  userScore: number
  /** Capas em ordem de preferência (primária primeiro); vazio quando não há capa. */
  coverUrls: string[]
  synopsis: string | null
  tags: string[]
  scores: Record<TasteScoreKey, number | null>
  endingNa: boolean
  /** Data (YYYY-MM-DD) da última leitura; null quando não registrada. */
  lastReadAt: string | null
  /** Status de leitura (`personal_status_id`); null quando não definido. */
  personalStatusId: number | null
}

/**
 * Notas de gosto já dadas a UMA obra (pra a avaliação embutida na página) — as DO USUÁRIO
 * ATUAL. Per-user desde a mig 169: sem o filtro de user_id, o `maybeSingle` estouraria na
 * primeira obra avaliada por duas pessoas — e antes disso mostraria a nota de outra pessoa.
 * Anônimo cai no dono (`getCurrentUserId`): o catálogo é visto pelos olhos dele, por design.
 */
export async function getTasteScoresForWork(
  workId: string,
): Promise<{ scores: Record<TasteScoreKey, number | null>; endingNa: boolean }> {
  const sb = createAdminClient()
  const userId = await getCurrentUserId(sb)
  const { data } = await sb
    .from("pilot_taste_scores")
    .select("*")
    .eq("work_id", workId)
    .eq("user_id", userId)
    .maybeSingle()
  const scores = {} as Record<TasteScoreKey, number | null>
  for (const k of TASTE_SCORE_KEYS) {
    const v = (data as Record<string, unknown> | null)?.[k]
    scores[k] = v == null ? null : Number(v)
  }
  return { scores, endingNa: Boolean((data as Record<string, unknown> | null)?.ending_na) }
}

/**
 * Critérios de gosto (criteria eval_type='Gosto'), na ordem de `TASTE_SCORE_KEYS`.
 * FILTRA pelos keys dessa lista → os critérios deprecados que sobraram no banco
 * (`like_leads_score`, `like_overall_score`) não são retornados, logo não renderizam.
 */
export async function getTasteCriteria(): Promise<TasteCriterion[]> {
  const sb = createAdminClient()
  const { data, error } = await sb
    .from("criteria")
    .select("slug, key, criteria, emoji, description, ranges")
    .eq("eval_type", "Gosto")
  if (error) throw new Error(`getTasteCriteria: ${error.message}`)
  const order = new Map(TASTE_SCORE_KEYS.map((k, i) => [k, i]))
  return (data ?? [])
    .filter((c) => order.has(c.key as TasteScoreKey))
    .sort((a, b) => order.get(a.key as TasteScoreKey)! - order.get(b.key as TasteScoreKey)!)
    .map((c) => ({
      slug: c.slug as string,
      key: c.key as TasteScoreKey,
      name: c.criteria as string,
      emoji: (c.emoji as string | null) ?? "",
      description: (c.description as string | null) ?? "",
      hints: Array.isArray(c.ranges) ? (c.ranges as string[]) : [],
      allowsNa: c.slug === "taste_ending",
      isOverall: c.slug === "taste_overall",
    }))
}

/**
 * Colunas dos 8 critérios pós-leitura (User) em `works`. Quando ≥1 está
 * preenchido, a nota pessoal foi CALCULADA a partir deles (mesma regra do
 * work-status-form: weightSum>0); quando nenhum, o `user_score` veio de outro
 * lugar (ex.: import) — a obra não foi "avaliada diretamente".
 */
const POST_READING_SCORE_COLUMNS = [
  "post_story_score",
  "post_fl_score",
  "post_ml_score",
  "post_character_development_score",
  "post_pacing_score",
  "post_art_visual_score",
  "post_impact_immersion_score",
  "post_originality_score",
] as const

/**
 * Obras que EU avaliei diretamente para o piloto: têm `user_score` e pelo menos
 * um critério pós-leitura preenchido (a nota pessoal saiu dos critérios, não de
 * import). Ficam de fora obras com user_score importado mas sem avaliação própria.
 * Com capa/sinopse/tags e as notas de gosto já dadas. Ordenadas pela ÚLTIMA
 * LEITURA (desc): obra recém-lida = recall melhor = nota de gosto mais precisa.
 * Sem data vai pro fim.
 */
export async function getPilotWorks(): Promise<PilotWork[]> {
  const sb = createAdminClient()
  // O piloto é a ferramenta de rotulagem do DONO (lê works_owner, o espelho dele) —
  // o embed de pilot_taste_scores tem que ficar no mesmo dono. Per-user desde a mig
  // 169: sem o filtro, `ptsRaw[0]` podia ser a linha de OUTRA pessoa.
  const ownerId = await getOwnerUserId(sb)
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("works_owner")
      .select(
        `id, title, user_score, last_read_at, personal_status_id, canonical_synopsis, ${POST_READING_SCORE_COLUMNS.join(", ")}, work_covers(url,is_primary,position), work_synopses(text,is_primary,position), work_tags(tags(name)), pilot_taste_scores(*)`,
      )
      .not("user_score", "is", null)
      .eq("is_archived", false)
      .eq("pilot_taste_scores.user_id", ownerId)
      .range(from, from + 999)
    if (error) throw new Error(`getPilotWorks: ${error.message}`)
    // cast via unknown: select montado por template string vira ParserError no
    // tipo do supabase-js, mas a string é válida em runtime.
    const batch = (data ?? []) as unknown as Record<string, unknown>[]
    rows.push(...batch)
    if (batch.length < 1000) break
  }

  // Só obras avaliadas diretamente: user_score derivado dos critérios pós-leitura
  // (≥1 preenchido). Exclui user_score de import sem avaliação própria.
  const evaluated = rows.filter((w) =>
    POST_READING_SCORE_COLUMNS.some((c) => w[c] != null),
  )

  const works: PilotWork[] = evaluated.map((w) => {
    const ptsRaw = w.pilot_taste_scores
    const pts = (Array.isArray(ptsRaw) ? ptsRaw[0] : ptsRaw) as Record<string, unknown> | undefined
    const scores = {} as Record<TasteScoreKey, number | null>
    for (const k of TASTE_SCORE_KEYS) {
      const v = pts?.[k]
      scores[k] = v == null ? null : Number(v)
    }
    const tags = ((w.work_tags as { tags?: { name?: string } }[] | null) ?? [])
      .map((wt) => wt.tags?.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 6)
    return {
      id: w.id as string,
      title: w.title as string,
      userScore: Number(w.user_score),
      coverUrls: pickCoverUrls(w.work_covers as never),
      synopsis:
        (w.canonical_synopsis as string | null)?.trim() ||
        pickPrimarySynopsis(w.work_synopses as never),
      tags,
      scores,
      endingNa: Boolean(pts?.ending_na),
      lastReadAt: (w.last_read_at as string | null) ?? null,
      personalStatusId: (w.personal_status_id as number | null) ?? null,
    }
  })

  // Última leitura desc; sem data vai pro fim; empate no dia desempata por nota.
  works.sort((a, z) => {
    if (a.lastReadAt && z.lastReadAt) {
      if (a.lastReadAt !== z.lastReadAt) return a.lastReadAt < z.lastReadAt ? 1 : -1
      return z.userScore - a.userScore
    }
    if (a.lastReadAt) return -1
    if (z.lastReadAt) return 1
    return z.userScore - a.userScore
  })
  return works
}
