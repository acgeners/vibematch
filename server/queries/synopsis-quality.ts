import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveInterestPromptVersion, COMPILED_PREFERENCES_V4_SHADOW } from "@/lib/ai-evaluation/compiled-preferences"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import type { SynopsisQuality } from "@/types/domain"

/** Nível ordinal (♥=1 … ♥♥♥♥=4); 0 se desconhecido. */
function synopsisLevel(q: string | null | undefined): number {
  if (!q) return 0
  const idx = (SYNOPSIS_QUALITIES as readonly string[]).indexOf(q)
  return idx >= 0 ? idx + 1 : 0
}

/** Número da versão de prompt ("v2" → 2); -1 se indecifrável (ordena por último). */
function promptVersionNum(v: string | null | undefined): number {
  const m = (v ?? "").match(/(\d+)/)
  return m ? parseInt(m[1], 10) : -1
}

/**
 * Com várias previsões por obra (uma por versão de prompt), escolhe a "ativa"
 * pra exibição: a da versão ATUAL se existir; senão a de maior versão.
 */
function pickActiveRaw<T extends { prompt_version?: string | null; predicted_at?: string | null }>(
  rows: T[],
): T | null {
  if (rows.length === 0) return null
  const activeVersion = resolveInterestPromptVersion()
  const current = rows.find((r) => (r.prompt_version ?? null) === activeVersion)
  if (current) return current
  return rows.slice().sort((a, b) => {
    const dv = promptVersionNum(b.prompt_version) - promptVersionNum(a.prompt_version)
    if (dv !== 0) return dv
    return String(b.predicted_at ?? "").localeCompare(String(a.predicted_at ?? ""))
  })[0]
}

export interface SynopsisQualityPredictionRow {
  id: string
  workId: string
  predictedQuality: SynopsisQuality
  justification: string | null
  confidence: number | null
  tasteProfileVersion: number | null
  tasteProfileHash: string
  modelName: string
  promptVersion: string
  stale: boolean
  predictedAt: string
}

function mapRow(row: Record<string, unknown>): SynopsisQualityPredictionRow {
  return {
    id: row.id as string,
    workId: row.work_id as string,
    predictedQuality: row.predicted_quality as SynopsisQuality,
    justification: (row.justification as string | null) ?? null,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    tasteProfileVersion: (row.taste_profile_version as number | null) ?? null,
    tasteProfileHash: row.taste_profile_hash as string,
    modelName: row.model_name as string,
    promptVersion: row.prompt_version as string,
    stale: Boolean(row.stale),
    predictedAt: row.predicted_at as string,
  }
}

export async function getSynopsisPredictionForWork(
  workId: string,
): Promise<SynopsisQualityPredictionRow | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("synopsis_quality_predictions")
    .select("*")
    .eq("work_id", workId)
  if (error) {
    console.warn("[synopsis-pred] getSynopsisPredictionForWork falhou:", error.message)
    return null
  }
  const active = pickActiveRaw((data ?? []) as Array<Record<string, unknown>>)
  return active ? mapRow(active) : null
}

export async function getSynopsisPredictionsByWorkIds(
  workIds: string[],
): Promise<Map<string, SynopsisQualityPredictionRow>> {
  const out = new Map<string, SynopsisQualityPredictionRow>()
  if (workIds.length === 0) return out
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("synopsis_quality_predictions")
    .select("*")
    .in("work_id", workIds)
  if (error) {
    console.warn("[synopsis-pred] getSynopsisPredictionsByWorkIds falhou:", error.message)
    return out
  }
  // Agrupa por obra (pode haver várias versões) e escolhe a ativa.
  const byWork = new Map<string, Array<Record<string, unknown>>>()
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>
    const id = r.work_id as string
    const list = byWork.get(id)
    if (list) list.push(r)
    else byWork.set(id, [r])
  }
  for (const [id, rows] of byWork) {
    const active = pickActiveRaw(rows)
    if (active) out.set(id, mapRow(active))
  }
  return out
}

