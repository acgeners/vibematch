import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover } from "@/lib/covers"

export type HeroWork = {
  title: string
  coverUrl: string
  nota: number | null
  publicationStatusId: number | null
  personalStatusId: number | null
}

/**
 * Capas reais pro painel do login/signup — as melhores obras por Nota Prevista
 * que tenham capa. Público (roda no login deslogado): mostra o catálogo do
 * dono como vitrine. Over-fetch + filtra pelas que têm capa. Falha silenciosa
 * (retorna []) — o hero degrada pro fundo sem cascata, nunca derruba a página.
 */
export async function getAuthHeroWorks(limit = 21): Promise<HeroWork[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("calculated_scores")
    .select(
      `expected_score, works!inner(title, is_archived, publication_status_id, personal_status_id, work_covers(url, is_primary, position))`,
    )
    .not("expected_score", "is", null)
    .eq("works.is_archived", false)
    .order("expected_score", { ascending: false })
    .limit(90)

  if (error) return []

  const rows = (data ?? []) as unknown as Array<{
    expected_score: number | null
    works: {
      title: string
      publication_status_id: number | null
      personal_status_id: number | null
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
      nota: row.expected_score,
      publicationStatusId: row.works.publication_status_id,
      personalStatusId: row.works.personal_status_id,
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
