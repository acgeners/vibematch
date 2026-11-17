import "server-only"

import type { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"

/** Lotes de slugs: a lista vai na query string, e grupo inteiro evitado são centenas de tags. */
const SLUG_CHUNK = 100

/**
 * As obras com ALGUMA das tags (por slug). Paginada: só a Isekai cobre centenas de obras, e o corte
 * de 1000 do PostgREST faria obra evitada voltar a aparecer — o pior sentido para uma exclusão.
 * Quem usa: o deck das boas-vindas e o "Pra você hoje" (esconder as tags evitadas).
 */
export async function workIdsWithAnyTag(
  supabase: ReturnType<typeof createAdminClient>,
  slugs: string[],
): Promise<Set<string>> {
  const ids = new Set<string>()
  for (let i = 0; i < slugs.length; i += SLUG_CHUNK) {
    const chunk = slugs.slice(i, i + SLUG_CHUNK)
    const rows = await fetchAllRows<{ work_id: string }>(
      () => supabase.from("work_tags").select("work_id, tags!inner(slug)").in("tags.slug", chunk),
      { orderBy: ["work_id", "tag_id"], label: "workIdsWithAnyTag" },
    )
    for (const r of rows) ids.add(r.work_id)
  }
  return ids
}