/**
 * Carrega a previsão ATIVA de Interesse Sinopse de TODAS as obras de uma vez
 * (a tabela é pequena — uma linha por obra/versão de prompt). Usado pelo ranking
 * pra enriquecer as entries sem precisar de um IN gigante de work_ids. Agrupa por
 * obra e escolhe a versão ativa (atual se houver, senão a de maior versão).
 */
export async function getAllActiveSynopsisPredictions(): Promise<
  Map<string, SynopsisQualityPredictionRow>
> {
  const out = new Map<string, SynopsisQualityPredictionRow>()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("synopsis_quality_predictions")
    .select("*")
  if (error) {
    console.warn("[synopsis-pred] getAllActiveSynopsisPredictions falhou:", error.message)
    return out
  }
  const byWork = new Map<string, Array<Record<string, unknown>>>()
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>
    const id = r.work_id as string
    const list = byWork.get(id)
    if (list) list.push(r)
    else byWork.set(id, [r])
  }
  for (const [id, rows] of byWork) {
    const active = pickActiveRaw(rows)
    if (active) out.set(id, mapRow(active))
  }
  return out
}

export interface UpsertSynopsisPredictionArgs {
  workId: string
  predictedQuality: SynopsisQuality
  justification: string | null
  confidence: number | null
  tasteProfileId: string | null
  tasteProfileVersion: number | null
  tasteProfileHash: string
  modelName: string
  promptVersion: string
  aiApiCallId: string | null
}

export async function upsertSynopsisPrediction(
  args: UpsertSynopsisPredictionArgs,
): Promise<{ error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase.from("synopsis_quality_predictions").upsert(
    {
      work_id: args.workId,
      predicted_quality: args.predictedQuality,
      justification: args.justification,
      confidence: args.confidence,
      taste_profile_id: args.tasteProfileId,
      taste_profile_version: args.tasteProfileVersion,
      taste_profile_hash: args.tasteProfileHash,
      model_name: args.modelName,
      prompt_version: args.promptVersion,
      ai_api_call_id: args.aiApiCallId,
      stale: false,
      predicted_at: new Date().toISOString(),
    },
    { onConflict: "work_id,prompt_version" },
  )
  return error ? { error: error.message } : {}
}

/**
 * Marca como `stale` as previsões cujo `taste_profile_hash` difere do hash
 * atual — chamado quando um novo perfil de gosto vira o corrente. O `currentHash`
 * é a ASSINATURA DE CONTEÚDO do perfil (`computeProfileSignature`), não o
 * `input_hash` da biblioteca: assim regenerar o perfil sem mudar o gosto
 * destilado (mesmas tags/temas/pesos) NÃO invalida as previsões. Best-effort
 * (não lança): falhar aqui não deve quebrar a geração do perfil.
 */
export async function markSynopsisPredictionsStale(currentHash: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("synopsis_quality_predictions")
    .update({ stale: true })
    .eq("stale", false)
    .neq("taste_profile_hash", currentHash)
  if (error) {
    console.warn("[synopsis-pred] markSynopsisPredictionsStale falhou:", error.message)
  }
}

export interface SynopsisPredictionAccuracy {
  /** Obras com valor manual E previsão fresca (base da comparação). */
  n: number
  /** Viés médio em níveis (previsto − manual). + = IA superestima o interesse. */
  meanDelta: number | null
  /** Erro absoluto médio em níveis (|previsto − manual|). Menor = mais confiável. */
  mae: number | null
  /** Fração com acerto exato (delta = 0). */
  exactRate: number | null
  /** Fração dentro de ±1 nível. */
  within1Rate: number | null
}

