import "server-only"
import { cache } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { getHideAdultContent, getPreferredMixedEdition } from "@/server/queries/current-user"
import { parseMixedEdition } from "@/lib/editions/mixed-edition"
import { tagsForEdition } from "@/lib/editions/edition-content"
import type { EditionScoreRow, MixedEdition } from "@/lib/editions/mixed-edition"

/**
 * Notas por EDIÇÃO das obras `mixed` (`work_edition_scores`, migrations 213/214) — catálogo, lido
 * pela service role (RLS ligada, sem policy).
 *
 * Volume: 2 linhas por obra mixed (hoje 280 no total), só `adult_content`.
 */
// ⚠️ Sem `evidence`: ninguém que LÊ precisa dela (a tela mostra a procedência pela `source`), e ela
// é ~90% do peso da linha (~900 B × 280). A evidência é para auditoria, no SQL.
export const EDITION_SCORES_SELECT =
  "work_id, edition, criterion_slug, score, source, status, confidence, ai_evaluation_id"

function normalize(rows: unknown[] | null | undefined): EditionScoreRow[] {
  return ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    work_id: r.work_id as string,
    edition: r.edition as MixedEdition,
    criterion_slug: r.criterion_slug as string,
    // numeric do PostgREST volta como STRING — sem Number(), "5.0" !== 5.
    score: r.score == null ? null : Number(r.score),
    source: r.source as EditionScoreRow["source"],
    status: r.status as EditionScoreRow["status"],
    confidence: (r.confidence as EditionScoreRow["confidence"]) ?? null,
    ai_evaluation_id: (r.ai_evaluation_id as string | null) ?? null,
  }))
}

/** As linhas de UMA obra (página da obra). Obra não-mixed devolve []. */
export async function getEditionScoresForWork(workId: string): Promise<EditionScoreRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from("work_edition_scores").select(EDITION_SCORES_SELECT).eq("work_id", workId)
  // 🔴 Erro LANÇA: devolver [] faria a obra mixed aparecer "sem nota em nenhuma edição" — plausível e falso.
  if (error) throw new Error(`work_edition_scores: ${error.message}`)
  return normalize(data)
}

/**
 * TODAS as linhas (recálculo, listas). Paginado em ordem total pela PK — hoje cabem numa página,
 * mas a tabela cresce com o catálogo.
 */
export async function fetchAllEditionScores(supabase: Pick<SupabaseClient, "from">): Promise<EditionScoreRow[]> {
  const rows = await fetchAllRows<unknown>(
    () => supabase.from("work_edition_scores").select(EDITION_SCORES_SELECT),
    { orderBy: ["work_id", "edition", "criterion_slug"], label: "work_edition_scores" },
  )
  return normalize(rows)
}

/**
 * As linhas de um CONJUNTO de obras (listas). Lotes de 200 ids: `.in()` vai na URL, e cada obra mixed
 * tem 2 linhas — 400 por lote, abaixo do corte de 1000.
 */
export async function fetchEditionScoresFor(supabase: Pick<SupabaseClient, "from">, workIds: string[]): Promise<EditionScoreRow[]> {
  const out: EditionScoreRow[] = []
  for (let i = 0; i < workIds.length; i += 200) {
    const lote = workIds.slice(i, i + 200)
    const { data, error } = await supabase.from("work_edition_scores").select(EDITION_SCORES_SELECT).in("work_id", lote)
    if (error) throw new Error(`work_edition_scores: ${error.message}`)
    out.push(...normalize(data))
  }
  return out
}

/**
 * As flags de EDIÇÃO das tags (`lib/editions/edition-content.ts`) — só para as tags das obras `mixed`
 * da tela. Ficam FORA do select compartilhado de propósito: ele serve o catálogo inteiro, e duas
 * colunas a mais por tag custariam ~40 KB crus por página para servir 0 a 2 obras mixed.
 */
export interface TagEditionFlags {
  adult_indicator: boolean | null
  adult_indicator_strong: boolean | null
  adult_score_tier: string | null
  marks_r19_edition: boolean | null
}

