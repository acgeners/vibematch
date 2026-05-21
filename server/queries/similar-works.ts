import { createAdminClient } from "@/lib/supabase/admin"
import { pickPrimaryCover, pickPrimarySynopsis } from "@/lib/work-derived"

export interface SimilarWork {
  id: string
  title: string
  similarity: number
  coverUrl: string | null
  synopsis: string | null
  finalScore: number | null
  personalFit: number | null
  manualScore: number | null
}

interface RpcRow {
  id: string
  title: string
  similarity: number
  manual_score: number | null
  final_score: number | null
  personal_fit: number | null
  cover_url: string | null
  synopsis: string | null
}

/**
 * Top-K obras mais similares à obra alvo via cosine distance (`<=>`).
 *
 * Implementação via RPC `find_similar_works` (criada na migration 054) pra
 * permitir comparar embedding sem trafegar 1536 floats do server até o cliente
 * Supabase e voltar. Exclui a própria obra e obras arquivadas.
 */
export async function getSimilarWorks(
  workId: string,
  limit = 10,
): Promise<SimilarWork[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc("find_similar_works", {
    target_work_id: workId,
    match_limit: limit,
  })

  if (error) {
    // Tipicamente "function does not exist" antes da migration rodar — degradar pra vazio
    console.warn("[similar-works] RPC falhou:", error.message)
    return []
  }

  return (data as RpcRow[] | null ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    similarity: Number(r.similarity),
    coverUrl: r.cover_url,
    synopsis: r.synopsis,
    finalScore: r.final_score == null ? null : Number(r.final_score),
    personalFit: r.personal_fit == null ? null : Number(r.personal_fit),
    manualScore: r.manual_score == null ? null : Number(r.manual_score),
  }))
}

// Re-exports usados pelo componente cliente
export { pickPrimaryCover, pickPrimarySynopsis }
