"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin, ensureSignedIn } from "@/server/queries/current-user"
import { withinRateLimit } from "@/lib/rate-limit"
import { pgSafeText } from "@/lib/text/pg-safe-text"
import { CURATION_NOTE_MAX } from "@/server/queries/curation-requests"
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

/**
 * O `kind` vem do CLIENTE, e tipo de TypeScript some em runtime — um POST à mão manda o que
 * quiser. O check da 195 recusaria, mas com mensagem de constraint; esta lista existe para o
 * caminho errado sair legível, e para o conjunto permitido estar escrito em código.
 */
const KINDS: readonly CurationRequestKind[] = [
  "update_data",
  "review_eval",
  "create_by_name",
  "report_error",
]

/**
 * A nota que o leitor escreveu, pronta para virar linha — ou o motivo de recusa.
 *
 * 🔴 Duas coisas que NÃO podem ser trocadas de lugar:
 *
 * 1. **`pgSafeText` antes de gravar.** Isto é `"use server"`, ou seja endpoint HTTP público
 *    ([[project_use_server_public_endpoints]]): a nota pode chegar com surrogate
 *    desemparelhado forjado à mão, e aí o PostgREST recusa o corpo INTEIRO com 400 — o
 *    pedido não entra e o caractere culpado é invisível em log e em tela.
 * 2. **Passar do teto é RECUSA, nunca `.slice()`.** Cortar por unidade UTF-16 é exatamente o
 *    que parte emoji ao meio e FABRICA o surrogate solto do item 1 — foi assim que duas
 *    escritas caíram em 18/08/2026. O teto é medido DEPOIS da higienização, senão o número
 *    que a pessoa vê no contador não é o que o banco confere.
 */
function prepararNota(bruta: string | null | undefined): { nota: string | null } | { erro: string } {
  const limpa = pgSafeText((bruta ?? "").toString()).trim()
  if (!limpa) return { nota: null }
  if (limpa.length > CURATION_NOTE_MAX) {
    return { erro: `Texto muito longo (máx. ${CURATION_NOTE_MAX} caracteres).` }
  }
  return { nota: limpa }
}

export async function createCurationRequest(input: {
  kind: CurationRequestKind
  workId?: string | null
  query?: string | null
  note?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const session = await ensureSignedIn()
  if (!session.ok) return { ok: false, error: session.error }

  if (!withinRateLimit(`curation-request:${session.userId}`, REQUESTS_PER_HOUR, 60 * 60_000)) {
    return { ok: false, error: "Muitos pedidos seguidos. Tente de novo mais tarde." }
  }

  const kind = input.kind
  if (!KINDS.includes(kind)) return { ok: false, error: "Tipo de pedido desconhecido." }

  const porNome = kind === "create_by_name"
  const workId = porNome ? null : (input.workId ?? null)
  const query = porNome ? (input.query ?? "").trim() : null

  const preparada = prepararNota(input.note)
  if ("erro" in preparada) return { ok: false, error: preparada.erro }
  const note = preparada.nota

  // Espelha as constraints `curation_requests_forma` e `curation_requests_erro_tem_nota`.
  // Validar aqui não as torna redundantes: o banco é quem GARANTE (a action é endpoint
  // público), e isto é só para devolver mensagem legível em vez de um erro de constraint.
  if (porNome && !query) return { ok: false, error: "Diga o nome da obra que você procura." }
  if (!porNome && !workId) return { ok: false, error: "Pedido sem obra." }
  // Sem o texto, `report_error` não é acionável: "tem algo errado" não diz o que consertar.
  if (kind === "report_error" && !note) {
    return { ok: false, error: "Descreva o que está errado na ficha." }
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from("curation_requests").insert({
    user_id: session.userId,
    work_id: workId,
    kind,
    query,
    note,
  })

  if (error) {
    // 23505 = unique_violation: já existe um pedido igual em aberto. Não é falha — é o
    // resultado certo, e dizer "erro" faria a pessoa clicar de novo.
    //
    // ⚠️ Isto só é verdade porque a 195 tirou `report_error` da chave `(user_id, work_id,
    // kind)` e lhe deu uma que inclui a NOTA. Sob a chave antiga, o segundo erro relatado na
    // mesma obra — texto DIFERENTE — seria engolido aqui com um "pedido enviado" na tela.
    if (error.code === "23505") return { ok: true }
    console.warn("[createCurationRequest] falhou:", error.message)
    return { ok: false, error: "Não consegui registrar o pedido." }
  }

  if (workId) revalidatePath(`/catalog/${workId}`)
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
  if (workId) revalidatePath(`/catalog/${workId}`)
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
  revalidatePath("/curation/requests")
  return { ok: true }
}
