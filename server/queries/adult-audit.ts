import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

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
  const { data, error } = await supabase
    .from("works")
    .select(
      "id, title, work_tags(tags(name, adult_indicator)), category_scores(criterion_slug, score)",
    )
    .eq("adult_reason", "ai_review_uncertain")
    .is("adult_override", null)
    .order("title", { ascending: true })

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as Array<{
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
