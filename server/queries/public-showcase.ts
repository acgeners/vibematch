import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover } from "@/lib/covers"

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

export interface PublicShowcaseWork {
  id: string
  title: string
  coverUrl: string | null
  /** Média das plataformas externas (0–10) — fato da obra, igual para todo visitante. */
  platformAvg: number | null
  totalVotes: number
  publicationStatusId: number | null
  isAdult: boolean
  totalChapters: number | null
}

/** Piso de votos para entrar na vitrine: abaixo disso a média não é sinal, é acaso. */
const MIN_VOTES = 300

export async function getPublicShowcase(limit = 12): Promise<PublicShowcaseWork[]> {
  const supabase = createAdminClient()

  // `works!inner` (não `works_owner`): a view é a fonte do DONO e carrega as colunas pessoais
  // dele. Numa página pública isso não pode entrar nem por acidente.
  const { data, error } = await supabase
    .from("calculated_scores")
    .select(
      `platform_avg, total_votes,
       works!inner(id, title, is_archived, is_adult, publication_status_id, total_chapters,
                   work_covers(url, is_primary, position))`,
    )
    .not("platform_avg", "is", null)
    .gte("total_votes", MIN_VOTES)
    .eq("works.is_archived", false)
    .order("platform_avg", { ascending: false })
    // Over-fetch: parte das melhores não tem capa, e capa faltando numa vitrine é um buraco.
    .limit(limit * 4)

  if (error) return []

  const rows = (data ?? []) as unknown as Array<{
    platform_avg: number | null
    total_votes: number | null
    works: {
      id: string
      title: string
      is_adult?: boolean | null
      publication_status_id: number | null
      total_chapters: number | null
      work_covers?: { url: string; is_primary: boolean; position: number }[] | null
    }
  }>

  const out: PublicShowcaseWork[] = []
  for (const row of rows) {
    const coverUrl = pickPrimaryCover(row.works.work_covers)
    if (!coverUrl) continue
    // 18+ fica fora da vitrine pública por padrão: sem sessão não há preferência de ninguém
    // para consultar, e `hide_adult_content` cairia na do dono (mesmo padrão do eixo).
    if (row.works.is_adult) continue
    out.push({
      id: row.works.id,
      title: row.works.title,
      coverUrl,
      platformAvg: row.platform_avg,
      totalVotes: row.total_votes ?? 0,
      publicationStatusId: row.works.publication_status_id,
      isAdult: false,
      totalChapters: row.works.total_chapters,
    })
    if (out.length >= limit) break
  }
  return out
}
