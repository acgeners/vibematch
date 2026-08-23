import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { reportHandledServerError } from "@/lib/observability/handled-error"
import { coverCandidates } from "@/lib/work-derived"
import { HIATUS_SELECT_COLUMNS, hiatusFieldsFromRow } from "@/lib/works/hiatus-display"
import type { HiatusFields } from "@/lib/works/hiatus-display"
import type { HiatusKind } from "@/lib/external/hiatus-kind"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * As obras da vitrine PÚBLICA — para quem não tem sessão.
 *
 * ⚠️ O eixo aqui é `platform_avg` + `total_votes`, nunca `expected_score`. A Nota Prevista é
 * relativa a um gosto: sem sessão ela não existe, e o que existia no lugar era a previsão do
 * DONO (ver `getScoresReader` e o fix do eixo público). Ordenar uma página pública por ela
 * publica a preferência de uma pessoa como se fosse a avaliação do acervo.
 *
 * `total_votes` entra no corte por um motivo prático: sem piso de votos, uma obra com 9,8 e
 * doze avaliações encabeça a lista e a vitrine passa a mostrar ruído estatístico como se
 * fosse consenso.
 */

export interface PublicShowcaseWork extends HiatusFields {
  id: string
  title: string
  coverUrls: string[]
  /** Média das plataformas externas (0–10) — fato da obra, igual para todo visitante. */
  platformAvg: number | null
  totalVotes: number
  publicationStatusId: number | null
  isAdult: boolean
  totalChapters: number | null
}

/** Piso de votos para entrar na vitrine: abaixo disso a média não é sinal, é acaso. */
const MIN_VOTES = 300

export interface SpotlightWork extends PublicShowcaseWork {
  /** As notas por critério, na ordem de `CRITERION_SLUGS`. Só entra com os 9 completos. */
  scores: Array<{ slug: string; score: number }>
}

/**
 * A obra do hero público — a que demonstra o produto em vez de descrevê-lo.
 *
 * Exige os **9 critérios completos**: o argumento da página é "toda obra passa por uma leitura
 * de nove critérios", e ilustrá-lo com uma obra de seis notas desmentiria a própria frase.
 *
 * Escolha determinística (a melhor por `platform_avg` que satisfaz os requisitos), nunca
 * aleatória — sorteio aqui mudaria o hero a cada request, quebrando cache e tornando a página
 * impossível de conferir.
 */
/**
 * Os TRÊS estados do destaque, que `SpotlightWork | null` não consegue representar.
 *
 * 🔴 Um item único tem três desfechos genuinamente distintos — achou / consultei e não há /
 * não consegui consultar — e o `null` antigo cobria os dois últimos com o MESMO valor. A
 * consequência é a afirmação falsa: com a query falhando, a home dizia "esta obra não existe"
 * em vez de "não consegui olhar".
 *
 * ⚠️ A assimetria com `getPublicShowcase` (que usa `T[] | null`) é de propósito, não
 * descuido: numa LISTA, "não achei" e "está vazia" são o mesmo fato, então dois estados
 * bastam. Num item só, não são. O contrato acompanha o dado, não a simetria.
 */
export type SpotlightResult =
  | { status: "ok"; work: SpotlightWork | null }
  | { status: "unavailable" }