/**
 * Acurácia da previsão de Interesse Sinopse: compara a previsão (fresca) com o
 * valor MANUAL, em escala de níveis (♥=1 … ♥♥♥♥=4), sobre todas as obras que têm
 * os dois. Serve de termômetro de confiança — recalculado a cada page load,
 * então melhora "conforme for gerando" mais previsões e marcando manuais.
 *
 * Ressalva: "Aplicar" copia a previsão pro manual ⇒ aquela obra vira delta 0 e
 * infla a concordância. Pra um sinal limpo, compare contra manuais que você
 * preencheu independentemente.
 */
export async function getSynopsisPredictionAccuracy(
  version: string = resolveInterestPromptVersion(),
): Promise<SynopsisPredictionAccuracy> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("synopsis_quality_predictions")
    .select("predicted_quality, works(synopsis_quality)")
    .eq("stale", false)
    .eq("prompt_version", version)
  if (error) {
    console.warn("[synopsis-pred] getSynopsisPredictionAccuracy falhou:", error.message)
    return { n: 0, meanDelta: null, mae: null, exactRate: null, within1Rate: null }
  }

  let n = 0
  let sum = 0
  let absSum = 0
  let exact = 0
  let within1 = 0
  for (const row of data ?? []) {
    const r = row as { predicted_quality: string | null; works: { synopsis_quality: string | null } | { synopsis_quality: string | null }[] | null }
    const workRel = Array.isArray(r.works) ? r.works[0] : r.works
    const manualLevel = synopsisLevel(workRel?.synopsis_quality)
    const predLevel = synopsisLevel(r.predicted_quality)
    if (manualLevel === 0 || predLevel === 0) continue
    const delta = predLevel - manualLevel
    n += 1
    sum += delta
    absSum += Math.abs(delta)
    if (delta === 0) exact += 1
    if (Math.abs(delta) <= 1) within1 += 1
  }

  if (n === 0) return { n: 0, meanDelta: null, mae: null, exactRate: null, within1Rate: null }
  return {
    n,
    meanDelta: sum / n,
    mae: absSum / n,
    exactRate: exact / n,
    within1Rate: within1 / n,
  }
}

export interface SynopsisVersionComparison {
  currentVersion: string
  previousVersion: string
  /** Obras com previsão das DUAS versões + manual (base pareada). */
  nPaired: number
  maeCurrent: number
  maePrevious: number
  biasCurrent: number
  biasPrevious: number
  /** Fração de obras em que a versão atual ficou MAIS perto do seu manual. */
  betterRate: number
  sameRate: number
  worseRate: number
  // --- Métricas de decisão A×B (shadow) ---
  /** Obras onde as previsões DIFEREM (cur≠prev) — as que carregam sinal. */
  discordant: number
  /** Gems perdidas (manual ≥ ♥♥♥ e previsto < manual) — o erro caro. */
  gemsLostCurrent: number
  gemsLostPrevious: number
  /** Precisão de ♥♥♥♥ (dos previstos ♥♥♥♥, quantos são ♥♥♥♥ manual). null se nenhum previu ♥♥♥♥. */
  highPrecCurrent: number | null
  highPrecPrevious: number | null
  /** p-valor bicaudal do teste de sinal (cur-melhor × prev-melhor). <0,05 = diferença significativa. */
  signP: number
}

/**
 * Teste de sinal bicaudal (binomial exata, p=0,5). a = # cur-melhor, b = # prev-melhor.
 * Retorna 1 quando não há discordâncias de erro (n=0).
 */
function binomialTwoSidedP(a: number, b: number): number {
  const n = a + b
  if (n === 0) return 1
  const k = Math.min(a, b)
  let pmf = Math.pow(0.5, n) // pmf(0) = C(n,0)·0.5^n
  let cdf = pmf
  for (let i = 1; i <= k; i += 1) {
    pmf *= (n - i + 1) / i // pmf(i)/pmf(i-1) = (n-i+1)/i
    cdf += pmf
  }
  return Math.min(1, 2 * cdf)
}

