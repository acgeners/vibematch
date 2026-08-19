import "server-only"
import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { getCurrentUserId } from "@/server/queries/current-user"

type GuardStatus = "ok" | "warn" | "unknown"

export interface Guard1Result {
  status: GuardStatus
  biasProfile: { model: string; promptVersion: string } | null
  recentProfile: { model: string; promptVersion: string } | null
  message: string | null
}

export interface Guard2Result {
  status: GuardStatus
  unreadWorks: number
  lowCoverageWorks: number
  pctLowCoverage: number
  message: string | null
}

export interface Guard3Result {
  status: GuardStatus
  attributesLowConfidence: number
  totalWithSamples: number
  message: string | null
}

export interface Guard4Result {
  status: GuardStatus
  recentMae: number | null
  baselineMae: number | null
  pctIncrease: number | null
  message: string | null
}

export interface PredictionHealth {
  overall: "ok" | "warn" | "alert"
  guard1: Guard1Result
  guard2: Guard2Result
  guard3: Guard3Result
  guard4: Guard4Result
}

const LOW_COVERAGE_MIN_READ = 5 // obras lidas mínimas por gênero
const LOW_COVERAGE_PCT_WARN = 15
const LOW_CONFIDENCE_N = 10
const MAE_INCREASE_WARN_PCT = 20

function dominant<T extends Record<string, unknown>>(
  rows: T[],
  keyOf: (r: T) => string,
): { key: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = keyOf(r)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best: { key: string; count: number } | null = null
  for (const [key, count] of counts) {
    if (!best || count > best.count) best = { key, count }
  }
  return best
}

/**
 * Guard 1 — drift de modelo/prompt. O bias foi calibrado contra um certo
 * modelo/prompt (snapshot em user_attribute_assessment). Se as avaliações
 * recentes usam outro, o offset pode não valer mais.
 */
async function checkGuard1(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<Guard1Result> {
  const [{ data: assess }, recent] = await Promise.all([
    supabase
      .from("user_attribute_assessment")
      .select("ia_model_at_assessment, ia_prompt_version")
      .eq("user_id", userId),
    fetchAllRows<{ model_name: string | null; prompt_version: string | null; created_at: string }>(
      (from, to) =>
        supabase
          .from("ai_evaluations")
          .select("model_name, prompt_version, created_at")
          .eq("status", "completed")
          .gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString())
          .range(from, to),
      "calibrationGuards.recentEvals",
    ),
  ])

  const biasDom = dominant(assess ?? [], (r) => `${r.ia_model_at_assessment}|${r.ia_prompt_version}`)
  const recentDom = dominant(recent ?? [], (r) => `${r.model_name}|${r.prompt_version}`)
  if (!biasDom || !recentDom) {
    return { status: "unknown", biasProfile: null, recentProfile: null, message: null }
  }
  const [bm, bp] = biasDom.key.split("|")
  const [rm, rp] = recentDom.key.split("|")
  const biasProfile = { model: bm, promptVersion: bp }
  const recentProfile = { model: rm, promptVersion: rp }
  if (biasDom.key === recentDom.key) {
    return { status: "ok", biasProfile, recentProfile, message: null }
  }
  return {
    status: "warn",
    biasProfile,
    recentProfile,
    message: `Bias calibrado contra ${bm}/${bp}; avaliações recentes usam ${rm}/${rp}. Considere re-coletar pós-leitura em obras representativas.`,
  }
}

