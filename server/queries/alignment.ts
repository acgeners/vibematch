import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Marca o alignment_score (IA Rk) de uma obra como desatualizado.
 *
 * Chamado quando a obra é editada ou re-avaliada pela IA — o re-rank persistido
 * em `calculated_scores.alignment_score` deixa de refletir o estado atual da
 * obra. NÃO recomputa o ranking (isso é manual, via re-rank por-obra ou a fila
 * dedicada); só ergue a flag pra UI sinalizar "desatualizado".
 *
 * No-op silencioso quando a obra não tem alignment_score (nunca passou pelo
 * IA re-rank) — não faz sentido marcar como stale o que nunca foi computado.
 */
export async function markWorkAlignmentStale(workId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("calculated_scores")
    .update({ alignment_stale: true })
    .eq("work_id", workId)
    .not("alignment_score", "is", null)
  if (error) {
    console.warn("[alignment] markWorkAlignmentStale falhou:", error.message)
  }
}
