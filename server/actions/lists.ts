"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath, revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin, getOwnerUserId, ensureSignedIn, ensurePermission } from "@/server/queries/current-user"
import { createUserClient } from "@/lib/supabase/user"
import { writeReadingState } from "@/server/queries/user-work-state"
import { runRecommendationAction } from "./recommendations"
import { proposeFavoriteGroups as proposeFavoriteGroupsLLM } from "@/lib/lists/propose-groups"
import type { FavoriteWork, ProposedGroup } from "@/lib/lists/propose-groups"
import type { ListComment } from "@/server/queries/lists"

// ────────────────────────────────────────────────────────────────────────────
// Grupos de favoritos (work_lists). CRUD + associação obra<->grupo.
// Semântica: adicionar uma obra a um grupo também marca is_favorite=TRUE
// (grupo ⊂ favoritos). Remover do grupo NÃO desmarca. Ver migration 123 e
// [[project_favorites_groups_feature]].
// ────────────────────────────────────────────────────────────────────────────

type ActionResult<T> = { data: T } | { error: string }

interface WorkListInput {
  name: string
  description?: string | null
  color?: string | null
  coverWorkIds?: string[]
}

function revalidateLists(listId?: string) {
  revalidatePath("/favorites")
  if (listId) revalidatePath(`/favorites/${listId}`)
  // Adicionar obras muda is_favorite → toca as mesmas superfícies do toggle.
  revalidatePath("/ranking")
  revalidatePath("/titles")
  revalidateTag("favorites-summary", "max")
}

function cleanName(name: string): string {
  return name.trim().slice(0, 80)
}

function cleanCoverIds(ids: string[] | undefined | null): string[] {
  if (!ids) return []
  return Array.from(new Set(ids.filter(Boolean))).slice(0, 3)
}


/**
 * Gate dos GRUPOS de favoritos (Fatia 2b — mig 149: `work_lists` ganhou dono).
 *
 * Era `ensureAdmin()`, e tinha que ser: sem `user_id` na tabela, "criar um grupo" significava
 * criar um grupo no espaço de TODO MUNDO. Com dono, o verbo certo é `own_state` — o mesmo de
 * favoritar e marcar capítulo. O Leitor free cria os grupos DELE.
 *
 * ⚠️ IDENTIDADE antes de PERMISSÃO: o papel de um anônimo é `leitor` (fail-closed) e `own_state`
 * é liberado pro leitor — o gate de papel PASSA. O que falta ao anônimo é `user_id`.
 */
async function ensureListWriter(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await ensureSignedIn()
  if (!session.ok) return { ok: false, error: session.error }
  const gate = await ensurePermission("own_state")
  if (!gate.ok) return { ok: false, error: gate.error }
  return { ok: true, userId: session.userId }
}

export async function createWorkList(input: WorkListInput): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureListWriter()
  if (!gate.ok) return { error: gate.error }
  const name = cleanName(input.name ?? "")
  if (!name) return { error: "Dê um nome ao grupo." }

  // 🔴 Cliente de SESSÃO, não service role. A service role IGNORA a RLS: com ela, bastaria um
  // `id` de grupo alheio no POST pra editar/apagar o grupo de outra pessoa — e toda função
  // exportada de um "use server" é um endpoint HTTP público. Com o cliente de sessão, o
  // Postgres filtra por `user_id = auth.uid()` e a tentativa é NEGADA, não obedecida.
  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from("work_lists")
    .insert({
      user_id: gate.userId,
      name,
      description: input.description?.trim() || null,
      color: input.color || null,
      cover_work_ids: cleanCoverIds(input.coverWorkIds),
    })
    .select("id")
    .single()

  if (error) return { error: error.message }
  revalidateLists()
  return { data: { id: data.id as string } }
}

