import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { chipTagNames } from "@/lib/onboarding/chip-tastes"
import type { ChipStance, TagStanceRow } from "@/lib/onboarding/chip-tastes"

export interface ChipTasteState {
  /** Nome → id das tags que os chips cobrem (as que existem no catálogo). */
  idByName: Map<string, string>
  /** As declarações de NÍVEL TAG da pessoa, só sobre essas tags. */
  rows: TagStanceRow[]
}

/**
 * O que a pessoa já declarou sobre as tags dos chips das boas-vindas. Lê só o universo dos chips
 * (~20 tags): é tudo de que a tela precisa, e fica longe do corte de 1000 linhas do PostgREST.
 * Service role com `user_id` explícito (padrão de leitura); quem grava é o cliente de sessão.
 */
export async function loadChipTasteState(userId: string): Promise<ChipTasteState> {
  const supabase = createAdminClient()
  const { data: tags, error: tagsError } = await supabase.from("tags").select("id, name").in("name", chipTagNames())
  if (tagsError) throw new Error(`tags: ${tagsError.message}`)
  const idByName = new Map((tags ?? []).map((t) => [t.name as string, t.id as string]))
  const nameById = new Map([...idByName].map(([name, id]) => [id, name]))
  if (idByName.size === 0) return { idByName, rows: [] }

  const { data: prefs, error } = await supabase
    .from("user_tag_preferences")
    .select("tag_id, stance")
    .eq("user_id", userId)
    .in("tag_id", [...idByName.values()])
  if (error) throw new Error(`user_tag_preferences: ${error.message}`)

  const rows: TagStanceRow[] = []
  for (const p of prefs ?? []) {
    const name = nameById.get(p.tag_id as string)
    if (name && (p.stance === "love" || p.stance === "avoid")) rows.push({ tagName: name, stance: p.stance as ChipStance })
  }
  return { idByName, rows }
}
