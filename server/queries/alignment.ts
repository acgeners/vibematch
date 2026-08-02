import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Marca o alignment_score (IA Rk) de uma obra como desatualizado.
 *
 * Chamado quando a obra é editada ou re-avaliada pela IA — o re-rank persistido
 * em `calculated_scores.alignment_score` (dono) e/ou `user_calculated_scores`
 * (demais usuários — ver `persistAlignmentScores` em
 * `server/actions/recommendations.ts`) deixa de refletir o estado atual da
 * obra. NÃO recomputa o ranking (isso é manual, via re-rank por-obra ou a fila
 * dedicada); só ergue a flag pra UI sinalizar "desatualizado" — pra QUALQUER
 * usuário que já tenha um Veredito IA persistido pra esta obra, não só o dono.
 *
 * No-op silencioso quando a linha não tem alignment_score (nunca passou pelo
 * IA re-rank) — não faz sentido marcar como stale o que nunca foi computado.
 */
export async function markWorkAlignmentStale(workId: string): Promise<void> {
  const supabase = createAdminClient()
  const [catalogResult, personalResult] = await Promise.all([
    supabase
      .from("calculated_scores")
      .update({ alignment_stale: true })
      .eq("work_id", workId)
      .not("alignment_score", "is", null),
    supabase
      .from("user_calculated_scores")
      .update({ alignment_stale: true })
      .eq("work_id", workId)
      .not("alignment_score", "is", null),
  ])
  if (catalogResult.error) {
    console.warn("[alignment] markWorkAlignmentStale (calculated_scores) falhou:", catalogResult.error.message)
  }
  if (personalResult.error) {
    console.warn("[alignment] markWorkAlignmentStale (user_calculated_scores) falhou:", personalResult.error.message)
  }
}
