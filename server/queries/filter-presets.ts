import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUserId } from "./current-user"

export interface FilterPreset {
  id: string
  name: string
  query: string
  basePath: string
  createdAt: string
}

/**
 * Conjuntos de filtros salvos do usuário atual para uma página (base_path).
 * Tolerante: se a tabela ainda não existe (migration 084 não aplicada),
 * retorna lista vazia em vez de quebrar a renderização da página.
 */
export async function getFilterPresets(basePath: string): Promise<FilterPreset[]> {
  const supabase = createAdminClient()
  // Sem sessão não há preset salvo: com `getCurrentUserId()` o /ranking anônimo mostrava
  // "Salvos (1)" e levava o nome do preset do dono no payload (medido em 2026-08-03).
  const userId = await getSessionUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from("ranking_filter_presets")
    .select("id, name, query, base_path, created_at")
    .eq("user_id", userId)
    .eq("base_path", basePath)
    .order("created_at", { ascending: false })

  if (error) {
    console.warn(`[getFilterPresets] indisponível (${basePath}): ${error.message}`)
    return []
  }

  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    query: r.query as string,
    basePath: r.base_path as string,
    createdAt: r.created_at as string,
  }))
}