export async function updateWorkList(
  id: string,
  input: WorkListInput,
): Promise<ActionResult<null>> {
  const gate = await ensureListWriter()
  if (!gate.ok) return { error: gate.error }
  const name = cleanName(input.name ?? "")
  if (!name) return { error: "Dê um nome ao grupo." }

  const supabase = await createUserClient()
  const { error } = await supabase
    .from("work_lists")
    .update({
      name,
      description: input.description?.trim() || null,
      color: input.color || null,
      cover_work_ids: cleanCoverIds(input.coverWorkIds),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidateLists(id)
  return { data: null }
}

export async function deleteWorkList(id: string): Promise<ActionResult<null>> {
  const gate = await ensureListWriter()
  if (!gate.ok) return { error: gate.error }
  const supabase = await createUserClient()
  // work_list_items cai por ON DELETE CASCADE (migration 123). Obras intactas.
  // A RLS garante que o `id` tem que ser de um grupo DELE — apagar o de outro é negado.
  const { error } = await supabase.from("work_lists").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidateLists()
  return { data: null }
}

export async function addWorksToList(
  listId: string,
  workIds: string[],
): Promise<ActionResult<{ count: number }>> {
  const gate = await ensureListWriter()
  if (!gate.ok) return { error: gate.error }
  const ids = Array.from(new Set(workIds.filter(Boolean)))
  if (ids.length === 0) return { data: { count: 0 } }

  // Cliente de sessão: a política de `work_list_items` pergunta ao GRUPO quem é o dono. Pôr
  // uma obra no grupo de outra pessoa é negado pelo Postgres.
  const supabase = await createUserClient()
  const { error: insertError } = await supabase
    .from("work_list_items")
    .upsert(
      ids.map((wid) => ({ list_id: listId, work_id: wid })),
      { onConflict: "list_id,work_id", ignoreDuplicates: true },
    )
  if (insertError) return { error: insertError.message }

  // Grupo ⊂ favoritos: todo item do grupo aparece no universo de favoritos DE QUEM O CRIOU.
  //
  // Mudou na Fatia 2b: o favorito vai pra linha de QUEM AGIU, não mais pra do dono. Antes, com
  // os grupos sem dono, era o dono por definição — agora a Leitora tem os grupos dela, e o
  // favorito que nasce daqui é o dela.
  const mirror = await writeReadingState(gate.userId, ids, { is_favorite: true })
  if (mirror.error) return { error: mirror.error }

  // `works.is_favorite` é o espelho compartilhado — só o DONO o escreve (mesma regra da Fatia 1;
  // ver server/queries/user-work-state.ts). Para os demais, essa coluna nem é consultada.
  if (gate.userId === (await getOwnerUserId())) {
    const admin = createAdminClient()
    const { error: favError } = await admin
      .from("works")
      .update({ is_favorite: true })
      .in("id", ids)
    if (favError) return { error: favError.message }
  }

  revalidateLists(listId)
  return { data: { count: ids.length } }
}

export async function removeWorksFromList(
  listId: string,
  workIds: string[],
): Promise<ActionResult<{ count: number }>> {
  const gate = await ensureListWriter()
  if (!gate.ok) return { error: gate.error }
  const ids = Array.from(new Set(workIds.filter(Boolean)))
  if (ids.length === 0) return { data: { count: 0 } }

  const supabase = await createUserClient()
  // Remover do grupo NÃO desmarca is_favorite (pode estar em outros grupos).
  const { error } = await supabase
    .from("work_list_items")
    .delete()
    .eq("list_id", listId)
    .in("work_id", ids)
  if (error) return { error: error.message }

  revalidateLists(listId)
  return { data: { count: ids.length } }
}

// ── Comentários do grupo (log JSONB em work_lists.comments) ──────────────────

async function readComments(
  supabase: ReturnType<typeof createAdminClient>,
  listId: string,
): Promise<ListComment[] | null> {
  const { data, error } = await supabase
    .from("work_lists")
    .select("comments")
    .eq("id", listId)
    .maybeSingle()
  if (error || !data) return null
  return Array.isArray(data.comments) ? (data.comments as ListComment[]) : []
}

export async function addListComment(
  listId: string,
  text: string,
): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const trimmed = text.trim()
  if (!trimmed) return { error: "Escreva algo no comentário." }

  const supabase = createAdminClient()
  const comments = await readComments(supabase, listId)
  if (comments == null) return { error: "Grupo não encontrado." }

  const entry: ListComment = {
    id: randomUUID(),
    text: trimmed.slice(0, 2000),
    created_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from("work_lists")
    .update({ comments: [...comments, entry], updated_at: new Date().toISOString() })
    .eq("id", listId)
  if (error) return { error: error.message }

  revalidateLists(listId)
  return { data: { id: entry.id } }
}

export async function deleteListComment(
  listId: string,
  commentId: string,
): Promise<ActionResult<null>> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const comments = await readComments(supabase, listId)
  if (comments == null) return { error: "Grupo não encontrado." }

  const next = comments.filter((c) => c.id !== commentId)
  const { error } = await supabase
    .from("work_lists")
    .update({ comments: next, updated_at: new Date().toISOString() })
    .eq("id", listId)
  if (error) return { error: error.message }

  revalidateLists(listId)
  return { data: null }
}

// ── Recomendação/desempate com IA escopada ao grupo ──────────────────────────
// Reusa o fluxo existente (runRecommendationAction, mode="ranking") escopado
// às obras do grupo via filters.onlyWorkIds, e carimba list_id no run gerado
// (que segue navegável em /recommendations). Ver migration 124.

export async function recommendGroup(
  listId: string,
  opts?: { userContext?: string | null; n?: number },
): Promise<ActionResult<{ slug: string }>> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { data: items, error: itemsErr } = await supabase
    .from("work_list_items")
    .select("work_id")
    .eq("list_id", listId)
  if (itemsErr) return { error: itemsErr.message }

  const workIds = (items ?? []).map((r) => (r as { work_id: string }).work_id)
  if (workIds.length < 2) {
    return { error: "Adicione ao menos 2 obras ao grupo pra recomendar/desempatar." }
  }

  const res = await runRecommendationAction({
    mode: "ranking",
    n: Math.min(30, workIds.length),
    userContext: opts?.userContext?.trim() || null,
    filters: {
      onlyWorkIds: workIds,
      includeFinishedDropped: true,
      sortBy: "expected_score",
      sortDir: "desc",
    },
  })
  if (res.error || !res.data) return { error: res.error ?? "Falha ao recomendar." }

  // Carimba o grupo no run (se ele foi persistido).
  if (res.data.runId && res.data.runId !== "unsaved") {
    await supabase.from("recommendation_runs").update({ list_id: listId }).eq("id", res.data.runId)
  }

  revalidateLists(listId)
  return { data: { slug: res.data.runSlug } }
}

