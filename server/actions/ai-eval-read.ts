"use server"

import { revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAllQueueMemberIds, READ_QUEUES, type ReadQueue } from "@/server/queries/ai-eval-read"

/**
 * Ações de "marcar pendências como lidas" em /ai-evaluation. "Lida" silencia a
 * pendência (sai dos contadores/badge) SEM resolvê-la — a obra continua na fila.
 * Ver migration 125 (`ai_eval_read_acks`) e `server/queries/ai-eval-read.ts`.
 */

function invalidateEvalChrome() {
  // Só invalida os contadores cacheados por tag. O router.refresh() do cliente
  // (via useRefresh) já re-renderiza a página — e getReadAckSets não é cacheado,
  // então os cards ganham/perdem "Lida" na re-renderização, sem revalidatePath.
  revalidateTag("ai-eval-tab-counts", "max")
}

/**
 * Marca TUDO como lido (ação binária global): acka todos os membros atuais das 5
 * filas. Idempotente (ignora duplicatas). Retorna quantas acks passaram a existir.
 */
export async function markAllAiEvalRead(): Promise<{ ok: boolean; marked: number }> {
  const membersByQueue = await getAllQueueMemberIds()
  const rows: { work_id: string; queue: ReadQueue }[] = []
  for (const queue of READ_QUEUES) {
    for (const id of membersByQueue[queue]) rows.push({ work_id: id, queue })
  }
  if (rows.length === 0) return { ok: true, marked: 0 }

  const supabase = createAdminClient()
  // Chunk de 500 linhas por upsert (bem abaixo dos limites de payload do PostgREST).
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await supabase
      .from("ai_eval_read_acks")
      .upsert(chunk, { onConflict: "work_id,queue", ignoreDuplicates: true })
    if (error) throw new Error(`Falha marcando pendências como lidas: ${error.message}`)
  }
  invalidateEvalChrome()
  return { ok: true, marked: rows.length }
}

/**
 * Desmarca TUDO (limpa a tabela de acks) — "nada" lido. Volta a contar todas as
 * pendências.
 */
export async function unmarkAllAiEvalRead(): Promise<{ ok: boolean }> {
  const supabase = createAdminClient()
  // DELETE sem WHERE não é aceito pelo PostgREST; filtro sempre-verdadeiro.
  const { error } = await supabase.from("ai_eval_read_acks").delete().not("work_id", "is", null)
  if (error) throw new Error(`Falha desmarcando pendências: ${error.message}`)
  invalidateEvalChrome()
  return { ok: true }
}

/**
 * Desmarca UMA obra numa fila (clicar no selo "Lida" do card) — ela volta a
 * contar naquela aba/badge.
 */
export async function unmarkAiEvalWork(workId: string, queue: ReadQueue): Promise<{ ok: boolean }> {
  if (!workId || !READ_QUEUES.includes(queue)) {
    throw new Error("Obra/fila inválida ao desmarcar como lida.")
  }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("ai_eval_read_acks")
    .delete()
    .eq("work_id", workId)
    .eq("queue", queue)
  if (error) throw new Error(`Falha desmarcando obra como lida: ${error.message}`)
  invalidateEvalChrome()
  return { ok: true }
}
