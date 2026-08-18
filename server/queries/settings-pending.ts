import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { countStaleEmbeddings } from "@/server/embeddings/refresh"
import { getWorksMissingComixHid } from "@/server/queries/comix-coverage"
import { hasConsolidatableBlocks } from "@/lib/ai-recommendation/synopsis-consolidator"
import { splitSynopsesFromText } from "@/lib/work-derived"

/**
 * Pendências do "Pipeline de dados" da página /curation/settings.
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
  // Pagina: `select` sem `.range()` corta em 1000 sem erro, e uma regressão em
  // massa (backfill que zera `canonical_synopsis`) põe o universo acima do corte
  // justo quando a contagem mais importa. Hoje são 0 obras — é rede, não sintoma.
  const data = await fetchAllRows<{ id: string; work_synopses?: Array<{ text: string | null }> }>(
    (from, to) =>
      supabase
        .from("works")
        .select("id, work_synopses(text)")
        .is("canonical_synopsis", null)
        .eq("is_archived", false)
        .range(from, to),
    "countPendingCanonicalSynopses",
  )
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
  // Pagina pelo mesmo motivo de `countPendingCanonicalSynopses` (hoje são 8 obras).
  const data = await fetchAllRows<{ id: string; work_reviews?: Array<{ count: number }> }>(
    (from, to) =>
      supabase
        .from("works")
        .select("id, work_reviews(count)")
        .is("review_summary", null)
        .eq("is_archived", false)
        .gte("work_reviews.text_length", 40)
        .range(from, to),
    "countPendingReviewSummaries",
  )
  let pending = 0
  for (const w of data ?? []) {
    const rel = (w as { work_reviews?: Array<{ count: number }> }).work_reviews
    if ((rel?.[0]?.count ?? 0) > 0) pending += 1
  }
  return pending
}

/**
 * Obras ATIVAS sem linha em `work_embeddings`.
 *
 * 🔴 Ela fazia a diferença em JS entre dois `select` SEM `.range()` — e o PostgREST
 * corta em 1000 linhas sem avisar. Passado o corte, a conta compara dois recortes
 * ARBITRÁRIOS de 1000 e devolve um número que NUNCA chega a zero: medido contra a
 * nuvem em 2026-08-18, 1009 obras ativas × 1016 embeddings davam **15 pendentes**
 * onde o real é **0**. Era o badge preso — nem rodar "Atualizar embeddings" nem
 * recarregar a página resolviam, porque não havia o que resolver. (No LOCAL, com
 * 978 obras, os mesmos dois selects davam 0: o defeito só aparece depois do corte.)
 *
 * Hoje é UMA contagem no servidor — LEFT JOIN filtrado por `is null`, com
 * `count: "exact", head: true`. Sem teto de linhas e sem trafegar linha nenhuma:
 * a versão antiga puxava ~2000 ids a cada leitura do chrome, que roda a cada
 * navegação (ver o §Egress do CLAUDE.md).
 */
export async function countMissingEmbeddings(): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("works")
    .select("id, work_embeddings!left(work_id)", { count: "exact", head: true })
    .eq("is_archived", false)
    .is("work_embeddings", null)
  if (error) throw new Error(`countMissingEmbeddings: ${error.message}`)
  return count ?? 0
}

export interface SettingsPendingCounts {
  embeddings: number
  canonicalSynopsis: number
  reviewSummary: number
  /** Soma das três (tarefas independentes — uma obra pode contar em mais de uma). */
  total: number
}

/**
 * Versão EXATA (página /curation/settings): embeddings = hash desatualizado/ausente.
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
 * Pendências por ITEM (card) do console /curation/settings — `Record<sectionId, count>`,
 * com o `sectionId` do registry (`app/curation/settings/sections.tsx`). Cada fonte mapeia
 * 1:1 com um item; o badge do GRUPO (sub-nav) é a soma dos itens do grupo e o
 * badge da sidebar é a soma de tudo — assim os três níveis (sidebar → tópico →
 * card) batem. Memoizado por request (`cache`) para o layout (grupos) e a page
 * (cards) compartilharem uma única computação. Só entram itens com pendência
 * acionável; contagens baratas, em paralelo, sem LLM. Cada parcela falha em 0.
 */
export const getSettingsItemPending = cache(
  async (): Promise<Record<string, number>> => {
    const [embeddings, canonicalSynopsis, reviewSummary, comixMissing] =
      await Promise.all([
        countMissingEmbeddings().catch(() => 0),
        countPendingCanonicalSynopses().catch(() => 0),
        countPendingReviewSummaries().catch(() => 0),
        getWorksMissingComixHid()
          .then((w) => w.length)
          .catch(() => 0),
      ])
    return {
      // 🔴 A auditoria de critérios IA foi APOSENTADA em 2026-08-16 e não tem entrada aqui.
      // Ela escrevia num dado COMPARTILHADO (`category_scores`, sem `user_id`) usando a
      // pós-leitura de UM usuário — a mesma contaminação que o formulário da obra bloqueia
      // ao deixar os 9 atributos read-only. E a conta de vazão nunca fechou: 58 decisões
      // humanas em 84 dias contra ~250 sugestões por execução.
      embeddings,
      "synopsis-canonical": canonicalSynopsis,
      "review-synthesis": reviewSummary,
      comix: comixMissing,
    }
  },
)
