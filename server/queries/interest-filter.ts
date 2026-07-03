import { createAdminClient } from "@/lib/supabase/admin"
import { selectByIdsInChunks } from "@/lib/supabase/paginate"
import { resolveInterestPromptVersion } from "@/lib/ai-evaluation/compiled-preferences"

/**
 * Filtro de Interesse na obra (manual + previsão da IA) aplicado como PÓS-FETCH
 * uniforme, pra as filas de /ai-evaluation cujas queries não filtram por isso de
 * forma consistente (atributos, Veredito IA, Untracked, Tags & Reviews). A aba
 * "Interesse" já filtra internamente (`getSynopsisQueueWorks`) e não usa isto.
 *
 * - Manual: casa por VALOR de `synopsis_quality` (♥…♥♥♥♥) + sentinelas de UI
 *   "none" (Não avaliada = NULL) e "unknown" (Desconhecido =
 *   synopsis_quality_source 'legacy_unknown').
 * - Previsão: casa pelo `predicted_quality` da previsão ATIVA (versão de prompt
 *   atual, senão a de maior versão) em `synopsis_quality_predictions`.
 *
 * NO-OP barato: sem filtros ativos devolve o conjunto original sem tocar no
 * banco. Só busca as colunas necessárias (e só dos ids passados) quando há filtro.
 */
export async function filterWorkIdsByInterest(
  ids: string[],
  manualQualities: string[],
  predictedQualities: string[],
): Promise<Set<string>> {
  const manualActive = manualQualities.length > 0
  const predActive = predictedQualities.length > 0
  if ((!manualActive && !predActive) || ids.length === 0) return new Set(ids)

  const sb = createAdminClient()
  let keep = new Set(ids)

  if (manualActive) {
    const realHearts = new Set(manualQualities.filter((q) => q !== "none" && q !== "unknown"))
    const wantNone = manualQualities.includes("none")
    const wantUnknown = manualQualities.includes("unknown")
    const { data, error } = await selectByIdsInChunks<{
      id: string
      synopsis_quality: string | null
      synopsis_quality_source: string | null
    }>(ids, (chunk) =>
      sb.from("works").select("id, synopsis_quality, synopsis_quality_source").in("id", chunk),
    )
    if (error) throw new Error(`Falha filtrando por Interesse manual: ${error.message}`)
    const passing = new Set<string>()
    for (const r of data) {
      const q = r.synopsis_quality
      if (q != null && realHearts.has(q)) passing.add(r.id)
      else if (wantNone && q == null) passing.add(r.id)
      else if (wantUnknown && r.synopsis_quality_source === "legacy_unknown") passing.add(r.id)
    }
    keep = new Set([...keep].filter((id) => passing.has(id)))
  }

  if (predActive && keep.size > 0) {
    const predByWork = await getActivePredictedQuality([...keep], sb)
    const wanted = new Set(predictedQualities)
    keep = new Set([...keep].filter((id) => {
      const q = predByWork.get(id)
      return q != null && wanted.has(q)
    }))
  }

  return keep
}

/**
 * Map obra → `predicted_quality` da previsão ATIVA (só dos ids passados). Pode
 * haver várias previsões por obra (uma por versão de prompt); escolhe a da versão
 * atual, senão a de maior versão — mesmo critério de `getSynopsisQueueWorks`.
 */
async function getActivePredictedQuality(
  ids: string[],
  sb: ReturnType<typeof createAdminClient>,
): Promise<Map<string, string | null>> {
  const { data, error } = await selectByIdsInChunks<{
    work_id: string
    predicted_quality: string | null
    prompt_version: string | null
  }>(ids, (chunk) =>
    sb.from("synopsis_quality_predictions").select("work_id, predicted_quality, prompt_version").in("work_id", chunk),
  )
  if (error) throw new Error(`Falha lendo previsões de Interesse: ${error.message}`)

  const activeVersion = resolveInterestPromptVersion()
  const verNum = (v: string | null) => {
    const m = (v ?? "").match(/(\d+)/)
    return m ? parseInt(m[1], 10) : -1
  }
  const byWork = new Map<string, Array<{ predicted_quality: string | null; prompt_version: string | null }>>()
  for (const r of data) {
    const list = byWork.get(r.work_id)
    if (list) list.push(r)
    else byWork.set(r.work_id, [r])
  }
  const map = new Map<string, string | null>()
  for (const [workId, rows] of byWork) {
    const current = rows.find((r) => (r.prompt_version ?? null) === activeVersion)
    const chosen = current ?? rows.slice().sort((a, b) => verNum(b.prompt_version) - verNum(a.prompt_version))[0]
    map.set(workId, chosen?.predicted_quality ?? null)
  }
  return map
}
