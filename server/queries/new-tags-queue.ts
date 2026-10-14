import "server-only"
import type { createAdminClient } from "@/lib/supabase/admin"
import { ENRICHMENT_NEEDS_RECOVERY, parseHumanDecisions, recoveryState, stillNeedsRecovery } from "@/lib/tags/enrichment-view"

type Admin = ReturnType<typeof createAdminClient>

/**
 * Quem entra na fila "Tags novas" (aba da Consolidação de tags) — dono ÚNICO da regra, lido pela
 * LISTA (`listNewTags`) e pelo CONTADOR da aba (`tag-consolidation-tool.tsx`). Duas cópias do filtro
 * fariam a aba contar uma coisa e abrir outra.
 *
 *   A) tag de FONTE ainda não revisada por humano (`origin = 'external'` ∧ `reviewed_at` nulo) — a
 *      fila de sempre;
 *   B) tag de QUALQUER origem cuja classificação automática não terminou (`enrichment_status` em
 *      `ENRICHMENT_NEEDS_RECOVERY`) E que ainda não foi resolvida à mão (`recoveryState`: grupo
 *      definido + sinal 18+ decidido por um humano). 🔴 Até 2026-10-13 só existia A: uma tag `manual`
 *      que falhava não aparecia em lugar nenhum, e a de fonte aparecia como "Não é 18+".
 *
 * Resolvida à mão, a tag sai de B: se for de fonte e ainda não confirmada, continua em A (como linha
 * "recuperada manualmente", que se confirma); se não, sai da fila.
 */
export const NEW_TAGS_COLUMNS =
  "id, name, slug, tag_group_id, adult_indicator, adult_indicator_strong, origin, created_at, reviewed_at, enrichment_status, enrichment_detail, human_decisions"

export interface NewTagsQueueRow {
  id: string
  name: string
  slug: string
  tag_group_id: string | null
  adult_indicator: boolean
  adult_indicator_strong: boolean
  origin: string
  created_at: string
  reviewed_at: string | null
  enrichment_status: string
  enrichment_detail: string | null
  human_decisions: unknown
}

/** A linha ainda precisa de alguém (parte B da regra). */
export function rowNeedsRecovery(t: Pick<NewTagsQueueRow, "enrichment_status" | "tag_group_id" | "human_decisions">): boolean {
  return stillNeedsRecovery(
    recoveryState({
      enrichmentStatus: t.enrichment_status,
      hasGroup: t.tag_group_id != null,
      humanDecisions: parseHumanDecisions(t.human_decisions),
    }),
  )
}

const inA = (t: Pick<NewTagsQueueRow, "origin" | "reviewed_at">) => t.origin === "external" && t.reviewed_at == null

/** Teto da parte A (a fila histórica tinha o mesmo); a parte B é pequena por natureza. */
const LIMIT = 2000

/** As tags da parte B (pequena: só as que não terminaram a classificação e ninguém resolveu). */
async function loadRecoveryRows(supabase: Admin): Promise<NewTagsQueueRow[]> {
  const { data, error } = await supabase
    .from("tags")
    .select(NEW_TAGS_COLUMNS)
    .in("enrichment_status", [...ENRICHMENT_NEEDS_RECOVERY])
    .order("created_at", { ascending: false })
    .limit(LIMIT)
  if (error) throw new Error(`fila Tags novas (classificação não concluída): ${error.message}`)
  return ((data ?? []) as NewTagsQueueRow[]).filter(rowNeedsRecovery)
}

/**
 * A ∪ B, sem repetir. As que precisam de recuperação vêm PRIMEIRO (elas são o que a fila tem de
 * acionável), depois o resto; dentro de cada parte, a mais nova primeiro.
 */
export async function loadNewTagsQueue(supabase: Admin): Promise<NewTagsQueueRow[]> {
  const [{ data: aRows, error: aErr }, bRows] = await Promise.all([
    supabase
      .from("tags")
      .select(NEW_TAGS_COLUMNS)
      .eq("origin", "external")
      .is("reviewed_at", null)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    loadRecoveryRows(supabase),
  ])
  if (aErr) throw new Error(`fila Tags novas (tags de fonte): ${aErr.message}`)
  const byId = new Map<string, NewTagsQueueRow>()
  for (const t of [...bRows, ...((aRows ?? []) as NewTagsQueueRow[])]) byId.set(t.id, t)
  return [...byId.values()].sort((x, y) => {
    const rx = rowNeedsRecovery(x) ? 0 : 1
    const ry = rowNeedsRecovery(y) ? 0 : 1
    return rx - ry || y.created_at.localeCompare(x.created_at)
  })
}

/** |A ∪ B| sem trafegar A: a parte A é `count` no servidor e a B (pequena) desconta a interseção. */
export async function countNewTagsQueue(supabase: Admin): Promise<number> {
  const [{ count, error }, bRows] = await Promise.all([
    supabase.from("tags").select("id", { count: "exact", head: true }).eq("origin", "external").is("reviewed_at", null),
    loadRecoveryRows(supabase),
  ])
  if (error) throw new Error(`contagem da fila Tags novas: ${error.message}`)
  return (count ?? 0) + bRows.filter((t) => !inA(t)).length
}
