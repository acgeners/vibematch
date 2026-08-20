import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUserId } from "@/server/queries/current-user"
import type { CurationRequestKind } from "@/lib/curation/request-note"

// O tipo e o teto moram em `lib/curation/request-note.ts` porque o painel do leitor é
// `"use client"` e este módulo é `server-only`: um VALOR importado daqui arrastaria o
// server-only para o bundle do browser (o `next build` reprova; `tsc` e a suíte não veem).
export type { CurationRequestKind } from "@/lib/curation/request-note"
export { CURATION_NOTE_MAX } from "@/lib/curation/request-note"

export interface CurationRequestRow {
  id: string
  kind: CurationRequestKind
  workId: string | null
  query: string | null
  /** O que o leitor escreveu. `null` quando ele não disse nada — nunca string vazia. */
  note: string | null
  createdAt: string
}

export interface CurationQueueItem extends CurationRequestRow {
  workTitle: string | null
  requesterName: string | null
}

/**
 * Os pedidos EM ABERTO de quem está olhando, indexados por obra.
 *
 * ⚠️ `getSessionUserId()`, nunca `getCurrentUserId()` — este devolve o DONO quando não há
 * sessão, e foi assim que quatro leitores vazaram dado pessoal para anônimos
 * ([[gotcha-anonimo-vira-dono]]). Sem sessão a resposta é vazia, que é o que "não pedi nada"
 * significa; e não custa query nenhuma.
 *
 * A chave é `work_id`, então os pedidos SEM obra (`create_by_name`) ficam de fora de
 * propósito: quem consome isto é a página da obra.
 *
 * ⚠️ O valor é uma LISTA, não um pedido. A constraint da 177 é `(user_id, work_id, kind)`:
 * a mesma pessoa pode ter "atualizar dados" E "revisar avaliação" abertos na mesma obra ao
 * mesmo tempo. Um `Map<workId, pedido>` colapsaria os dois — a UI mostraria um só e
 * ofereceria de novo o botão do outro, que voltaria `ok` sem gravar nada (o insert bate na
 * constraint e o 23505 é tratado como sucesso). Sem erro em lugar nenhum, e o botão
 * simplesmente não faria efeito.
 */
export async function getMyOpenRequestsByWork(): Promise<Map<string, CurationRequestRow[]>> {
  const userId = await getSessionUserId()
  if (!userId) return new Map()

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("curation_requests")
    .select("id, kind, work_id, query, note, created_at")
    .eq("user_id", userId)
    .eq("status", "open")
    .not("work_id", "is", null)

  if (error) {
    console.warn("[getMyOpenRequestsByWork] falhou:", error.message)
    return new Map()
  }

  const porObra = new Map<string, CurationRequestRow[]>()
  for (const r of data ?? []) {
    const workId = r.work_id as string
    const lista = porObra.get(workId)
    const pedido: CurationRequestRow = {
      id: r.id as string,
      kind: r.kind as CurationRequestKind,
      workId,
      query: r.query as string | null,
      note: (r.note as string | null) ?? null,
      createdAt: r.created_at as string,
    }
    if (lista) lista.push(pedido)
    else porObra.set(workId, [pedido])
  }
  return porObra
}

/**
 * Os pedidos em aberto de quem está olhando SOBRE UMA OBRA. A página da obra usa isto em vez
 * de `getMyOpenRequestsByWork`: ela precisa de uma obra e o filtro sai de graça no índice.
 */
export async function getMyOpenRequestsForWork(workId: string): Promise<CurationRequestRow[]> {
  const userId = await getSessionUserId()
  if (!userId) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("curation_requests")
    .select("id, kind, work_id, query, note, created_at")
    .eq("user_id", userId)
    .eq("work_id", workId)
    .eq("status", "open")

  if (error) {
    console.warn("[getMyOpenRequestsForWork] falhou:", error.message)
    return []
  }

  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as CurationRequestKind,
    workId: r.work_id as string,
    query: r.query as string | null,
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  }))
}

/**
 * A fila do curador: TODOS os pedidos em aberto, mais antigo primeiro (quem pediu antes
 * espera menos).
 *
 * Lê o universo inteiro pela service role de propósito — é a única leitura deste módulo que
 * não é "minhas linhas". Quem chama tem de estar atrás de `ensureAdmin`; a página da console
 * já está, e o `middleware.ts` gateia o prefixo `/curation` antes de qualquer renderização.
 */
export async function getCurationQueue(limit = 200): Promise<CurationQueueItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("curation_requests")
    .select("id, kind, work_id, query, note, created_at, user_id, works(title)")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    console.warn("[getCurationQueue] falhou:", error.message)
    return []
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string
    kind: CurationRequestKind
    work_id: string | null
    query: string | null
    note: string | null
    created_at: string
    user_id: string
    works?: { title?: string | null } | null
  }>

  // Nome de quem pediu numa segunda leitura, e não por join: `user_settings` não tem FK
  // declarada para `curation_requests`, então o PostgREST não sabe embutir. São poucos ids.
  const donos = [...new Set(rows.map((r) => r.user_id))]
  const nomes = new Map<string, string>()
  if (donos.length) {
    const { data: settings } = await supabase
      .from("user_settings")
      .select("auth_user_id, display_name, email")
      .in("auth_user_id", donos)
    for (const s of settings ?? []) {
      const nome = (s.display_name as string | null) || (s.email as string | null)
      if (s.auth_user_id && nome) nomes.set(s.auth_user_id as string, nome)
    }
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    workId: r.work_id,
    query: r.query,
    note: r.note ?? null,
    createdAt: r.created_at,
    workTitle: r.works?.title ?? null,
    requesterName: nomes.get(r.user_id) ?? null,
  }))
}

/**
 * Quantos pedidos em aberto — a parcela nova do badge de curadoria.
 *
 * `count: "exact", head: true` porque isto roda no chrome de TODA página: puxar linhas aqui
 * seria uma das leituras mais caras do app repetida a cada navegação (ver o §Egress do
 * CLAUDE.md, onde `getSettingsItemPending` é o exemplo negativo).
 */
export async function countOpenCurationRequests(): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("curation_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")

  if (error) {
    console.warn("[countOpenCurationRequests] falhou:", error.message)
    return 0
  }
  return count ?? 0
}