/**
 * Núcleo compartilhado da cobertura de gênero: retorna o conjunto de obras
 * não-lidas com baixa cobertura (algum gênero com < LOW_COVERAGE_MIN_READ obras
 * lidas, ou sem gênero algum).
 *
 * 🔴 O gênero vem de `work_genres`, NUNCA de uma coluna de `works`/`works_owner`.
 * A coluna legada `works.genres` (text[]) foi DROPADA na migration 024, e este
 * cálculo continuou pedindo `genres` no select por muito tempo: o PostgREST
 * devolvia `{ data: null, error: "column does not exist" }`, o chamador ignorava
 * o `error` e o conjunto saía VAZIO — o guard 2 dizia "unknown" e o badge ⚠ do
 * /ranking nunca acendia, sem erro e sem log. Quem denunciou foi a paginação
 * (`fetchAllRows` LANÇA no erro do PostgREST), que transformou o resultado
 * silencioso em Runtime Error na /ranking.
 *
 * ⚠️ A chave da contagem é o `genre_id` (uuid), não o nome: o nome só existiria
 * pra ser reagrupado por igualdade de string, e buscá-lo custaria um join que
 * nenhuma saída daqui usa (o retorno são workIds).
 */
async function computeLowCoverage(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ unreadIds: string[]; lowCoverageIds: Set<string> }> {
  const [works, links] = await Promise.all([
    fetchAllRows<{ id: string; user_score: number | null }>(
      (from, to) =>
        supabase.from("works_owner").select("id, user_score").eq("is_archived", false).range(from, to),
      "calibrationGuards.works",
    ),
    fetchAllRows<{ work_id: string; genre_id: string }>(
      (from, to) => supabase.from("work_genres").select("work_id, genre_id").range(from, to),
      "calibrationGuards.workGenres",
    ),
  ])

  const genresByWork = new Map<string, string[]>()
  for (const l of links) {
    const atual = genresByWork.get(l.work_id)
    if (atual) atual.push(l.genre_id)
    else genresByWork.set(l.work_id, [l.genre_id])
  }

  const readCountByGenre = new Map<string, number>()
  for (const w of works) {
    if (w.user_score == null) continue
    for (const g of genresByWork.get(w.id) ?? []) {
      readCountByGenre.set(g, (readCountByGenre.get(g) ?? 0) + 1)
    }
  }

  const unreadIds: string[] = []
  const lowCoverageIds = new Set<string>()
  for (const w of works) {
    if (w.user_score != null) continue
    unreadIds.push(w.id)
    const generos = genresByWork.get(w.id) ?? []
    if (generos.length === 0) {
      lowCoverageIds.add(w.id)
      continue
    }
    const minCov = Math.min(...generos.map((g) => readCountByGenre.get(g) ?? 0))
    if (minCov < LOW_COVERAGE_MIN_READ) lowCoverageIds.add(w.id)
  }
  return { unreadIds, lowCoverageIds }
}

/**
 * Guard 2 — cobertura de gênero. Obras não-lidas cujos gêneros têm pouca
 * representação no conjunto de treino (obras lidas) têm predição menos confiável.
 */
