import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { coverCandidates } from "@/lib/work-derived"

export interface WelcomeCover {
  title: string
  coverUrls: string[]
}

/**
 * Capas reais para o leque da 1ª tela das boas-vindas e para os exemplos da tela de conforto:
 * as obras com MAIS VOTOS nas plataformas que têm capa.
 *
 * Só obra não adulta: as duas telas aparecem ANTES de a pessoa escolher se quer ver 18+.
 *
 * Falha silenciosa (devolve []): a tela cai nos blocos de cor de antes, nunca quebra.
 */
export async function getWelcomeCovers(limit = 5): Promise<WelcomeCover[]> {
  return mostVotedCovers({ adult: false, limit })
}

/**
 * A capa do exemplo 18+ da tela de conteúdo adulto: a obra ADULTA mais votada, desenhada BORRADA
 * até a pessoa confirmar a idade (decisão de 19/11/2026). É obra adulta de verdade, então o selo
 * 18+ sobre ela é verdadeiro — o que não se pode é marcar 18+ uma capa de obra que não é.
 * `null` (nenhuma, ou erro): a tela usa o bloco de cor de antes.
 */
export async function getWelcomeAdultCover(): Promise<WelcomeCover | null> {
  return (await mostVotedCovers({ adult: true, limit: 1 }))[0] ?? null
}

async function mostVotedCovers({ adult, limit }: { adult: boolean; limit: number }): Promise<WelcomeCover[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("calculated_scores")
    .select("total_votes, works!inner(title, is_archived, is_adult, work_covers(url, is_primary, position))")
    .eq("works.is_archived", false)
    .eq("works.is_adult", adult)
    .not("total_votes", "is", null)
    .order("total_votes", { ascending: false })
    .order("work_id", { ascending: true })
    .limit(30)
  if (error) {
    console.error("[boas-vindas] capas:", error.message)
    return []
  }

  const out: WelcomeCover[] = []
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const w = (Array.isArray(row.works) ? row.works[0] : row.works) as
      | { title: string; work_covers?: { url: string; is_primary: boolean; position: number | null }[] | null }
      | null
    if (!w) continue
    const coverUrls = coverCandidates(w.work_covers as never)
    if (coverUrls.length === 0) continue
    out.push({ title: w.title, coverUrls })
    if (out.length >= limit) break
  }
  return out
}