/**
 * Comparação PAREADA entre a versão de prompt atual e a anterior, nas MESMAS
 * obras (que têm previsão das duas + valor manual). É a forma correta de saber
 * se a recalibração melhorou — em vez de comparar agregados de conjuntos
 * diferentes. Retorna null quando não há versão anterior nem nenhum par ainda.
 */
export async function getSynopsisVersionComparison(
  currentVersion: string = resolveInterestPromptVersion(),
): Promise<SynopsisVersionComparison | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("synopsis_quality_predictions")
    .select("work_id, predicted_quality, prompt_version, works(synopsis_quality)")
  if (error) {
    console.warn("[synopsis-pred] getSynopsisVersionComparison falhou:", error.message)
    return null
  }

  type Agg = { manual: number; byVer: Map<string, number> }
  const works = new Map<string, Agg>()
  const otherVersions = new Set<string>()
  for (const row of data ?? []) {
    const r = row as {
      work_id: string
      predicted_quality: string | null
      prompt_version: string | null
      works: { synopsis_quality: string | null } | { synopsis_quality: string | null }[] | null
    }
    const predLevel = synopsisLevel(r.predicted_quality)
    if (predLevel === 0) continue
    const workRel = Array.isArray(r.works) ? r.works[0] : r.works
    const manualLevel = synopsisLevel(workRel?.synopsis_quality)
    if (manualLevel === 0) continue
    const ver = r.prompt_version ?? ""
    let agg = works.get(r.work_id)
    if (!agg) {
      agg = { manual: manualLevel, byVer: new Map() }
      works.set(r.work_id, agg)
    }
    agg.byVer.set(ver, predLevel)
    if (ver !== currentVersion) otherVersions.add(ver)
  }
  if (otherVersions.size === 0) return null
  const previousVersion = [...otherVersions].sort(
    (a, b) => promptVersionNum(b) - promptVersionNum(a),
  )[0]

  let nPaired = 0
  let sumC = 0
  let sumP = 0
  let absC = 0
  let absP = 0
  let better = 0
  let same = 0
  let worse = 0
  let discordant = 0
  let gemsC = 0
  let gemsP = 0
  let pred4C = 0
  let tp4C = 0
  let pred4P = 0
  let tp4P = 0
  for (const agg of works.values()) {
    const cur = agg.byVer.get(currentVersion)
    const prev = agg.byVer.get(previousVersion)
    if (cur == null || prev == null) continue
    const dC = cur - agg.manual
    const dP = prev - agg.manual
    nPaired += 1
    sumC += dC
    sumP += dP
    absC += Math.abs(dC)
    absP += Math.abs(dP)
    if (Math.abs(dC) < Math.abs(dP)) better += 1
    else if (Math.abs(dC) === Math.abs(dP)) same += 1
    else worse += 1
    if (cur !== prev) discordant += 1
    // Gems perdidas: obra amada (manual ≥ ♥♥♥) prevista abaixo do manual.
    if (agg.manual >= 3 && cur < agg.manual) gemsC += 1
    if (agg.manual >= 3 && prev < agg.manual) gemsP += 1
    // Precisão de ♥♥♥♥ (guarda-corpo anti-inundação do topo).
    if (cur === 4) { pred4C += 1; if (agg.manual === 4) tp4C += 1 }
    if (prev === 4) { pred4P += 1; if (agg.manual === 4) tp4P += 1 }
  }
  if (nPaired === 0) return null
  return {
    currentVersion,
    previousVersion,
    nPaired,
    maeCurrent: absC / nPaired,
    maePrevious: absP / nPaired,
    biasCurrent: sumC / nPaired,
    biasPrevious: sumP / nPaired,
    betterRate: better / nPaired,
    sameRate: same / nPaired,
    worseRate: worse / nPaired,
    discordant,
    gemsLostCurrent: gemsC,
    gemsLostPrevious: gemsP,
    highPrecCurrent: pred4C > 0 ? tp4C / pred4C : null,
    highPrecPrevious: pred4P > 0 ? tp4P / pred4P : null,
    signP: binomialTwoSidedP(better, worse),
  }
}

