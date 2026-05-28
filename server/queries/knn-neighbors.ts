import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { KnnNeighbor } from "@/lib/ml/knn-predictor"

interface RpcRow {
  work_id: string
  similarity: number
  user_score: number
}

/**
 * Busca os top-k vizinhos rotulados no espaço de embeddings. Wrap em torno
 * da RPC `find_knn_with_user_score` (migration 055) — falha graciosamente
 * pra `[]` quando a tabela não tem embeddings ou a RPC não existe.
 */
export async function getKnnNeighbors(workId: string, k: number): Promise<KnnNeighbor[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("find_knn_with_user_score", {
    target_work_id: workId,
    match_limit: k,
  })
  if (error) {
    console.warn(`[knn-neighbors] RPC falhou pra ${workId}: ${error.message}`)
    return []
  }
  return (data as RpcRow[] | null ?? []).map((r) => ({
    workId: r.work_id,
    similarity: Number(r.similarity),
    userScore: Number(r.user_score),
  }))
}

/**
 * Versão em lote: busca vizinhos pra muitas obras em paralelo com
 * concorrência limitada pra não estressar o pool de conexões.
 */
export async function getKnnNeighborsBatch(
  workIds: string[],
  k: number,
  concurrency = 8,
): Promise<Map<string, KnnNeighbor[]>> {
  const result = new Map<string, KnnNeighbor[]>()
  let cursor = 0

  const worker = async () => {
    while (cursor < workIds.length) {
      const idx = cursor++
      const id = workIds[idx]
      const neighbors = await getKnnNeighbors(id, k)
      result.set(id, neighbors)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, workIds.length) }, () => worker())
  await Promise.all(workers)
  return result
}
