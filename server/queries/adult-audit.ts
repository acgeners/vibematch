import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { computeAdultContentBounds, clampAdultContentScore } from "@/lib/ai-evaluation/adult-content-rules"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"

export interface AdultAuditItem {
  id: string
  title: string
  /** Tags de conteúdo (content_indicator) presentes — contexto pro julgamento. */
  tags: string[]
  /** Nota "conteúdo adulto" da IA (0–10), se houver. */
  score: number | null
}

/**
 * Fila de auditoria 18+: obras que a 2ª opinião da IA marcou como INCERTAS
 * (`adult_reason = 'ai_review_uncertain'`) e que ainda não têm decisão humana
 * (`adult_override IS NULL`). São o resíduo do sinal fraco — a IA não achou
 * evidência de cena explícita, mas também não descartou. O Curador decide, e o
 * override vira verdade (migração 161). Some da fila assim que decidido.
 */
export async function getAdultAuditQueue(): Promise<AdultAuditItem[]> {
  const supabase = createAdminClient()
  const data = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      supabase
        .from("works")
        .select(
          "id, title, work_tags(tags(name, adult_indicator)), category_scores(criterion_slug, score)",
        )
        .eq("adult_reason", "ai_review_uncertain")
        .is("adult_override", null)
        .order("title", { ascending: true })
        .range(from, to),
    "getAdultAuditQueue",
  )

  const rows = data as unknown as Array<{
    id: string
    title: string
    work_tags: Array<{ tags: { name: string; adult_indicator: boolean } | null } | null> | null
    category_scores: Array<{ criterion_slug: string; score: number | null }> | null
  }>

  return rows.map((w) => ({
    id: w.id,
    title: w.title,
    tags: (w.work_tags ?? [])
      .map((wt) => wt?.tags)
      .filter((t): t is { name: string; adult_indicator: boolean } => !!t && t.adult_indicator)
      .map((t) => t.name),
    score:
      (w.category_scores ?? []).find((cs) => cs.criterion_slug === "adult_content")?.score ?? null,
  }))
}

export interface AdultBoundsDriftItem {
  id: string
  title: string
  currentScore: number
  floor: number | null
  ceiling: number | null
  reasons: string
}

const CHUNK = 200

/**
 * Fila de DRIFT contínuo entre a nota persistida e o piso/teto que as tags ATUAIS
 * da obra implicam (lib/ai-evaluation/adult-content-rules.ts). É a rede de
 * segurança permanente pro que `scripts/adult-content-retroactive-bounds.ts`
 * corrigiu uma vez: tag adicionada/reclassificada DEPOIS da última avaliação IA
 * (via a fila "Piso de nota 18+ (tags)") não se reflete sozinha na nota — sem
 * isto, o drift só é pego rodando o script manualmente de novo.
 *
 * Escopo restrito às obras que têm PELO MENOS UMA tag com adult_score_tier
 * decidido (ou a tag especial de teto R15) — evita varrer o catálogo inteiro
 * a cada carga de /curation/settings.
 */
export async function getAdultBoundsDriftQueue(): Promise<AdultBoundsDriftItem[]> {
  const supabase = createAdminClient()

  const { data: relevantTags, error: tagsErr } = await supabase
    .from("tags")
    .select("id")
    .or('adult_score_tier.not.is.null,name.eq."R15 but Based on a R19 Novel"')
  if (tagsErr) throw new Error(tagsErr.message)
  const tagIds = (relevantTags ?? []).map((t) => t.id as string)
  if (tagIds.length === 0) return []

  const candidateWorkIds = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("work_tags")
      .select("work_id")
      .in("tag_id", tagIds)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) candidateWorkIds.add(r.work_id as string)
    if (!data || data.length < 1000) break
  }
  if (candidateWorkIds.size === 0) return []
  const workIds = [...candidateWorkIds]

  const scoreByWork = new Map<string, { csId: string; score: number }>()
  for (let i = 0; i < workIds.length; i += CHUNK) {
    const c = workIds.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from("category_scores")
      .select("id, work_id, score")
      .eq("criterion_slug", "adult_content")
      .in("work_id", c)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) scoreByWork.set(r.work_id as string, { csId: r.id as string, score: Number(r.score) })
  }
  const scoredWorkIds = [...scoreByWork.keys()]
  if (scoredWorkIds.length === 0) return []

  const titleById = new Map<string, string>()
  const tagsByWork = new Map<string, Array<{ name: string; group: string | null; scoreTier: string | null }>>()
  const genresByWork = new Map<string, string[]>()
  for (let i = 0; i < scoredWorkIds.length; i += CHUNK) {
    const c = scoredWorkIds.slice(i, i + CHUNK)
    const { data: works, error: worksErr } = await supabase.from("works").select("id, title").in("id", c)
    if (worksErr) throw new Error(worksErr.message)
    for (const w of works ?? []) titleById.set(w.id as string, w.title as string)

    // work_tags é um fan-out (uma obra com muitas tags) — um chunk de CHUNK obras
    // pode passar de 1000 linhas fácil (Stigma Effect sozinha tem 44 tags). Sem
    // paginar aqui, o corte silencioso de 1000 linhas do Supabase derruba tags de
    // obras no fim do chunk — foi assim que a tag R15-based-on-R19 sumiu de
    // Stigma Effect num teste manual e o piso saiu errado (7 em vez do teto 6).
    const wt: Array<{
      work_id: string
      tags: { name: string; tag_group_id: string | null; adult_score_tier: string | null } | null
    }> = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("work_tags")
        .select("work_id, tags(name, tag_group_id, adult_score_tier)")
        .in("work_id", c)
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      wt.push(...((data ?? []) as unknown as typeof wt))
      if (!data || data.length < 1000) break
    }
    const wg: Array<{ work_id: string; genres: { name: string } | null }> = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("work_genres")
        .select("work_id, genres(name)")
        .in("work_id", c)
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      wg.push(...((data ?? []) as unknown as typeof wg))
      if (!data || data.length < 1000) break
    }
    for (const row of wt) {
      if (!row.tags?.name) continue
      const list = tagsByWork.get(row.work_id) ?? []
      list.push({
        name: row.tags.name,
        group: row.tags.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[row.tags.tag_group_id] ?? null) : null,
        scoreTier: row.tags.adult_score_tier,
      })
      tagsByWork.set(row.work_id, list)
    }
    for (const row of wg) {
      if (!row.genres?.name) continue
      const list = genresByWork.get(row.work_id) ?? []
      list.push(row.genres.name)
      genresByWork.set(row.work_id, list)
    }
  }

  const out: AdultBoundsDriftItem[] = []
  for (const workId of scoredWorkIds) {
    const bounds = computeAdultContentBounds({
      tags: (tagsByWork.get(workId) ?? []).map((t) => ({
        name: t.name,
        group: t.group,
        scoreTier: t.scoreTier === "label" || t.scoreTier === "explicit" ? t.scoreTier : null,
      })),
      genres: genresByWork.get(workId) ?? [],
    })
    if (bounds.floor == null && bounds.ceiling == null) continue
    const current = scoreByWork.get(workId)!.score
    const clamped = clampAdultContentScore(current, bounds)
    if (clamped === current) continue
    out.push({
      id: workId,
      title: titleById.get(workId) ?? workId,
      currentScore: current,
      floor: bounds.floor,
      ceiling: bounds.ceiling,
      reasons: bounds.reasons.join(" "),
    })
  }
  return out.sort((a, b) => b.title.localeCompare(a.title) * -1)
}
