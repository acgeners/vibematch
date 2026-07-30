import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { consolidateSynopsis, hashSynopsisInputs } from "@/lib/ai-recommendation/synopsis-consolidator"
import { splitSynopsesFromText } from "@/lib/work-derived"
import { markWorkSynopsisPredictionStale } from "@/server/queries/synopsis-quality"

export type ConsolidateForWorkResult =
  | { status: "done" }
  | { status: "fresh" } // hash igual — fontes não mudaram, no-op
  | { status: "no_synopsis" } // sem sinopse bruta pra consolidar
  | { status: "failed"; error: string }

/**
 * Consolida a sinopse canônica de UMA obra (Haiku), de forma AGUARDÁVEL. É o
 * núcleo extraído do corpo de `scheduleSynopsisConsolidation` (que fica só como
 * wrapper `after()` fire-and-forget). Gate por `canonical_synopsis_inputs_hash`:
 * no-op barato quando as fontes não mudaram.
 *
 * NÃO dispara a previsão de Interesse — o caller decide (a cascata roda o passo
 * de Interesse explicitamente; o `scheduleSynopsisConsolidation` mantém o eager
 * da 1ª previsão por fora). Marca a previsão como stale ao consolidar.
 */
const inFlightConsolidation = new Map<string, Promise<ConsolidateForWorkResult>>()

export interface ConsolidateForWorkOptions {
  /**
   * Ignora o gate de `canonical_synopsis_inputs_hash` e regenera mesmo com as
   * fontes inalteradas. É o que o botão "Regerar sinopse" usa: sem isto, uma
   * obra cujas fontes não mudaram devolve `fresh` para sempre e a troca de
   * prompt/modelo nunca a alcança. Mesmo papel do `force` de `ensureReviewDigest`.
   */
  force?: boolean
}

export function consolidateSynopsisForWork(
  workId: string,
  opts: ConsolidateForWorkOptions = {},
): Promise<ConsolidateForWorkResult> {
  // Single-flight por workId: na criação, DUAS `after()` PARALELAS pedem a canônica —
  // a consolidação agendada (`scheduleSynopsisConsolidation`) e a inferência de tags
  // que passou a aguardá-la (Lacuna #4). O hash-gate abaixo NÃO protege chamada
  // concorrente (ambas leem o hash antes de qualquer uma gravar) ⇒ 2× Haiku. Aqui a
  // 2ª chamada reusa a promise em voo; a entrada sai no `finally`, e chamadas já
  // concluídas seguem cobertas pelo hash-gate.
  //
  // A chave inclui o `force`: uma chamada forçada NÃO pode reusar a promise de
  // uma não-forçada em voo, senão herdaria o `fresh` dela e o botão "Regerar"
  // não faria nada — falhando em silêncio, que é o pior desfecho possível.
  const key = opts.force ? `${workId}:force` : workId
  const existing = inFlightConsolidation.get(key)
  if (existing) return existing
  const promise = runConsolidateSynopsisForWork(workId, opts).finally(() =>
    inFlightConsolidation.delete(key),
  )
  inFlightConsolidation.set(key, promise)
  return promise
}

async function runConsolidateSynopsisForWork(
  workId: string,
  opts: ConsolidateForWorkOptions = {},
): Promise<ConsolidateForWorkResult> {
  try {
    const supabase = createAdminClient()
    const { data: existingWork } = await supabase
      .from("works")
      .select("canonical_synopsis_inputs_hash")
      .eq("id", workId)
      .maybeSingle()
    const { data: synopsisRows } = await supabase
      .from("work_synopses")
      .select("text")
      .eq("work_id", workId)

    const rawBlocks = (synopsisRows ?? [])
      .map((r) => (r.text as string | null) ?? "")
      .filter((t) => t.trim().length > 0)
    if (rawBlocks.length === 0) return { status: "no_synopsis" }

    // Fontes reais costumam vir concatenadas com `---` (importer legado) — expande
    // pra blocos antes de hashear (idêntico ao scheduleSynopsisConsolidation).
    const expanded = rawBlocks.flatMap((t) => {
      const blocks = splitSynopsesFromText(t)
      return blocks.length > 0 ? blocks : [t]
    })
    const hash = hashSynopsisInputs(expanded)
    if (!opts.force && existingWork?.canonical_synopsis_inputs_hash === hash) return { status: "fresh" }

    const result = await consolidateSynopsis(expanded, { workId })
    if (!result) return { status: "failed", error: "consolidateSynopsis retornou vazio" }

    await supabase
      .from("works")
      .update({
        canonical_synopsis: result.canonical,
        canonical_synopsis_at: new Date().toISOString(),
        canonical_synopsis_inputs_hash: hash,
      })
      .eq("id", workId)

    await markWorkSynopsisPredictionStale(workId)
    return { status: "done" }
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) }
  }
}
