import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { countStaleEmbeddings } from "@/server/actions/embeddings"
import { countPendingSuggestions } from "@/server/queries/calibration"
import { getWorksMissingComixHid } from "@/server/queries/comix-coverage"
import { hasConsolidatableBlocks } from "@/lib/ai-recommendation/synopsis-consolidator"
import { splitSynopsesFromText } from "@/lib/work-derived"

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

/**
 * Obras (não arquivadas) sem sinopse canônica E que são CONSOLIDÁVEIS — i.e.
 * têm ≥1 bloco de sinopse longo o bastante (`hasConsolidatableBlocks`, mesmo
 * gate de `consolidatePendingSynopses`). Excluir as curtas/sem-sinopse evita o
 * badge "preso" (contava obras que o consolidador SEMPRE pula como "muito
 * curtas"). Espelha a expansão por bloco da própria ação de consolidação.
 */
export async function countPendingCanonicalSynopses(): Promise<number> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("works")
    .select("id, work_synopses(text)")
    .is("canonical_synopsis", null)
    .eq("is_archived", false)
  let pending = 0
  for (const w of data ?? []) {
    const rawTexts = ((w as { work_synopses?: Array<{ text: string | null }> }).work_synopses ?? [])
      .map((r) => (r.text ?? "").trim())
      .filter((t) => t.length > 0)
    const expanded = rawTexts.flatMap((t) => {
      const blocks = splitSynopsesFromText(t)
      return blocks.length > 0 ? blocks : [t]
    })
    if (hasConsolidatableBlocks(expanded)) pending += 1
  }
  return pending
}

/**
 * Obras com reviews RESUMÍVEIS salvas mas ainda sem `review_summary`. Usa o
 * agregado de contagem embutido do PostgREST (`work_reviews(count)`) filtrando
 * só as obras sem resumo. O filtro embedded `text_length>=40` espelha o limiar
 * do resumidor (review-summarizer.ts: reviews < 40 chars são descartadas) —
 * sem ele, uma obra cujo único review é minúsculo (ex.: 37 chars) contava como
 * "pendente" pra sempre, já que o backfill sempre a pulava (`no_content`).
 */
export async function countPendingReviewSummaries(): Promise<number> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("works")
    .select("id, work_reviews(count)")
    .is("review_summary", null)
    .eq("is_archived", false)
    .gte("work_reviews.text_length", 40)
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

/**
 * Pendências por ITEM (card) do console /settings — `Record<sectionId, count>`,
 * com o `sectionId` do registry (`app/settings/sections.tsx`). Cada fonte mapeia
 * 1:1 com um item; o badge do GRUPO (sub-nav) é a soma dos itens do grupo e o
 * badge da sidebar é a soma de tudo — assim os três níveis (sidebar → tópico →
 * card) batem. Memoizado por request (`cache`) para o layout (grupos) e a page
 * (cards) compartilharem uma única computação. Só entram itens com pendência
 * acionável; contagens baratas, em paralelo, sem LLM. Cada parcela falha em 0.
 */
export const getSettingsItemPending = cache(
  async (): Promise<Record<string, number>> => {
    const [suggestions, embeddings, canonicalSynopsis, reviewSummary, comixMissing] =
      await Promise.all([
        countPendingSuggestions().catch(() => 0),
        countMissingEmbeddings().catch(() => 0),
        countPendingCanonicalSynopses().catch(() => 0),
        countPendingReviewSummaries().catch(() => 0),
        getWorksMissingComixHid()
          .then((w) => w.length)
          .catch(() => 0),
      ])
    return {
      "ai-calibration": suggestions,
      embeddings,
      "synopsis-canonical": canonicalSynopsis,
      "review-synthesis": reviewSummary,
      comix: comixMissing,
    }
  },
)