// ============================================================================
// MEDIDA TEMPORÁRIA — shadow A/B: linhas por-obra com os DOIS arms + confiança.
// ============================================================================

export interface ShadowCompareRow {
  workId: string
  title: string
  armA: { quality: string | null; confidence: number | null }
  armB: { quality: string | null; confidence: number | null }
  manual: string | null
  /** true quando as faixas previstas diferem (o que carrega sinal). */
  discordant: boolean
}

/**
 * Obras com previsão dos DOIS arms (A = versão ativa; B = "v5s"). Bounded pelo
 * tamanho do arm B (só obras previstas desde que o shadow foi ligado) — busca o
 * arm B primeiro (pequeno), depois o arm A só desses work_ids. Discordantes 1º.
 */
export async function getShadowComparisonRows(): Promise<ShadowCompareRow[]> {
  const armAVer = resolveInterestPromptVersion()
  const armBVer = COMPILED_PREFERENCES_V4_SHADOW.promptVersion
  const supabase = createAdminClient()

  const { data: bRows, error: bErr } = await supabase
    .from("synopsis_quality_predictions")
    .select("work_id, predicted_quality, confidence, works(title, synopsis_quality)")
    .eq("prompt_version", armBVer)
  if (bErr) {
    console.warn("[shadow] getShadowComparisonRows (arm B) falhou:", bErr.message)
    return []
  }
  const bByWork = new Map<string, { quality: string | null; confidence: number | null; title: string; manual: string | null }>()
  for (const row of bRows ?? []) {
    const r = row as { work_id: string; predicted_quality: string | null; confidence: number | null; works: { title: string | null; synopsis_quality: string | null } | { title: string | null; synopsis_quality: string | null }[] | null }
    const w = Array.isArray(r.works) ? r.works[0] : r.works
    bByWork.set(r.work_id, {
      quality: r.predicted_quality,
      confidence: r.confidence != null ? Number(r.confidence) : null,
      title: w?.title ?? "(sem título)",
      manual: w?.synopsis_quality ?? null,
    })
  }
  const workIds = [...bByWork.keys()]
  if (workIds.length === 0) return []

  const { data: aRows, error: aErr } = await supabase
    .from("synopsis_quality_predictions")
    .select("work_id, predicted_quality, confidence")
    .eq("prompt_version", armAVer)
    .in("work_id", workIds)
  if (aErr) {
    console.warn("[shadow] getShadowComparisonRows (arm A) falhou:", aErr.message)
    return []
  }
  const aByWork = new Map<string, { quality: string | null; confidence: number | null }>()
  for (const row of aRows ?? []) {
    const r = row as { work_id: string; predicted_quality: string | null; confidence: number | null }
    aByWork.set(r.work_id, { quality: r.predicted_quality, confidence: r.confidence != null ? Number(r.confidence) : null })
  }

  const out: ShadowCompareRow[] = []
  for (const [workId, b] of bByWork) {
    const a = aByWork.get(workId)
    if (!a) continue // precisa dos DOIS arms
    out.push({
      workId,
      title: b.title,
      armA: { quality: a.quality, confidence: a.confidence },
      armB: { quality: b.quality, confidence: b.confidence },
      manual: b.manual,
      discordant: a.quality !== b.quality,
    })
  }
  // Discordantes primeiro; depois por título.
  out.sort((x, y) => (Number(y.discordant) - Number(x.discordant)) || x.title.localeCompare(y.title))
  return out
}

/** Marca a previsão de UMA obra como desatualizada (ex.: sinopse canônica mudou). */
export async function markWorkSynopsisPredictionStale(workId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("synopsis_quality_predictions")
    .update({ stale: true })
    .eq("work_id", workId)
  if (error) {
    console.warn("[synopsis-pred] markWorkSynopsisPredictionStale falhou:", error.message)
  }
}