async function checkGuard2(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Guard2Result> {
  const { unreadIds, lowCoverageIds } = await computeLowCoverage(supabase)
  const lowCoverage = lowCoverageIds.size
  const pct = unreadIds.length > 0 ? Math.round((lowCoverage / unreadIds.length) * 100) : 0
  const status: GuardStatus =
    unreadIds.length === 0 ? "unknown" : pct > LOW_COVERAGE_PCT_WARN ? "warn" : "ok"
  return {
    status,
    unreadWorks: unreadIds.length,
    lowCoverageWorks: lowCoverage,
    pctLowCoverage: pct,
    message:
      status === "warn"
        ? `${lowCoverage} obras (${pct}%) com baixa cobertura de gênero — predições nelas têm confiança reduzida.`
        : null,
  }
}

/**
 * Lista (array — serializável p/ cache) de workIds não-lidos com baixa cobertura
 * de gênero. Cacheada com tag `low-coverage`, invalidada no fim de `recalculateAll`
 * (quando a base de obras/leituras muda). É um full-scan de works.genres — caro o
 * suficiente pra não rodar em toda navegação do /ranking.
 */
const getLowCoverageWorkIdsCached = unstable_cache(
  async (): Promise<string[]> => {
    const supabase = createAdminClient()
    const { lowCoverageIds } = await computeLowCoverage(supabase)
    return [...lowCoverageIds]
  },
  ["low-coverage-work-ids"],
  { revalidate: 300, tags: ["low-coverage"] },
)

/**
 * Conjunto de workIds não-lidos com baixa cobertura de gênero. Usado pelo badge
 * ⚠ no ranking.
 */
export async function getLowCoverageWorkIds(): Promise<Set<string>> {
  return new Set(await getLowCoverageWorkIdsCached())
}

/**
 * Só o Guard 1 (drift de modelo/prompt) — leve o suficiente pra rodar na página
 * de cada obra (indicador ⚠ perto do botão "Avaliar IA").
 */
export async function getModelPromptDrift(): Promise<Guard1Result> {
  const supabase = createAdminClient()
  const userId = await getCurrentUserId(supabase)
  return checkGuard1(supabase, userId)
}

/**
 * Guard 3 — tamanho de amostra do bias. Atributos com n<10 têm offset pouco
 * confiável (o shrinkage já encolhe, mas vale sinalizar).
 */
async function checkGuard3(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<Guard3Result> {
  const { data } = await supabase
    .from("attribute_bias")
    .select("n_samples")
    .eq("user_id", userId)
    .gt("n_samples", 0)

  const samples = (data ?? []) as Array<{ n_samples: number }>
  const low = samples.filter((r) => r.n_samples < LOW_CONFIDENCE_N).length
  const status: GuardStatus = samples.length === 0 ? "unknown" : low > 3 ? "warn" : "ok"
  return {
    status,
    attributesLowConfidence: low,
    totalWithSamples: samples.length,
    message:
      status === "warn"
        ? `${low} atributos com <${LOW_CONFIDENCE_N} amostras — colete mais avaliações pós-leitura pra firmar o offset.`
        : null,
  }
}

/**
 * Guard 4 — degradação de MAE. Compara o MAE recente (últimas 5 medições em
 * calibration_history) contra a baseline (30 anteriores). Detecta drift silencioso.
 */
async function checkGuard4(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Guard4Result> {
  const { data } = await supabase
    .from("calibration_history")
    .select("recorded_at, mae_final")
    .order("recorded_at", { ascending: false })
    .limit(35)

  const maes = ((data ?? []) as Array<{ mae_final: number | null }>)
    .map((r) => (r.mae_final == null ? null : Number(r.mae_final)))
    .filter((v): v is number => v != null)

  if (maes.length < 10) {
    return { status: "unknown", recentMae: null, baselineMae: null, pctIncrease: null, message: null }
  }
  const recent = maes.slice(0, 5)
  const baseline = maes.slice(5)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const recentMae = mean(recent)
  const baselineMae = mean(baseline)
  const pctIncrease = baselineMae > 0 ? Math.round(((recentMae - baselineMae) / baselineMae) * 100) : 0
  const status: GuardStatus = pctIncrease > MAE_INCREASE_WARN_PCT ? "warn" : "ok"
  return {
    status,
    recentMae: Number(recentMae.toFixed(3)),
    baselineMae: Number(baselineMae.toFixed(3)),
    pctIncrease,
    message:
      status === "warn"
        ? `MAE recente ${recentMae.toFixed(2)} é ${pctIncrease}% maior que a baseline ${baselineMae.toFixed(2)}. Possível drift de bias/modelo ou mudança no perfil de obras avaliadas.`
        : null,
  }
}

export async function getPredictionHealth(): Promise<PredictionHealth> {
  const supabase = createAdminClient()
  const userId = await getCurrentUserId(supabase)

  const [guard1, guard2, guard3, guard4] = await Promise.all([
    checkGuard1(supabase, userId),
    checkGuard2(supabase),
    checkGuard3(supabase, userId),
    checkGuard4(supabase),
  ])

  const warns = [guard1, guard2, guard3, guard4].filter((g) => g.status === "warn").length
  const overall: PredictionHealth["overall"] = warns === 0 ? "ok" : warns === 1 ? "warn" : "alert"
  return { overall, guard1, guard2, guard3, guard4 }
}
