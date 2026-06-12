import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ManualReview } from "@/types/domain"

/**
 * Reviews escritas manualmente pelo usuário para uma obra, ordenadas por
 * `position`. Vivem em `work_manual_reviews` (separadas do snapshot destrutivo
 * de `work_reviews`) e são sempre reinjetadas no prompt da avaliação IA.
 */
export async function getManualReviews(workId: string): Promise<ManualReview[]> {
  if (!workId) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_manual_reviews")
    .select("id, text, user_rating, note, position")
    .eq("work_id", workId)
    .order("position", { ascending: true })

  if (error) {
    console.error("[manual-reviews] erro lendo reviews manuais:", error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    text: row.text,
    user_rating: row.user_rating != null ? Number(row.user_rating) : null,
    note: row.note ?? null,
    position: Number(row.position ?? 0),
  }))
}
