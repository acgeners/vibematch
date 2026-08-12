import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover } from "@/lib/covers"
import { HIATUS_SELECT_COLUMNS, hiatusFieldsFromRow } from "@/lib/works/hiatus-display"
import type { HiatusFields } from "@/lib/works/hiatus-display"
import type { HiatusKind } from "@/lib/external/hiatus-kind"

export type HeroWork = HiatusFields & {
  title: string
  coverUrl: string
  nota: number | null
  publicationStatusId: number | null
}

/**
 * Capas reais pro painel do login/signup — as melhores obras por MÉDIA DAS PLATAFORMAS que
 * tenham capa. Over-fetch + filtra pelas que têm capa. Falha silenciosa (retorna []) — o hero
 * degrada pro fundo sem cascata, nunca derruba a página.
 *
 * ⚠️ Ordenava por `expected_score` e lia `works_owner` (a view do DONO), trazendo até o
 * `personal_status_id` dele — numa tela que roda DESLOGADA. Era o mesmo padrão do eixo público
 * corrigido em `getScoresReader`: preferência de uma pessoa exibida como se fosse a avaliação
 * do acervo, aqui na primeira tela que um visitante vê. Agora usa `works` e um campo de
 * catálogo; o status pessoal sai do tipo, porque não há "pessoal" sem sessão.
 */
export async function getAuthHeroWorks(limit = 21): Promise<HeroWork[]> {
  const supabase = createAdminClient()
  // `works` (não `works_owner`): a view é a fonte do DONO. Numa tela deslogada, nenhuma
  // coluna pessoal deve entrar — nem de enfeite.
  const { data, error } = await supabase
    .from("calculated_scores")
    .select(
      `platform_avg, works!inner(title, is_archived, publication_status_id, ${HIATUS_SELECT_COLUMNS}, work_covers(url, is_primary, position))`,
    )
    .not("platform_avg", "is", null)
    .eq("works.is_archived", false)
    .order("platform_avg", { ascending: false })
    .limit(90)

  if (error) return []

  const rows = (data ?? []) as unknown as Array<{
    platform_avg: number | null
    works: {
      title: string
      publication_status_id: number | null
      hiatus_kind?: HiatusKind | null
      hiatus_kind_confidence?: "high" | "low" | null
      publication_status_note?: string | null
      work_covers?: { url: string; is_primary: boolean }[] | null
    }
  }>

  const out: HeroWork[] = []
  for (const row of rows) {
    const coverUrl = pickPrimaryCover(row.works.work_covers)
    if (!coverUrl) continue
    out.push({
      title: row.works.title,
      coverUrl,
      nota: row.platform_avg,
      publicationStatusId: row.works.publication_status_id,
      ...hiatusFieldsFromRow(row.works),
    })
    if (out.length >= limit) break
  }
  return out
}

export type SiteStats = { works: number; criteria: number; reviews: number; sources: number }

/**
 * Números reais do catálogo pra vitrine do login/signup — contagens (head:true,
 * sem trazer linhas). Falha por-métrica: uma tabela ausente vira 0 e a UI a
 * esconde, nunca derruba a página.
 */
export async function getSiteStats(): Promise<SiteStats> {
  const supabase = createAdminClient()
  const [w, c, r, s] = await Promise.all([
    supabase.from("works").select("*", { count: "exact", head: true }).eq("is_archived", false),
    supabase.from("category_scores").select("*", { count: "exact", head: true }),
    supabase.from("work_reviews").select("*", { count: "exact", head: true }),
    supabase.from("source").select("*", { count: "exact", head: true }),
  ])
  return {
    works: w.count ?? 0,
    criteria: c.count ?? 0,
    reviews: r.count ?? 0,
    sources: s.count ?? 0,
  }
}