// ── Curadoria por IA: propor grupos a partir dos favoritos (Haiku) ────────────
// Fluxo de CRIAÇÃO: lê o balde plano de favoritos e devolve até N grupos coesos
// (nome + descrição + obras). NÃO persiste — o usuário revisa e cria os que
// quiser (via createWorkList + addWorksToList). Ver lib/lists/propose-groups.ts.

/** Extrai nomes de uma relação aninhada `rel(name)` (Supabase devolve objeto,
 *  array ou null conforme a cardinalidade). */
function flattenNames(rel: unknown): string[] {
  const list = Array.isArray(rel) ? rel : rel ? [rel] : []
  return list
    .map((r) => (r as { name?: unknown })?.name)
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
}

export async function proposeFavoriteGroups(
  n: number,
): Promise<ActionResult<{ groups: ProposedGroup[] }>> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, title, work_genres(genres(name)), work_tags(tags(name))")
    .eq("is_favorite", true)
    .eq("is_archived", false)
    .order("title", { ascending: true })
    .limit(200)
  if (error) return { error: error.message }

  const works: FavoriteWork[] = (data ?? []).map((w) => {
    const row = w as { id: string; title?: string; work_genres?: Array<{ genres: unknown }>; work_tags?: Array<{ tags: unknown }> }
    return {
      id: row.id,
      title: row.title ?? "(sem título)",
      genres: Array.from(new Set((row.work_genres ?? []).flatMap((g) => flattenNames(g.genres)))).slice(0, 6),
      tags: Array.from(new Set((row.work_tags ?? []).flatMap((t) => flattenNames(t.tags)))).slice(0, 10),
    }
  })

  if (works.length < 2) {
    return { error: "Você precisa de ao menos 2 favoritos pra IA sugerir grupos." }
  }

  try {
    const groups = await proposeFavoriteGroupsLLM(works, n)
    if (groups.length === 0) {
      return { error: "A IA não encontrou grupos coesos nos favoritos. Tente com mais obras." }
    }
    return { data: { groups } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao sugerir grupos." }
  }
}

/** Cria um grupo a partir de uma proposta da IA (nome + descrição + obras). */
export async function createGroupFromProposal(input: {
  name: string
  description?: string | null
  color?: string | null
  workIds: string[]
}): Promise<ActionResult<{ id: string }>> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const created = await createWorkList({
    name: input.name,
    description: input.description ?? null,
    color: input.color ?? null,
  })
  if ("error" in created) return created

  const ids = Array.from(new Set((input.workIds ?? []).filter(Boolean)))
  if (ids.length > 0) {
    const added = await addWorksToList(created.data.id, ids)
    if ("error" in added) return { error: added.error }
  }
  return { data: { id: created.data.id } }
}
