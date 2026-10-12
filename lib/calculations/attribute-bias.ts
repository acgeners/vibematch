import { CRITERION_SLUGS } from "@/types/domain"
import type { AttributeBiasMap } from "@/lib/ai-recommendation/calibrated-scores"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { parseMixedEdition } from "@/lib/editions/mixed-edition"
import type { EditionScoreSource, MixedEdition } from "@/lib/editions/mixed-edition"

// ============================================================
// Cálculo do offset de atributos (Fase 1.5)
// ============================================================
// Sinal bruto: delta = ia_value - user_value por amostra (obra avaliada
// pós-leitura). meanBiasRaw > 0 → a IA superestima o atributo.
//
// Shrinkage Bayesiano encolhe a correção quando há poucas amostras:
//   biasApplied = meanBiasRaw × n / (n + K)
// Com K=10: n=10 aplica 50%, n=50 aplica ~83%, n=0 aplica 0%.
//
// O pipeline aplica `valor_calibrado = valor_IA - biasApplied`
// (ver applyBiasToCategoryScores em lib/ai-recommendation/calibrated-scores.ts).

export const BIAS_SHRINKAGE_K = 10

export interface BiasComputation {
  attributeSlug: string
  nSamples: number
  meanBiasRaw: number
  biasApplied: number
  stddev: number | null // null quando n < 2
}

/**
 * Núcleo puro do cálculo. `deltas` = lista de (ia_value - user_value).
 * Sem amostras → tudo zero, sem correção.
 */
export function computeBiasForSlug(slug: string, deltas: number[]): BiasComputation {
  const n = deltas.length
  if (n === 0) {
    return { attributeSlug: slug, nSamples: 0, meanBiasRaw: 0, biasApplied: 0, stddev: null }
  }

  const mean = deltas.reduce((acc, d) => acc + d, 0) / n
  const biasApplied = mean * (n / (n + BIAS_SHRINKAGE_K))

  let stddev: number | null = null
  if (n >= 2) {
    const variance = deltas.reduce((acc, d) => acc + (d - mean) ** 2, 0) / (n - 1)
    stddev = Math.sqrt(variance)
  }

  return {
    attributeSlug: slug,
    nSamples: n,
    meanBiasRaw: mean,
    biasApplied,
    stddev,
  }
}

interface AssessmentRow {
  work_id: string
  attribute_slug: string
  user_value: number | string
  ia_value_at_assessment: number | string
}

/**
 * Contexto de VERSÃO das amostras de `adult_content` em obra mixed (mig 216). `readEdition` é a
 * versão registrada na avaliação da pessoa (vale para a avaliação inteira, inclusive a pós-leitura
 * de atributos); `editionScore` é a nota daquela versão em `work_edition_scores`.
 */
export interface BiasEditionContext {
  isMixed: boolean
  readEdition: MixedEdition | null
  editionScore: { score: number | null; source: EditionScoreSource } | null
}

/**
 * A nota DE IA contra a qual a pessoa julgou o atributo — a referência do delta (`ia − user`). `null`
 * = a amostra não mede viés da IA e fica FORA do cálculo.
 *
 * Fora de `adult_content` em obra mixed com versão conhecida, é o `ia_value_at_assessment` de sempre
 * (o snapshot da IA no momento da pós-leitura). Nesse caso, a referência tem de ser a da VERSÃO LIDA —
 * comparar a leitura da normal com a nota misturada (≥ 9 em 82 das 140 mixed) fabricaria um "a IA
 * superestima" que é só a diferença entre as versões:
 *   · `reused_existing` — a nota da versão É a nota legada da IA ⇒ o snapshot, como em toda obra;
 *   · `ai_evaluated`    — a IA avaliou ESTA versão ⇒ a nota dela;
 *   · `not_rated` / sem linha — não há valor de IA para a versão lida ⇒ fora (nunca o da outra versão);
 *   · `inferred_base` / `curator_confirmed` — não é avaliação de IA (baseline provisório; decisão
 *     humana) ⇒ fora: o viés mede o erro da IA, e é a mesma régua da aplicação, que só desloca nota de
 *     origem IA (`mapsFor` em `server/actions/calculations.ts`).
 * Versão desconhecida (`null`, o histórico) mantém a regra de antes.
 */
