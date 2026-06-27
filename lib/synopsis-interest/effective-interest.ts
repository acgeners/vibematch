import "server-only"
import type { createAdminClient } from "@/lib/supabase/admin"

type AdminClient = ReturnType<typeof createAdminClient>

/** Número da versão de prompt embutido na string (ex.: "synopsis-v2" → 2). -1 se ausente. */
function promptVersionNum(v: string | null | undefined): number {
  const m = (v ?? "").match(/(\d+)/)
  return m ? parseInt(m[1], 10) : -1
}

/**
 * Resolve o "interesse efetivo" por obra: usa o valor MANUAL (`works.synopsis_quality`)
 * quando existe, senão cai pra previsão da IA mais recente
 * (`synopsis_quality_predictions.predicted_quality` da maior versão de prompt).
 *
 * Read-only, sem LLM. Pagina por chunks de IDs (sem varrer a tabela inteira). Usado só
 * quando o filtro de interesse está ativo, então o caminho padrão não paga essa query.
 */
export async function loadEffectiveInterest(
  sb: AdminClient,
  ids: string[],
  manualByWork: Map<string, string | null>,
): Promise<Map<string, string | null>> {
  const predicted = new Map<string, { ver: number; q: string | null }>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    if (chunk.length === 0) continue
    const { data, error } = await sb
      .from("synopsis_quality_predictions")
      .select("work_id, predicted_quality, prompt_version")
      .in("work_id", chunk)
    if (error) throw new Error(`synopsis_quality_predictions: ${error.message}`)
    for (const r of (data ?? []) as Array<{ work_id: string; predicted_quality: string | null; prompt_version: string | null }>) {
      const ver = promptVersionNum(r.prompt_version)
      const prev = predicted.get(r.work_id)
      if (!prev || ver > prev.ver) predicted.set(r.work_id, { ver, q: r.predicted_quality ?? null })
    }
  }

  const out = new Map<string, string | null>()
  for (const id of ids) {
    const manual = manualByWork.get(id) ?? null
    out.set(id, manual ?? predicted.get(id)?.q ?? null)
  }
  return out
}
