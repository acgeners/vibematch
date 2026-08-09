"use server"

import { revalidatePath } from "next/cache"
import { createUserClient } from "@/lib/supabase/user"
import { ensureSignedIn } from "@/server/queries/current-user"
import { markRecalcPending } from "@/server/recalc/queue"
import type { TagPrefLevel, TagStance } from "@/server/queries/tag-preferences"

const COLUMN_BY_LEVEL: Record<TagPrefLevel, "tag_id" | "tag_subgroup_id" | "tag_group_id"> = {
  tag: "tag_id",
  subgroup: "tag_subgroup_id",
  group: "tag_group_id",
}

export interface TagStanceItem {
  level: TagPrefLevel
  /** tags.id | tag_subgroup.id | tag_group.id conforme o level. */
  targetId: string
  stance: TagStance
  /** Força 1–2 (default 1). */
  weight?: number
}

export type SaveTagPreferencesResult = { ok: true } | { ok: false; error: string }

function isValid(item: TagStanceItem): boolean {
  return (
    ["tag", "subgroup", "group"].includes(item.level) &&
    (item.stance === "love" || item.stance === "avoid") &&
    !!item.targetId
  )
}

/**
 * Salva o conjunto COMPLETO de declarações do usuário de uma vez (batch).
 * Replace-all: apaga as linhas do usuário e insere o conjunto atual — o estado
 * do cliente é a fonte da verdade, então um save que falhe é recuperável só
 * clicando "Salvar" de novo. Marca recalc-pendente UMA vez (a Nota Prevista/
 * personal_fit recompõem no próximo "Recalcular"); o filtro "evito" do ranking,
 * query-time, reflete na hora.
 */
export async function saveTagPreferences(items: TagStanceItem[]): Promise<SaveTagPreferencesResult> {
  if (!Array.isArray(items)) return { ok: false, error: "Payload inválido." }
  const valid = items.filter(isValid)

  const auth = await ensureSignedIn()
  if (!auth.ok) return { ok: false, error: auth.error }
  const userId = auth.userId

  // Cliente do USUÁRIO: a RLS (migration 142) garante no BANCO que estas linhas são as dele.
  // `ensureSignedIn` já impede o anônimo; isto impede o resto — um `.eq("user_id")` esquecido,
  // um id trocado. Com a service role, qualquer um dos dois viraria dado de outra pessoa em
  // silêncio.
  const supabase = await createUserClient()

  const del = await supabase.from("user_tag_preferences").delete().eq("user_id", userId)
  if (del.error) return { ok: false, error: del.error.message }

  if (valid.length > 0) {
    const rows = valid.map((item) => ({
      user_id: userId,
      [COLUMN_BY_LEVEL[item.level]]: item.targetId,
      stance: item.stance,
      weight: Math.min(2, Math.max(0.1, Number(item.weight ?? 1))),
    }))
    const { error } = await supabase.from("user_tag_preferences").insert(rows)
    if (error) return { ok: false, error: error.message }
  }

  // `user_tag_preferences` alimenta os 3 sinais de fit em TODAS as obras — mas os
  // do DONO: `getDeclaredTagPreferences` cai em `getCurrentUserId()`, que sem
  // sessão é o singleton. Declaração de outra pessoa não move número na tela dele.
  await markRecalcPending("saveTagPreferences", {
    changed: ["tag_preferences"],
    actorId: userId,
  })
  revalidatePath("/preferencias")
  revalidatePath("/ranking")
  return { ok: true }
}
