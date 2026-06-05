import { createAdminClient } from "@/lib/supabase/admin"
import { countStaleEmbeddings } from "@/server/actions/embeddings"

/**
 * Pendências do "Pipeline de dados" da página /settings.
 *
 * Duas variantes:
 *   - getSettingsPendingCounts()      → EXATA, usada pela própria página. Pode ser
 *     pesada (countStaleEmbeddings carrega o catálogo + hashing), mas roda 1× por
 *     visita.
 *   - getSettingsBadgePendingTotal()  → BARATA, usada pelo badge da sidebar (roda
 *     a cada navegação). Sem cache (sempre fresca, pra nunca ficar "presa") e sem
 *     o join de 3MB do hashing — usa sinais leves equivalentes/aproximados.
 * Nenhuma faz chamada de LLM/OpenAI.
 */

/** Obras (não arquivadas) sem sinopse canônica consolidada. Head-count barato. */
export async function countPendingCanonicalSynopses(): Promise<number> {
  const supabase = createAdminClient()
  const { count } = await supabase
    .from("works")
    .select("id", { count: "exact", head: true })
    .is("canonical_synopsis", null)
    .eq("is_archived", false)
  return count ?? 0
}

/**
 * Obras com reviews salvas mas ainda sem `review_summary`. Usa o agregado de
 * contagem embutido do PostgREST (`work_reviews(count)`) filtrando só as obras
 * sem resumo — evita paginar milhares de linhas de `work_reviews`. Exatamente
 * equivalente a "tem ≥1 review E não tem resumo".
 */
export async function countPendingReviewSummaries(): Promise<number> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("works")
    .select("id, work_reviews(count)")
    .is("review_summary", null)
    .eq("is_archived", false)
  let pending = 0
  for (const w of data ?? []) {
    const rel = (w as { work_reviews?: Array<{ count: number }> }).work_reviews
    if ((rel?.[0]?.count ?? 0) > 0) pending += 1
  }
  return pending
}

/**
 * Obras (não arquivadas) SEM linha em `work_embeddings` — i.e. nunca embedadas.
 * Sinal leve pro badge (só ids dos dois lados, sem o join de conteúdo do
 * hashing). NÃO detecta embedding com hash desatualizado (conteúdo editado) —
 * isso a página exibe via `countStaleEmbeddings`. Pro badge, "nunca embedada" é
 * o sinal dominante (obra recém-adicionada).
 */
export async function countMissingEmbeddings(): Promise<number> {
  const supabase = createAdminClient()
  const [works, emb] = await Promise.all([
    supabase.from("works").select("id").eq("is_archived", false),
    supabase.from("work_embeddings").select("work_id"),
  ])
  const embedded = new Set((emb.data ?? []).map((r) => (r as { work_id: string }).work_id))
  let missing = 0
  for (const w of works.data ?? []) {
    if (!embedded.has((w as { id: string }).id)) missing += 1
  }
  return missing
}

export interface SettingsPendingCounts {
  embeddings: number
  canonicalSynopsis: number
  reviewSummary: number
  /** Soma das três (tarefas independentes — uma obra pode contar em mais de uma). */
  total: number
}

/**
 * Versão EXATA (página /settings): embeddings = hash desatualizado/ausente.
 */
export async function getSettingsPendingCounts(): Promise<SettingsPendingCounts> {
  const [embeddings, canonicalSynopsis, reviewSummary] = await Promise.all([
    countStaleEmbeddings()
      .then((r) => r.pending)
      .catch(() => 0),
    countPendingCanonicalSynopses(),
    countPendingReviewSummaries(),
  ])
  return {
    embeddings,
    canonicalSynopsis,
    reviewSummary,
    total: embeddings + canonicalSynopsis + reviewSummary,
  }
}

/**
 * Total BARATO pro badge da sidebar (sempre fresco). Difere da versão exata só
 * no sinal de embeddings (ausente vs hash-desatualizado).
 */
export async function getSettingsBadgePendingTotal(): Promise<number> {
  const [embeddings, canonicalSynopsis, reviewSummary] = await Promise.all([
    countMissingEmbeddings(),
    countPendingCanonicalSynopses(),
    countPendingReviewSummaries(),
  ])
  return embeddings + canonicalSynopsis + reviewSummary
}
