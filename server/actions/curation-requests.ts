"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin, ensureSignedIn } from "@/server/queries/current-user"
import { withinRateLimit } from "@/lib/rate-limit"
import type { CurationRequestKind } from "@/server/queries/curation-requests"

/**
 * Pedidos do leitor para o curador. O leitor não raspa mais fonte externa em produção
 * (ver `project-curadoria-centralizada-solicitacoes`); isto é o canal para pedir o que ele
 * não pode fazer.
 *
 * ⚠️ Toda função aqui é `"use server"`, ou seja, ENDPOINT HTTP PÚBLICO
 * ([[project_use_server_public_endpoints]]). Nenhuma confia no cliente: quem é o dono vem da
 * SESSÃO, nunca de argumento.
 */

// Um humano pedindo coisas faz isso algumas vezes por sessão. O teto é generoso pra gente e
// apertado pra script; a constraint parcial da migration 177 já barra o pedido REPETIDO, então
// isto aqui cobre o caso de martelar pedidos DIFERENTES.
const REQUESTS_PER_HOUR = 60

export async function createCurationRequest(input: {
  kind: CurationRequestKind
  workId?: string | null
  query?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const session = await ensureSignedIn()
  if (!session.ok) return { ok: false, error: session.error }

  if (!withinRateLimit(`curation-request:${session.userId}`, REQUESTS_PER_HOUR, 60 * 60_000)) {
    return { ok: false, error: "Muitos pedidos seguidos. Tente de novo mais tarde." }
  }

  const kind = input.kind
  const porNome = kind === "create_by_name"
  const workId = porNome ? null : (input.workId ?? null)
  const query = porNome ? (input.query ?? "").trim() : null

  // Espelha a constraint `curation_requests_forma`. Validar aqui não a torna redundante: o
  // banco é quem GARANTE (a action é endpoint público), e isto é só para devolver mensagem
  // legível em vez de um erro de constraint.
  if (porNome && !query) return { ok: false, error: "Diga o nome da obra que você procura." }
  if (!porNome && !workId) return { ok: false, error: "Pedido sem obra." }

  const supabase = createAdminClient()
  const { error } = await supabase.from("curation_requests").insert({
    user_id: session.userId,
    work_id: workId,
    kind,
    query,
  })

  if (error) {
    // 23505 = unique_violation: já existe um pedido igual em aberto. Não é falha — é o
    // resultado certo, e dizer "erro" faria a pessoa clicar de novo.
    if (error.code === "23505") return { ok: true }
    console.warn("[createCurationRequest] falhou:", error.message)
    return { ok: false, error: "Não consegui registrar o pedido." }
  }

  if (workId) revalidatePath(`/titles/${workId}`)
  return { ok: true }
}

/** O leitor desiste do PRÓPRIO pedido. O `.eq("user_id")` é o que impede cancelar o dos outros. */
export async function cancelCurationRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await ensureSignedIn()
  if (!session.ok) return { ok: false, error: session.error }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("curation_requests")
    .delete()
    .eq("id", id)
    // 🔴 Sem isto, qualquer pessoa apaga o pedido de qualquer outra sabendo o uuid — a service
    // role ignora RLS, então a política da 177 não protege este caminho.
    .eq("user_id", session.userId)
    .eq("status", "open")
    .select("work_id")

  if (error) {
    console.warn("[cancelCurationRequest] falhou:", error.message)
    return { ok: false, error: "Não consegui cancelar o pedido." }
  }
  const workId = data?.[0]?.work_id as string | undefined
  if (workId) revalidatePath(`/titles/${workId}`)
  return { ok: true }
}

/**
 * O curador fecha o pedido: `done` (atendi) ou `dismissed` (não vou atender).
 *
 * Fecha, não apaga — o histórico é o que permitirá avisar quem pediu, quando esse canal
 * existir (adiado de propósito). A constraint parcial só considera `status = 'open'`, então
 * fechar já libera um pedido novo da mesma pessoa no futuro.
 */
export async function resolveCurationRequest(
  id: string,
  status: "done" | "dismissed",
): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("curation_requests")
    .update({ status, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")

  if (error) {
    console.warn("[resolveCurationRequest] falhou:", error.message)
    return { ok: false, error: "Não consegui fechar o pedido." }
  }
  revalidatePath("/curadoria/pedidos")
  return { ok: true }
}
