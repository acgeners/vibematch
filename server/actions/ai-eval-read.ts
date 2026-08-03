"use server"

import { revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUserId } from "@/server/queries/current-user"
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
 * Marca TUDO como lido nas filas pedidas (ação binária por página): acka todos
 * os membros atuais dessas filas. Idempotente (ignora duplicatas). Retorna
 * quantas acks passaram a existir. Default = as 5 filas (compat).
 */
export async function markAllAiEvalRead(
  queues: readonly ReadQueue[] = READ_QUEUES,
): Promise<{ ok: boolean; marked: number }> {
  // Marcar como lido é escrever o SEU julgamento (migration 176). Sem sessão não há
  // de quem seja — e antes da 176 a gravação caía numa tabela sem dono: medido, uma
  // conta de Leitor com `0/0/1` nas abas gravou 1907 linhas que valiam para todos.
  const userId = await getSessionUserId()
  if (!userId) return { ok: false, marked: 0 }

  const membersByQueue = await getAllQueueMemberIds(queues)
  const rows: { user_id: string; work_id: string; queue: ReadQueue }[] = []
  for (const queue of queues) {
    for (const id of membersByQueue[queue]) rows.push({ user_id: userId, work_id: id, queue })
  }
  if (rows.length === 0) return { ok: true, marked: 0 }

  const supabase = createAdminClient()
  // Chunk de 500 linhas por upsert (bem abaixo dos limites de payload do PostgREST).
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await supabase
      .from("ai_eval_read_acks")
      // Acompanha a PK da 176. Sem o `user_id` aqui, o ack de uma pessoa
      // SOBRESCREVERIA o de outra na mesma obra/fila em vez de coexistir.
      .upsert(chunk, { onConflict: "user_id,work_id,queue", ignoreDuplicates: true })
    if (error) throw new Error(`Falha marcando pendências como lidas: ${error.message}`)
  }
  invalidateEvalChrome()
  return { ok: true, marked: rows.length }
}

/**
 * Desmarca TUDO nas filas pedidas (limpa os acks só dessas filas) — "nada"
 * lido nelas. Volta a contar todas as pendências dessas filas. Default = as 5
 * filas (compat) — vira o delete geral de antes, só que expresso como filtro.
 */
export async function unmarkAllAiEvalRead(
  queues: readonly ReadQueue[] = READ_QUEUES,
): Promise<{ ok: boolean }> {
  // Antes da 176 este delete não tinha `user_id`: desmarcar apagava os acks de TODO
  // MUNDO naquelas filas, não os seus.
  const userId = await getSessionUserId()
  if (!userId) return { ok: false }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("ai_eval_read_acks")
    .delete()
    .eq("user_id", userId)
    .in("queue", queues as string[])
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
  const userId = await getSessionUserId()
  if (!userId) return { ok: false }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("ai_eval_read_acks")
    .delete()
    .eq("user_id", userId)
    .eq("work_id", workId)
    .eq("queue", queue)
  if (error) throw new Error(`Falha desmarcando obra como lida: ${error.message}`)
  invalidateEvalChrome()
  return { ok: true }
}