export async function fetchTagEditionFlags(
  supabase: Pick<SupabaseClient, "from">,
  tagIds: string[],
): Promise<Map<string, TagEditionFlags>> {
  const ids = [...new Set(tagIds.filter(Boolean))]
  const out = new Map<string, TagEditionFlags>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("tags")
      .select("id, adult_indicator, adult_indicator_strong, adult_score_tier, marks_r19_edition")
      .in("id", ids.slice(i, i + 200))
    // 🔴 Erro LANÇA: sem as flags, a versão normal mostraria a tag da R18 como se fosse dela.
    if (error) throw new Error(`tags (flags de edição): ${error.message}`)
    for (const r of (data ?? []) as Array<TagEditionFlags & { id: string }>) {
      out.set(r.id, {
        adult_indicator: r.adult_indicator ?? null,
        adult_indicator_strong: r.adult_indicator_strong ?? null,
        adult_score_tier: r.adult_score_tier ?? null,
        marks_r19_edition: r.marks_r19_edition ?? null,
      })
    }
  }
  return out
}

/**
 * As tags de uma obra vistas numa edição. Tag sem flag carregada (id ausente do mapa) é tratada como
 * DESCONHECIDA na normal — ocultar é o lado seguro; nunca mostrar na normal o que pode ser da R18.
 */
export function withTagFlags<T extends { id?: unknown }>(tags: ReadonlyArray<T>, flags: Map<string, TagEditionFlags>) {
  return tags.map((t) => {
    const f = typeof t.id === "string" ? flags.get(t.id) : undefined
    return { ...t, ...(f ?? { adult_indicator: true, adult_indicator_strong: null, adult_score_tier: null, marks_r19_edition: null }) }
  })
}

/**
 * Para cada obra `mixed` vista na versão NORMAL, os `tag_id` que ela pode mostrar — a régua é
 * `tagsForEdition` (classe pela flag do banco), sem cópia. Dono único para quem recebe tags SEM as
 * flags (listas, rodadas de recomendação): busca as flags só das tags dessas obras.
 */
export async function visibleTagIdsOnNormal(
  supabase: Pick<SupabaseClient, "from">,
  works: ReadonlyArray<{ id: string; tagIds: ReadonlyArray<string> }>,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  if (works.length === 0) return out
  const flags = await fetchTagEditionFlags(supabase, works.flatMap((w) => [...w.tagIds]))
  for (const w of works) {
    const visiveis = tagsForEdition(withTagFlags(w.tagIds.map((id) => ({ id })), flags), "normal")
    out.set(w.id, new Set(visiveis.map((t) => t.id as string)))
  }
  return out
}

export interface MixedEditionSettings {
  hideAdult: boolean
  preference: MixedEdition | null
}

/**
 * Preferências de edição de QUEM OLHA. Anônimo: não oculta 18+ e não tem preferência (⇒ normal pelo
 * fallback). Nunca herda as do dono.
 */
export const getMixedEditionSettings = cache(async (): Promise<MixedEditionSettings> => {
  // As duas leem a MESMA linha memoizada de `user_settings` (anônimo ⇒ null ⇒ defaults).
  const [hideAdult, preference] = await Promise.all([getHideAdultContent(), getPreferredMixedEdition()])
  return { hideAdult, preference }
})

/**
 * As mesmas preferências de um usuário EXPLÍCITO (recálculo em background, sem sessão). Linha
 * ausente ⇒ defaults; erro LANÇA (o recálculo não pode adivinhar a edição de ninguém).
 */
export async function loadMixedEditionSettingsFor(
  userId: string,
  supabase: Pick<SupabaseClient, "from"> = createAdminClient(),
): Promise<MixedEditionSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("hide_adult_content, preferred_mixed_edition")
    .eq("current_user_id", userId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`user_settings (edição de ${userId}): ${error.message}`)
  const row = (data ?? {}) as { hide_adult_content?: boolean | null; preferred_mixed_edition?: string | null }
  return { hideAdult: row.hide_adult_content === true, preference: parseMixedEdition(row.preferred_mixed_edition) }
}