export function biasReferenceValue(
  row: Pick<AssessmentRow, "attribute_slug" | "ia_value_at_assessment">,
  ctx: BiasEditionContext | null,
): number | null {
  const snapshot = Number(row.ia_value_at_assessment)
  if (row.attribute_slug !== "adult_content" || !ctx?.isMixed || ctx.readEdition == null) return snapshot
  const ed = ctx.editionScore
  if (!ed || ed.score == null) return null
  if (ed.source === "reused_existing") return snapshot
  if (ed.source === "ai_evaluated") return Number(ed.score)
  return null
}

const LOTE = 200

/** O contexto de versão das obras com amostra de `adult_content` (só as mixed com versão conhecida importam). */
async function loadEditionContext(
  userId: string,
  workIds: string[],
  userDb: Pick<SupabaseClient, "from">,
  catalogDb: Pick<SupabaseClient, "from">,
): Promise<Map<string, BiasEditionContext>> {
  const out = new Map<string, BiasEditionContext>()
  const mixed: string[] = []
  for (let i = 0; i < workIds.length; i += LOTE) {
    const { data, error } = await catalogDb
      .from("work_edition_state")
      .select("work_id")
      .eq("state", "mixed")
      .in("work_id", workIds.slice(i, i + LOTE))
    if (error) throw new Error(`Falha lendo work_edition_state: ${error.message}`)
    for (const r of (data ?? []) as Array<{ work_id: string }>) mixed.push(r.work_id)
  }
  for (let i = 0; i < mixed.length; i += LOTE) {
    const lote = mixed.slice(i, i + LOTE)
    const [estado, notas] = await Promise.all([
      userDb.from("user_work_state").select("work_id, read_edition").eq("user_id", userId).in("work_id", lote),
      catalogDb
        .from("work_edition_scores")
        .select("work_id, edition, score, source")
        .eq("criterion_slug", "adult_content")
        .in("work_id", lote),
    ])
    if (estado.error) throw new Error(`Falha lendo user_work_state: ${estado.error.message}`)
    if (notas.error) throw new Error(`Falha lendo work_edition_scores: ${notas.error.message}`)
    const versao = new Map(
      ((estado.data ?? []) as Array<{ work_id: string; read_edition: unknown }>).map((r) => [r.work_id, parseMixedEdition(r.read_edition)]),
    )
    const nota = new Map(
      ((notas.data ?? []) as Array<{ work_id: string; edition: string; score: number | string | null; source: EditionScoreSource }>).map(
        (r) => [`${r.work_id}|${r.edition}`, { score: r.score == null ? null : Number(r.score), source: r.source }],
      ),
    )
    for (const workId of lote) {
      const readEdition = versao.get(workId) ?? null
      out.set(workId, {
        isMixed: true,
        readEdition,
        editionScore: readEdition ? (nota.get(`${workId}|${readEdition}`) ?? null) : null,
      })
    }
  }
  return out
}

/**
 * Lê todas as avaliações pós-leitura do usuário, recomputa o offset dos 9
 * atributos e faz UPSERT em attribute_bias. Retorna as 9 computações
 * (zeros pra atributos sem amostra).
 *
 * DOIS clientes: `supabase` é o de SESSÃO (os dados da pessoa, RLS); `catalogDb` é a service role
 * (estado e notas por versão são catálogo, sem policy — com o cliente de sessão viriam 0 linhas e a
 * correção de versão sumiria calada).
 *
 * ⚠️ Lê TODAS as amostras, paginado em ordem total. Até 2026-10-12 era um `select` cru: a conta
 * principal tem 1.721 amostras e o corte de 1.000 do PostgREST (sem ordem) deixava o viés calculado
 * sobre um recorte arbitrário — 111 amostras de `adult_content` contra 189 existentes.
 */
