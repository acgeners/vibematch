import "server-only"
import type { createAdminClient } from "@/lib/supabase/admin"

type Admin = ReturnType<typeof createAdminClient>

/**
 * Recomputa `works.adult_auto` de UMA obra a partir dos sinais atuais (migração 161).
 *
 * MONOTÔNICO: só sobe (false→true); NUNCA desmarca — só o override humano faz isso.
 * Por isso, se a obra já é 18+ pelo auto, retorna cedo sem tocar em nada. Chame
 * depois de alterar as tags de uma obra (inferência por IA ou edição manual), pra
 * obras NOVAS ficarem classificadas sem depender de re-rodar o backfill.
 *
 * auto=true quando: ≥1 tag STRONG (explícita), OU (≥1 tag SOFT E nota adult_content ≥ 7).
 *
 * Best-effort: loga e volta em silêncio se algo falhar — nunca quebra o fluxo de salvar tags.
 */
export async function recomputeAdultAuto(supabase: Admin, workId: string): Promise<void> {
  try {
    const { data: work } = await supabase
      .from("works")
      .select("adult_auto")
      .eq("id", workId)
      .maybeSingle()
    // Monotônico: já 18+ pelo auto (ou obra inexistente) → nada a fazer.
    if (!work || (work as { adult_auto?: boolean }).adult_auto) return

    const { data: wtRows } = await supabase
      .from("work_tags")
      .select("tags(adult_indicator, adult_indicator_strong)")
      .eq("work_id", workId)
    const tags = ((wtRows ?? []) as unknown as Array<{
      tags: { adult_indicator: boolean; adult_indicator_strong: boolean } | null
    }>)
      .map((r) => r.tags)
      .filter((t): t is { adult_indicator: boolean; adult_indicator_strong: boolean } => !!t)

    const hasStrong = tags.some((t) => t.adult_indicator_strong)
    const hasSoft = tags.some((t) => t.adult_indicator && !t.adult_indicator_strong)
    if (!hasStrong && !hasSoft) return

    let reason: "tag_explicit" | "tag_soft_score" | null = null
    if (hasStrong) {
      reason = "tag_explicit"
    } else {
      // Tag SOFT (genérica) só flag com a nota corroborando (≥ 7).
      const { data: cs } = await supabase
        .from("category_scores")
        .select("score")
        .eq("work_id", workId)
        .eq("criterion_slug", "adult_content")
        .maybeSingle()
      if (((cs as { score?: number } | null)?.score ?? 0) >= 7) reason = "tag_soft_score"
    }
    if (!reason) return

    await supabase.from("works").update({ adult_auto: true, adult_reason: reason }).eq("id", workId)
  } catch (err) {
    console.warn("[recomputeAdultAuto] falhou:", err instanceof Error ? err.message : err)
  }
}
