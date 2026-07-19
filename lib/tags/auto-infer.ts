import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildTagMenu, inferTagsFromText, buildReviewContext } from "@/lib/tags/infer-from-text"
import { resolveOrCreateTags } from "@/lib/tags/ingest"
import { recomputeAdultAuto } from "@/lib/tags/adult-classify"

type SupabaseAdmin = ReturnType<typeof createAdminClient>

const MIN_SYNOPSIS_CHARS = 80
// Conservador na criação: grava só o que o modelo afirmou com confiança "alta"
// (0.9). Reduz ruído e custo de revisão; a passada rica (Sonnet verify / reviews
// como contexto) fica pro backfill manual via scripts/infer-tags.ts.
const MIN_CONFIDENCE = 0.9

/**
 * Infere tags da SINOPSE de uma obra (Haiku) e grava as de alta confiança em
 * `work_tags` com source='ai_inferred' (espelha o que o script de backfill faz).
 *
 * Usa só a sinopse — NÃO depende de reviews/digest, então roda com segurança em
 * background na criação sem corrida com a aquisição assíncrona de reviews
 * (`acquireAndPersistWorkReviews`). Best-effort: nunca lança pro chamador. No-op
 * quando não há sinopse utilizável. Não re-grava tags já presentes na obra.
 *
 * @returns número de tags inferidas efetivamente inseridas (0 se pulou/falhou).
 */
export async function inferAndPersistTagsForWork(
  workId: string,
  opts: { supabase?: SupabaseAdmin } = {},
): Promise<number> {
  if (!workId) return 0
  try {
    const supabase = opts.supabase ?? createAdminClient()

    // Melhor texto disponível: canônica (se já existir) → senão a sinopse mais
    // longa entre as fontes. A canônica pode nem ter sido gerada (toggle off /
    // ainda async), por isso o fallback. Também lê o contexto de leitores
    // (digest → resumo) — reviews puxam tags que a sinopse omite (passada
    // `--with-reviews` validada). Ausente ⇒ roda só com a sinopse (sem corrida:
    // este passo é sequenciado após a aquisição de reviews no create).
    const { data: work } = await supabase
      .from("works")
      .select("canonical_synopsis, review_digest, review_summary")
      .eq("id", workId)
      .maybeSingle()
    let synopsis = ((work?.canonical_synopsis as string | null) ?? "").trim()
    if (synopsis.length < MIN_SYNOPSIS_CHARS) {
      const { data: rows } = await supabase
        .from("work_synopses")
        .select("text")
        .eq("work_id", workId)
      const longest =
        (rows ?? [])
          .map((r) => String((r as { text?: string }).text ?? "").trim())
          .sort((a, b) => b.length - a.length)[0] ?? ""
      if (longest.length > synopsis.length) synopsis = longest
    }
    if (synopsis.length < MIN_SYNOPSIS_CHARS) return 0

    const reviewContext = buildReviewContext(work?.review_summary, work?.review_digest)
    const menu = await buildTagMenu(supabase)
    const proposals = await inferTagsFromText({ supabase, synopsis, menu, reviewContext })

    // A inferência RODOU nesta obra (o modelo foi chamado com sinopse utilizável).
    // Marca a flag ANTES de filtrar/retornar — assim "rodou e achou 0" fica
    // distinguível de "nunca rodou" no sinal de cobertura da página. Best-effort.
    await supabase
      .from("works")
      .update({ tags_inferred_at: new Date().toISOString() })
      .eq("id", workId)

    const keep = proposals.filter((p) => p.confidence >= MIN_CONFIDENCE)
    if (keep.length === 0) return 0

    const { ids } = await resolveOrCreateTags(
      supabase,
      keep.map((p) => p.name),
    )
    const confByName = new Map(keep.map((p) => [p.name.toLowerCase(), p.confidence]))

    const { data: cur } = await supabase.from("work_tags").select("tag_id").eq("work_id", workId)
    const existing = new Set((cur ?? []).map((r) => r.tag_id as string))
    const newIds = [...new Set(ids)].filter((id) => !existing.has(id))
    if (newIds.length === 0) return 0

    const { data: tagRows } = await supabase.from("tags").select("id, name").in("id", newIds)
    const insertRows = (tagRows ?? []).map((t) => ({
      work_id: workId,
      tag_id: t.id as string,
      source: "ai_inferred",
      confidence: confByName.get(String(t.name).toLowerCase()) ?? MIN_CONFIDENCE,
    }))
    const { error } = await supabase
      .from("work_tags")
      .upsert(insertRows, { onConflict: "work_id,tag_id", ignoreDuplicates: true })
    if (error) {
      console.error("[inferAndPersistTagsForWork] upsert falhou:", error.message)
      return 0
    }
    // Uma tag explícita recém-inferida pode tornar a obra 18+ — recomputa (monotônico).
    await recomputeAdultAuto(supabase, workId)
    return insertRows.length
  } catch (err) {
    console.error(
      "[inferAndPersistTagsForWork] falhou:",
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
