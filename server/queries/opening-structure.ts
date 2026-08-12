import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import type { OpeningStructureContext } from "@/lib/works/opening-structure"

/**
 * Leitura do veredito de estrutura de abertura e do material que o produz.
 *
 * Catálogo, não per-user: `createAdminClient` (service role). O veredito descreve a OBRA e vale
 * para todo leitor — ao contrário de `user_work_state`, ele não tem dono.
 */

/** Tropos temporais. Entram no prompt rotulados como NÃO-evidência — ver a régua em lib/works. */
const TROPE_TAG_RE = /regress|reincarn|transmigrat|time-travel|time-loop|time-skip|flashback/

export interface OpeningStructureRow {
  /** A coluna GERADA — é esta que a UI lê. */
  opening_structure: "flashforward" | "linear" | "indeterminado" | null
  opening_structure_auto: "flashforward" | "linear" | "indeterminado" | null
  opening_structure_auto_confidence: number | null
  opening_structure_auto_evidence: string | null
  opening_structure_auto_rationale: string | null
  opening_structure_auto_source: "local" | "web" | null
  opening_structure_auto_model: string | null
  opening_structure_auto_at: string | null
  opening_structure_override: "flashforward" | "linear" | null
}

export const OPENING_STRUCTURE_SELECT =
  "opening_structure, opening_structure_auto, opening_structure_auto_confidence, " +
  "opening_structure_auto_evidence, opening_structure_auto_rationale, " +
  "opening_structure_auto_source, opening_structure_auto_model, opening_structure_auto_at, " +
  "opening_structure_override"

export async function getOpeningStructure(workId: string): Promise<OpeningStructureRow | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(OPENING_STRUCTURE_SELECT)
    .eq("id", workId)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as OpeningStructureRow
}

/**
 * Monta o material que o modelo lê.
 *
 * ⚠️ As reviews são PAGINADAS. `work_reviews` tem ~14 mil linhas no total e uma obra popular
 * passa de 100 — o `select` do PostgREST corta em 1000 sem erro e sem aviso, e aqui o corte
 * silencioso removeria justamente as reviews que descrevem a abertura.
 */
export async function getOpeningStructureContext(
  workId: string,
): Promise<{ data?: OpeningStructureContext; error?: string }> {
  const supabase = createAdminClient()

  const { data: work, error: workErr } = await supabase
    .from("works")
    .select("id, title, canonical_synopsis, review_digest")
    .eq("id", workId)
    .maybeSingle()
  if (workErr) return { error: `Falha carregando a obra: ${workErr.message}` }
  if (!work) return { error: "Obra não encontrada." }

  const reviews: Array<{ source: string | null; text: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("work_reviews")
      .select("source, text")
      .eq("work_id", workId)
      .range(from, from + 999)
    if (error) return { error: `Falha carregando reviews: ${error.message}` }
    if (!data?.length) break
    for (const r of data) {
      const text = String((r as { text?: string | null }).text ?? "").trim()
      if (text) reviews.push({ source: (r as { source?: string | null }).source ?? null, text })
    }
    if (data.length < 1000) break
  }

  const { data: tagRows, error: tagErr } = await supabase
    .from("work_tags")
    .select("tags(slug)")
    .eq("work_id", workId)
  if (tagErr) return { error: `Falha carregando tags: ${tagErr.message}` }

  const tropeTags = (tagRows ?? [])
    .map((t) => (t as { tags?: { slug?: string } | null }).tags?.slug)
    .filter((s): s is string => !!s && TROPE_TAG_RE.test(s))

  return {
    data: {
      workId,
      title: String((work as { title?: string }).title ?? ""),
      synopsis: (work as { canonical_synopsis?: string | null }).canonical_synopsis ?? null,
      digest: (work as { review_digest?: unknown }).review_digest ?? null,
      reviews,
      tropeTags,
    },
  }
}