export async function getSpotlightWork(): Promise<SpotlightResult> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("calculated_scores")
    .select(
      `platform_avg, total_votes,
       works!inner(id, title, is_archived, is_adult, publication_status_id, total_chapters,
                   ${HIATUS_SELECT_COLUMNS},
                   work_covers(url, is_primary, position),
                   category_scores(criterion_slug, score))`,
    )
    .not("platform_avg", "is", null)
    .gte("total_votes", MIN_VOTES)
    .eq("works.is_archived", false)
    .order("platform_avg", { ascending: false })
    .limit(60)

  if (error) {
    // Sem isto a falha some: o erro nunca chega ao framework (foi capturado aqui), então
    // `server_error` fica em ZERO enquanto a página responde 200 com o raio-X indisponível.
    reportHandledServerError({ operation: "public-showcase.getSpotlightWork", error })
    return { status: "unavailable" }
  }

  const rows = (data ?? []) as unknown as Array<{
    platform_avg: number | null
    total_votes: number | null
    works: {
      id: string
      title: string
      is_adult?: boolean | null
      publication_status_id: number | null
      total_chapters: number | null
      hiatus_kind?: HiatusKind | null
      hiatus_kind_confidence?: "high" | "low" | null
      publication_status_note?: string | null
      work_covers?: { url: string; is_primary: boolean; position: number }[] | null
      category_scores?: Array<{ criterion_slug: string; score: number | null }> | null
    }
  }>

  for (const row of rows) {
    if (row.works.is_adult) continue
    const coverUrls = coverCandidates(row.works.work_covers)
    if (coverUrls.length === 0) continue

    const bySlug = new Map(
      (row.works.category_scores ?? [])
        .filter((c) => c.score != null)
        .map((c) => [c.criterion_slug, c.score as number]),
    )
    if (CRITERION_SLUGS.some((s) => !bySlug.has(s))) continue

    return {
      status: "ok",
      work: {
        id: row.works.id,
        title: row.works.title,
        coverUrls,
        platformAvg: row.platform_avg,
        totalVotes: row.total_votes ?? 0,
        publicationStatusId: row.works.publication_status_id,
        isAdult: false,
        totalChapters: row.works.total_chapters,
        ...hiatusFieldsFromRow(row.works),
        scores: CRITERION_SLUGS.map((slug) => ({ slug, score: bySlug.get(slug) as number })),
      },
    }
  }
  // A consulta RESPONDEU e nenhuma obra satisfez os requisitos (9 critérios + capa + votos).
  // É ausência legítima, e por isso NÃO é `unavailable`: a página pode dizer com segurança
  // que não há destaque hoje, em vez de sugerir que algo quebrou.
  return { status: "ok", work: null }
}

/**
 * A vitrine pública. `PublicShowcaseWork[]` = a consulta respondeu (e `[]` é vazio legítimo);
 * `null` = a consulta FALHOU.
 *
 * 🔴 Antes o erro virava `[]`, e o consumidor esconde a seção quando a lista é vazia — ou
 * seja, uma falha da vitrine ficava indistinguível de "o catálogo não tem obra bem avaliada".
 * O defeito é LOCAL: as outras partes da home podem estar perfeitamente saudáveis, e mesmo
 * assim a prateleira afirmava ausência de conteúdo.
 */
export async function getPublicShowcase(limit = 12): Promise<PublicShowcaseWork[] | null> {
  const supabase = createAdminClient()

  // `works!inner` (não `works_owner`): a view é a fonte do DONO e carrega as colunas pessoais
  // dele. Numa página pública isso não pode entrar nem por acidente.
  const { data, error } = await supabase
    .from("calculated_scores")
    .select(
      `platform_avg, total_votes,
       works!inner(id, title, is_archived, is_adult, publication_status_id, total_chapters,
                   ${HIATUS_SELECT_COLUMNS},
                   work_covers(url, is_primary, position))`,
    )
    .not("platform_avg", "is", null)
    .gte("total_votes", MIN_VOTES)
    .eq("works.is_archived", false)
    .order("platform_avg", { ascending: false })
    // Over-fetch: parte das melhores não tem capa, e capa faltando numa vitrine é um buraco.
    .limit(limit * 4)

  if (error) {
    reportHandledServerError({ operation: "public-showcase.getPublicShowcase", error })
    return null
  }

  const rows = (data ?? []) as unknown as Array<{
    platform_avg: number | null
    total_votes: number | null
    works: {
      id: string
      title: string
      is_adult?: boolean | null
      publication_status_id: number | null
      total_chapters: number | null
      hiatus_kind?: HiatusKind | null
      hiatus_kind_confidence?: "high" | "low" | null
      publication_status_note?: string | null
      work_covers?: { url: string; is_primary: boolean; position: number }[] | null
    }
  }>

  const out: PublicShowcaseWork[] = []
  for (const row of rows) {
    const coverUrls = coverCandidates(row.works.work_covers)
    if (coverUrls.length === 0) continue
    // 18+ fica fora da vitrine pública por padrão: sem sessão não há preferência de ninguém
    // para consultar, e `hide_adult_content` cairia na do dono (mesmo padrão do eixo).
    if (row.works.is_adult) continue
    out.push({
      id: row.works.id,
      title: row.works.title,
      coverUrls,
      platformAvg: row.platform_avg,
      totalVotes: row.total_votes ?? 0,
      publicationStatusId: row.works.publication_status_id,
      isAdult: false,
      totalChapters: row.works.total_chapters,
      ...hiatusFieldsFromRow(row.works),
    })
    if (out.length >= limit) break
  }
  return out
}
