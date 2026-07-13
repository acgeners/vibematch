"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureSignedIn } from "@/server/queries/current-user"

export interface SaveFilterPresetInput {
  basePath: string
  name: string
  query: string
}

export interface SavedPreset {
  id: string
  name: string
  query: string
}

/**
 * Salva (ou sobrescreve) um conjunto de filtros nomeado para a página atual.
 * Upsert por (user_id, base_path, name): salvar com um nome já existente
 * atualiza a query daquele preset.
 */
export async function saveFilterPreset(
  input: SaveFilterPresetInput,
): Promise<{ error: string } | { error: null; preset: SavedPreset }> {
  const name = input.name.trim()
  if (!name) return { error: "Dê um nome ao conjunto de filtros" }
  if (name.length > 60) return { error: "O nome deve ter no máximo 60 caracteres" }

  const supabase = createAdminClient()
  const auth = await ensureSignedIn()
  if (!auth.ok) return { error: auth.error }
  const userId = auth.userId

  const { data, error } = await supabase
    .from("ranking_filter_presets")
    .upsert(
      {
        user_id: userId,
        base_path: input.basePath,
        name,
        query: input.query,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,base_path,name" },
    )
    .select("id, name, query")
    .single()

  if (error) return { error: error.message }

  revalidatePath(input.basePath)
  return {
    error: null,
    preset: { id: data.id as string, name: data.name as string, query: data.query as string },
  }
}

/**
 * Renomeia um preset existente. Nome único por (user_id, base_path): se já
 * existir outro preset com o nome alvo, retorna erro amigável.
 */
export async function renameFilterPreset(input: {
  id: string
  basePath: string
  name: string
}): Promise<{ error: string } | { error: null; preset: SavedPreset }> {
  const name = input.name.trim()
  if (!name) return { error: "Dê um nome ao conjunto de filtros" }
  if (name.length > 60) return { error: "O nome deve ter no máximo 60 caracteres" }

  const supabase = createAdminClient()
  const auth = await ensureSignedIn()
  if (!auth.ok) return { error: auth.error }
  const userId = auth.userId

  const { data, error } = await supabase
    .from("ranking_filter_presets")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("user_id", userId)
    .select("id, name, query")
    .single()

  if (error) {
    if (error.code === "23505") return { error: "Já existe um filtro com esse nome" }
    return { error: error.message }
  }

  revalidatePath(input.basePath)
  return {
    error: null,
    preset: { id: data.id as string, name: data.name as string, query: data.query as string },
  }
}

export async function deleteFilterPreset(input: {
  id: string
  basePath: string
}): Promise<{ error: string | null }> {
  const supabase = createAdminClient()
  const auth = await ensureSignedIn()
  if (!auth.ok) return { error: auth.error }
  const userId = auth.userId

  const { error } = await supabase
    .from("ranking_filter_presets")
    .delete()
    .eq("id", input.id)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  revalidatePath(input.basePath)
  return { error: null }
}
