import "server-only"
import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { CRITERION_SLUGS } from "@/types/domain"
import { getHideAdultContent } from "@/server/queries/current-user"

/**
 * ASSINATURA — o atributo que mais MARCA a obra.
 *
 * É a lente de atributos de /titles, e existe justamente pra NÃO ser o mín/máx do
 * /ranking. As duas páginas usam os mesmos 9 atributos pra responder perguntas
 * diferentes: o /ranking pergunta "vale a pena?" (limiar), /titles pergunta "que
 * tipo de obra é essa?" (forma).
 *
 * ⚠️ É z-score contra a média do CATÁLOGO, não a nota crua — e a diferença é o
 * ponto todo. Medido em 2026-07-23 sobre 895 obras com os 9 atributos:
 *
 *   romance          média 7,47  σ 1,10   → alto em quase tudo, não distingue nada
 *   adult_content    média 5,17  σ 2,63   → o que mais varia
 *
 * Pela nota crua, Romance "venceria" em quase toda obra e a lente seria inútil.
 * Pelo z-score a partição fica informativa: nenhum atributo domina mais de ~19%
 * do catálogo.
 *
 * Obra sem os 9 atributos não tem assinatura (fica de fora do filtro) — meia
 * assinatura seria pior que nenhuma, porque o argmax sairia do subconjunto que
 * por acaso foi avaliado.
 */

export interface SignatureStats {
  /** work_id → slug do atributo dominante. */
  dominantByWork: Record<string, string>
  /** slug → média e desvio-padrão no catálogo (pra explicar a lente na UI). */
  momentsBySlug: Record<string, { mean: number; sd: number }>
}

interface ScoreRow {
  work_id: string
  criterion_slug: string
  score: number | null
}

const CRITERION_SLUG_SET = new Set<string>(CRITERION_SLUGS)

/** `true` quando o slug é um dos 9 atributos de IA (protege contra ?signature= forjado). */
export function isCriterionSlug(slug: string): boolean {
  return CRITERION_SLUG_SET.has(slug)
}

const getSignatureStats = unstable_cache(
  async (): Promise<SignatureStats> => {
    const supabase = createAdminClient()

    // ⚠️ PAGINA. `category_scores` tem ~8k linhas (9 por obra): um `.select()` cru
    // pararia em 1000 e as estatísticas sairiam de ~111 obras — um erro que
    // PRODUZ resultado, sem erro nem log, exatamente o gotcha nº1 do projeto.
    const rows = await fetchAllRows<ScoreRow>(
      (from, to) =>
        supabase.from("category_scores").select("work_id, criterion_slug, score").range(from, to),
      "getSignatureStats",
    )

    const byWork = new Map<string, Map<string, number>>()
    const bySlug = new Map<string, number[]>()

    for (const row of rows) {
      if (row.score == null || !isCriterionSlug(row.criterion_slug)) continue
      const work = byWork.get(row.work_id) ?? new Map<string, number>()
      work.set(row.criterion_slug, row.score)
      byWork.set(row.work_id, work)

      const list = bySlug.get(row.criterion_slug) ?? []
      list.push(row.score)
      bySlug.set(row.criterion_slug, list)
    }

    const momentsBySlug: Record<string, { mean: number; sd: number }> = {}
    for (const [slug, values] of bySlug) {
      const n = values.length
      const mean = values.reduce((a, b) => a + b, 0) / n
      const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
      momentsBySlug[slug] = { mean, sd }
    }

    const dominantByWork: Record<string, string> = {}
    for (const [workId, scores] of byWork) {
      // Sem os 9 não há assinatura: o argmax viria do subconjunto avaliado.
      if (scores.size < CRITERION_SLUGS.length) continue

      let best: string | null = null
      let bestZ = -Infinity
      for (const [slug, score] of scores) {
        const moments = momentsBySlug[slug]
        // σ = 0 (atributo constante no catálogo) não distingue nada — e dividir
        // por zero daria ±Infinity, que venceria o argmax sempre.
        if (!moments || moments.sd === 0) continue
        const z = (score - moments.mean) / moments.sd
        if (z > bestZ) {
          bestZ = z
          best = slug
        }
      }
      if (best) dominantByWork[workId] = best
    }

    return { dominantByWork, momentsBySlug }
  },
  ["work-signature-stats-v1"],
  // Invalidada pela mesma tag que as mutações de obra já disparam; o revalidate
  // cobre o recálculo em massa, que não passa por lá.
  { revalidate: 600, tags: ["works-slug-index"] },
)

/** IDs das obras cuja assinatura está entre `slugs`. `null` quando não há filtro. */
export async function resolveSignatureWorkIds(slugs: string[] | undefined): Promise<string[] | null> {
  const wanted = (slugs ?? []).filter(isCriterionSlug)
  if (!wanted.length) return null
  const wantedSet = new Set(wanted)
  const { dominantByWork } = await getSignatureStats()
  return Object.entries(dominantByWork)
    .filter(([, slug]) => wantedSet.has(slug))
    .map(([workId]) => workId)
}

export interface SignatureCount {
  slug: string
  count: number
}

/**
 * Quantas obras cada assinatura marca — alimenta os chips do filtro.
 *
 * Conta sob as MESMAS exclusões que /titles aplica por padrão (arquivadas fora,
 * preferência global de 18+ respeitada). Um número que não bate com o destino do
 * clique é pior que número nenhum.
 *
 * Segue sendo uma contagem de CATÁLOGO: não conhece os outros filtros ativos. Por
 * isso a UI rotula "no catálogo" em vez de prometer o tamanho do resultado.
 */
export async function getSignatureCounts(): Promise<SignatureCount[]> {
  // NÃO PODE LANÇAR. Isto é decoração de filtro, e /titles chama dentro de um
  // Promise.all — um throw aqui derruba o CATÁLOGO INTEIRO com tela de erro.
  // Aconteceu de verdade em dev com um "JWT issued at future" (relógio fora de
  // hora): a página morreu por causa de um contador de chip. Degrada pra "sem
  // chips" e segue.
  //
  // O FILTRO (resolveSignatureWorkIds) continua podendo lançar de propósito:
  // devolver "sem filtro" quando o usuário pediu um recorte mostraria o catálogo
  // inteiro como se fosse o resultado — mentira pior que erro.
  try {
    const [{ dominantByWork }, hideAdult] = await Promise.all([
      getSignatureStats(),
      getHideAdultContent(),
    ])

    const supabase = createAdminClient()
    const visible = await fetchAllRows<{ id: string; is_adult: boolean | null }>(
      (from, to) =>
        supabase.from("works").select("id, is_adult").eq("is_archived", false).range(from, to),
      "getSignatureCounts",
    )

    const counts = new Map<string, number>()
    for (const work of visible) {
      if (hideAdult && work.is_adult) continue
      const slug = dominantByWork[work.id]
      if (!slug) continue
      counts.set(slug, (counts.get(slug) ?? 0) + 1)
    }

    return CRITERION_SLUGS.map((slug) => ({ slug, count: counts.get(slug) ?? 0 })).sort(
      (a, b) => b.count - a.count,
    )
  } catch (error) {
    console.error("[work-signature] contagem de assinatura falhou:", error)
    return []
  }
}