export async function recomputeAttributeBias(
  userId: string,
  supabase: SupabaseClient,
  catalogDb: Pick<SupabaseClient, "from">,
): Promise<BiasComputation[]> {
  const plano = await computeAttributeBias(userId, supabase, catalogDb)
  const { error: upsertError } = await supabase
    .from("attribute_bias")
    .upsert(attributeBiasRows(userId, plano.computations, new Date().toISOString()), { onConflict: "user_id,attribute_slug" })

  if (upsertError) throw new Error(`Falha gravando attribute_bias: ${upsertError.message}`)

  return plano.computations
}

/**
 * O CÁLCULO do offset, sem gravar — o mesmo que `recomputeAttributeBias` grava. Separado para o
 * ensaio do `scripts/recalcular-vies-da-dona.ts` mostrar o que mudaria sem tocar o banco.
 * `lidasPorSlug` conta as amostras LIDAS; `computations[].nSamples`, as que entraram no cálculo.
 */
export async function computeAttributeBias(
  userId: string,
  supabase: Pick<SupabaseClient, "from">,
  catalogDb: Pick<SupabaseClient, "from">,
): Promise<{ lidas: number; lidasPorSlug: Record<string, number>; computations: BiasComputation[] }> {
  const data = await fetchAllRows<AssessmentRow>(
    () =>
      supabase
        .from("user_attribute_assessment")
        .select("work_id, attribute_slug, user_value, ia_value_at_assessment")
        .eq("user_id", userId),
    { orderBy: ["user_id", "work_id", "attribute_slug"], label: "user_attribute_assessment" },
  )

  const adultWorkIds = [...new Set(data.filter((r) => r.attribute_slug === "adult_content").map((r) => r.work_id))]
  const edicao = await loadEditionContext(userId, adultWorkIds, supabase, catalogDb)

  const deltasBySlug = new Map<string, number[]>()
  for (const slug of CRITERION_SLUGS) deltasBySlug.set(slug, [])
  const lidasPorSlug: Record<string, number> = {}

  for (const row of data) {
    lidasPorSlug[row.attribute_slug] = (lidasPorSlug[row.attribute_slug] ?? 0) + 1
    const list = deltasBySlug.get(row.attribute_slug)
    if (!list) continue // ignora slugs fora dos 9 atributos
    const referencia = biasReferenceValue(row, edicao.get(row.work_id) ?? null)
    if (referencia == null) continue // sem valor de IA para a versão lida — nunca o da outra
    list.push(referencia - Number(row.user_value))
  }

  const computations: BiasComputation[] = CRITERION_SLUGS.map((slug) =>
    computeBiasForSlug(slug, deltasBySlug.get(slug) ?? []),
  )
  return { lidas: data.length, lidasPorSlug, computations }
}

/** As linhas de `attribute_bias` de um cálculo — o formato gravado (2 casas, como sempre foi). */
export function attributeBiasRows(userId: string, computations: BiasComputation[], now: string) {
  return computations.map((c) => ({
    user_id: userId,
    attribute_slug: c.attributeSlug,
    n_samples: c.nSamples,
    mean_bias_raw: Number(c.meanBiasRaw.toFixed(2)),
    bias_applied: Number(c.biasApplied.toFixed(2)),
    stddev_bias: c.stddev == null ? null : Number(c.stddev.toFixed(2)),
    last_updated_at: now,
  }))
}

/**
 * Mapa slug → bias_applied pro pipeline. Atributos sem linha viram 0.
 */
export async function getBiasMap(userId: string, supabase: SupabaseClient): Promise<AttributeBiasMap> {
  const { data, error } = await supabase
    .from("attribute_bias")
    .select("attribute_slug, bias_applied")
    .eq("user_id", userId)

  if (error) throw new Error(`Falha lendo attribute_bias: ${error.message}`)

  const map: AttributeBiasMap = {}
  for (const slug of CRITERION_SLUGS) map[slug] = 0
  for (const row of (data as Array<{ attribute_slug: string; bias_applied: number | string }> | null) ??
    []) {
    map[row.attribute_slug] = Number(row.bias_applied)
  }
  return map
}
