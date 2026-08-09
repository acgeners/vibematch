import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Proveniência (modelo + data) dos artefatos de IA que NÃO têm coluna de modelo
 * própria — sinopse consolidada, síntese estruturada das reviews e resumo em prosa.
 *
 * O modelo vem do log central `ai_api_calls`, ligado à obra por
 * `metadata->>'work_id'`. Não é preferência de estilo: **o modelo mudou ao longo
 * do tempo** (medido em 2026-08-08: `synopsis_consolidator` tem 2 modelos distintos
 * no histórico, `review_digest` também). Fixar "Sonnet" numa constante mentiria em
 * toda obra gerada antes da troca — e mentiria em silêncio, com resultado plausível.
 *
 * 🔴 **Cobertura é PARCIAL, e isso é do dado, não do código.** O log só começa em
 * 03/07/2026; para obra gerada antes, o modelo não existe em lugar nenhum. Medido
 * no clone local em 2026-08-08:
 *
 * | Artefato | obras com o artefato | com modelo recuperável |
 * |---|---|---|
 * | sinopse consolidada | 980 | 327 (33%) |
 * | síntese das reviews | 841 | 487 (58%) |
 * | resumo em prosa | 885 | 498 (56%) |
 *
 * Quem consome mostra "não registrado" no lugar — nunca um chute.
 *
 * ⚠️ `tag_inference` fica de fora porque não dá: as 587 chamadas medidas gravam
 * `nCandidates`/`withReviews` no metadata e **zero** gravam `work_id`, então não há
 * como ligá-las a uma obra. A data continua vindo de `works.tags_inferred_at`.
 */

const PROVENANCE_OPERATIONS = [
  "synopsis_consolidator",
  "review_digest",
  "review_summarizer",
] as const

export type AiProvenanceOperation = (typeof PROVENANCE_OPERATIONS)[number]

export interface AiCallProvenance {
  model: string | null
  promptVersion: string | null
  at: string
}

export type WorkAiProvenance = Partial<Record<AiProvenanceOperation, AiCallProvenance>>

/**
 * Teto de linhas lidas. Medido no catálogo local (2026-08-08) somando as três
 * operações: **máximo 33 chamadas por obra**, p99 = 22, média 4,3. 200 é ~6× o pior
 * caso real; se o teto for atingido, o console avisa — em vez de a página perder em
 * silêncio o modelo de uma operação antiga empurrada pra fora da janela, que é a
 * família de bug do corte em 1000 linhas.
 */
const MAX_ROWS = 200

/**
 * Modelo + data da ÚLTIMA chamada bem-sucedida de cada operação para esta obra.
 *
 * Uma query só, com `metadata->>'work_id'` (não há coluna dedicada — ver migration
 * 059). Sem índice nesse campo JSONB: medido em 0,8 ms com 4,7 mil linhas, e a
 * chamada entra no `Promise.all` da página, então não soma round-trip ao wall-clock.
 *
 * Fail-soft: erro devolve `{}` e cada selo cai em "não registrado". Derrubar a
 * página da obra por causa de um metadado seria trocar um problema pequeno por um
 * grande.
 */
export async function getWorkAiProvenance(workId: string): Promise<WorkAiProvenance> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("ai_api_calls")
    .select("operation, model_name, prompt_version, created_at")
    .eq("metadata->>work_id", workId)
    .in("operation", PROVENANCE_OPERATIONS as unknown as string[])
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS)

  if (error) {
    console.error("[ai-provenance] getWorkAiProvenance falhou:", error.message)
    return {}
  }

  const rows = (data ?? []) as Array<{
    operation: string
    model_name: string | null
    prompt_version: string | null
    created_at: string
  }>

  if (rows.length === MAX_ROWS) {
    console.warn(
      `[ai-provenance] obra ${workId} atingiu o teto de ${MAX_ROWS} chamadas — ` +
        "a operação mais antiga pode ter ficado fora da janela.",
    )
  }

  // Ordenado por data desc: a PRIMEIRA linha de cada operação já é a mais recente.
  const out: WorkAiProvenance = {}
  for (const row of rows) {
    const op = row.operation as AiProvenanceOperation
    if (out[op]) continue
    out[op] = {
      model: row.model_name ?? null,
      promptVersion: row.prompt_version ?? null,
      at: row.created_at,
    }
  }
  return out
}

/**
 * Modelo da run que produziu o Veredito IA desta obra.
 *
 * O Veredito guarda `alignment_run_id`, e é `recommendation_runs` quem sabe o modelo.
 * 🔴 Cobertura medida (2026-08-08): **66 de 501** vereditos (13%) têm `alignment_run_id` —
 * os demais vieram de caminhos que gravaram a nota sem a FK. Sem run, "não registrado".
 */
export async function getAlignmentRunModel(runId: string | null | undefined): Promise<string | null> {
  if (!runId) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("recommendation_runs")
    .select("model_name")
    .eq("id", runId)
    .maybeSingle()
  if (error) {
    console.error("[ai-provenance] getAlignmentRunModel falhou:", error.message)
    return null
  }
  return (data?.model_name as string | null) ?? null
}

/**
 * Modelo e data do embedding desta obra — o que ordena "Obras parecidas".
 *
 * Vai no tooltip que JÁ explica o método (o ℹ️ do card), não num selo ✨: a lista
 * não é texto gerado por um LLM, é busca vetorial. Dar a ela a mesma marca da
 * sinopse consolidada afirmaria uma coisa que não é verdade.
 */
export async function getWorkEmbeddingProvenance(
  workId: string,
): Promise<{ model: string | null; at: string | null } | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_embeddings")
    .select("model_name, updated_at")
    .eq("work_id", workId)
    .maybeSingle()
  if (error) {
    console.error("[ai-provenance] getWorkEmbeddingProvenance falhou:", error.message)
    return null
  }
  if (!data) return null
  return {
    model: (data.model_name as string | null) ?? null,
    at: (data.updated_at as string | null) ?? null,
  }
}
