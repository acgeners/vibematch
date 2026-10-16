import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows } from "@/lib/supabase/paginate"
import {
  OWNED_STRUCTURAL_RULES,
  decisionWrites,
  planStructuralInference,
} from "@/lib/editions/structural-inference"
import type {
  CurrentEditionRow,
  EditionDecision,
  StructuralFacts,
  StructuralPlan,
  StructuralTagFacts,
} from "@/lib/editions/structural-inference"
import type { EditionScoreSource, MixedEdition } from "@/lib/editions/mixed-edition"

/**
 * Executor da inferência ESTRUTURAL por versão (a política é `lib/editions/structural-inference.ts`):
 * carrega os fatos das obras, pede o plano e — só quando pedido — grava.
 *
 * ── Quando roda ──────────────────────────────────────────────────────────────────────────────
 * 1. No RECÁLCULO global (`recalculateAll`), antes de ler as notas por versão: é o ponto causal por
 *    onde passam todas as mudanças que movem os sinais (tags são entrada do recálculo; o estado
 *    mixed gravado pelo MangaUpdates marca recálculo). As linhas inferidas e a Nota Prevista mudam
 *    JUNTAS, na mesma execução — e a guarda de código canônico já protege a escrita.
 * 2. Na CURADORIA de versões ("Versões da obra…"), logo depois de gravar: lá a pessoa vê as linhas na
 *    hora, e trocar extras/estado precisa retirar a inferência que deixou de valer.
 * 3. No script `scripts/reconciliar-inferencia-estrutural.ts` (ensaio por padrão), para o legado.
 *
 * 🔴 `STRUCTURAL_INFERENCE_AUTO_APPLY` desliga as gravações AUTOMÁTICAS (1 e 2). Ligado, o primeiro
 * recálculo em produção SERIA a aplicação do legado (≈119 bases e ≈48 pisos) sem revisão nem a
 * escolha de separar em etapas. O legado vai pelo script; depois, liga-se aqui (um PR de uma linha).
 *
 * ── Como grava sem furar a guarda da migration 213 ────────────────────────────────────────────
 * - preencher (sem linha / "não avaliado" automático → inferida) e trocar 5,0 → 6,0 são SUBIDA ou mesma
 *   força: o gatilho aceita o UPDATE.
 * - retirar uma inferência própria é DELETE com o filtro NO BANCO (`source = inferred_base` E
 *   `evidence->>regra` = a regra dela). O gatilho não olha DELETE, mas o filtro garante que nenhuma
 *   linha mais forte — nem uma que mudou no meio — pode ser apagada. Depois, a linha que existia ANTES
 *   da inferência (guardada em `evidence.anterior`) é reinserida. Nada passa por
 *   `app.permitir_rebaixar_edicao`.
 */

/** 🔴 Interruptor das gravações AUTOMÁTICAS (recálculo e curadoria). Ver o cabeçalho. */
export const STRUCTURAL_INFERENCE_AUTO_APPLY = false

type Db = Pick<SupabaseClient, "from">

const LOTE = 100
const CRITERIO = "adult_content"

const STATE_SELECT =
  "work_id, state, r18_extra_chapters, " +
  "normal_lines:evidence->mangaupdates->normal_lines, linhas_normal:evidence->mangaupdates->linhas_normal, " +
  "genres:evidence->mangaupdates->genres, generos_adultos:evidence->mangaupdates->generos_adultos"
const SCORE_SELECT = "work_id, edition, criterion_slug, score, source, decided_by, regra:evidence->>regra"
const ADULT_TAG_FILTER = "adult_score_tier.not.is.null,adult_indicator.eq.true,adult_indicator_strong.eq.true"

interface StateRow {
  work_id: string
  state: string | null
  r18_extra_chapters: boolean | null
  normal_lines: unknown
  linhas_normal: unknown
  genres: unknown
  generos_adultos: unknown
}

interface ScoreRow {
  work_id: string
  edition: MixedEdition
  criterion_slug: string
  score: number | string | null
  source: EditionScoreSource
  decided_by: string | null
  regra: string | null
}

type Embed<T> = T | T[] | null | undefined
interface TagLinkRow {
  work_id: string
  tag_id: string
  /** Procedência do vínculo — a política decide quais confirmam (`TAG_SOURCES_THAT_CONFIRM`). */
  source?: string | null
  tags: Embed<{
    name: string
    adult_score_tier: string | null
    adult_indicator: boolean | null
    adult_indicator_strong: boolean | null
    tag_subgroup: Embed<{ slug: string | null }>
  }>
}

/** O PostgREST devolve embed to-one como OBJETO; o tipo do client diz array. Aceita os dois. */
function um<T>(v: Embed<T>): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
}

function lotes<T>(xs: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += LOTE) out.push(xs.slice(i, i + LOTE))
  return out
}

export interface WorkStructuralFacts {
  workId: string
  facts: StructuralFacts
}

/**
 * Os fatos da política, para as obras pedidas — ou, sem `workIds`, para TODAS as mixed mais as que
 * guardam inferência própria sem serem mixed (para poder retirá-la).
 */
export async function loadStructuralFacts(sb: Db, scope: { workIds?: string[] } = {}): Promise<WorkStructuralFacts[]> {
  const estados = new Map<string, StateRow>()
  let ids: string[]
  if (scope.workIds) {
    ids = [...new Set(scope.workIds)]
    for (const s of await statesFor(sb, ids)) estados.set(s.work_id, s)
  } else {
    const mixed = await fetchAllRows<StateRow>(
      () => sb.from("work_edition_state").select(STATE_SELECT).eq("state", "mixed"),
      { orderBy: ["work_id"], label: "inferencia-estrutural.estados" },
    )
    for (const s of mixed) estados.set(s.work_id, s)
    const comInferencia = await fetchAllRows<{ work_id: string }>(
      () =>
        sb.from("work_edition_scores").select("work_id").eq("source", "inferred_base").in("evidence->>regra", [...OWNED_STRUCTURAL_RULES]),
      { orderBy: ["work_id", "edition", "criterion_slug"], label: "inferencia-estrutural.proprias" },
    )
    const fora = [...new Set(comInferencia.map((r) => r.work_id))].filter((id) => !estados.has(id))
    for (const s of await statesFor(sb, fora)) estados.set(s.work_id, s)
    ids = [...new Set([...estados.keys(), ...fora])]
  }
  if (ids.length === 0) return []

  const notas = new Map<string, Partial<Record<MixedEdition, CurrentEditionRow>>>()
  const tags = new Map<string, StructuralTagFacts[]>()
  const ratings = new Map<string, { at: string; rating: string }>()
  for (const lote of lotes(ids)) {
    const { data, error } = await sb.from("work_edition_scores").select(SCORE_SELECT).in("work_id", lote).eq("criterion_slug", CRITERIO)
    if (error) throw new Error(`inferencia-estrutural.notas: ${error.message}`)
    for (const r of (data ?? []) as ScoreRow[]) {
      const porEdicao = notas.get(r.work_id) ?? {}
      porEdicao[r.edition] = {
        source: r.source,
        score: r.score == null ? null : Number(r.score),
        decidedBy: r.decided_by,
        rule: r.regra ?? null,
      }
      notas.set(r.work_id, porEdicao)
    }

    const vinculos = await fetchAllRows<TagLinkRow>(
      () =>
        sb
          .from("work_tags")
          .select("work_id, tag_id, source, tags!inner(name, adult_score_tier, adult_indicator, adult_indicator_strong, tag_subgroup(slug))")
          .in("work_id", lote)
          .or(ADULT_TAG_FILTER, { referencedTable: "tags" }),
      { orderBy: ["work_id", "tag_id"], label: "inferencia-estrutural.tags" },
    )
    for (const v of vinculos) {
      const t = um(v.tags)
      if (!t) continue
      const lista = tags.get(v.work_id) ?? []
      lista.push({
        name: t.name,
        tier: t.adult_score_tier,
        adultIndicator: t.adult_indicator === true,
        adultIndicatorStrong: t.adult_indicator_strong === true,
        subgroup: um(t.tag_subgroup)?.slug ?? null,
        source: v.source,
      })
      tags.set(v.work_id, lista)
    }

    // A classificação da FONTE (MangaDex/ComicK) só fica gravada na avaliação: vale a mais recente que a
    // registrou. Não é a nota da IA — é o rótulo que a fonte deu à série.
    const avaliacoes = await fetchAllRows<{ id: string; work_id: string; created_at: string; ext: string | null }>(
      () =>
        sb
          .from("ai_evaluations")
          .select("id, work_id, created_at, ext:raw_response->>externalContentRating")
          .in("work_id", lote)
          .eq("status", "completed"),
      { orderBy: ["id"], label: "inferencia-estrutural.classificacao-externa" },
    )
    for (const a of avaliacoes) {
      if (!a.ext) continue
      const atual = ratings.get(a.work_id)
      if (!atual || a.created_at > atual.at) ratings.set(a.work_id, { at: a.created_at, rating: a.ext })
    }
  }

  return ids.map((workId) => {
    const s = estados.get(workId)
    return {
      workId,
      facts: {
        isMixed: s?.state === "mixed",
        r18ExtraChapters: s?.r18_extra_chapters === true,
        // Dois formatos de evidência: o da auditoria (mig 205/214) e o do save pelo MangaUpdates.
        standardLines: [...strings(s?.linhas_normal), ...strings(s?.normal_lines)],
        muGenres: [...strings(s?.generos_adultos), ...strings(s?.genres)],
        tags: tags.get(workId) ?? [],
        externalRatings: ratings.has(workId) ? [ratings.get(workId)!.rating] : [],
        current: notas.get(workId) ?? {},
      },
    }
  })
}

async function statesFor(sb: Db, ids: string[]): Promise<StateRow[]> {
  const out: StateRow[] = []
  for (const lote of lotes(ids)) {
    const { data, error } = await sb.from("work_edition_state").select(STATE_SELECT).in("work_id", lote)
    if (error) throw new Error(`inferencia-estrutural.estados: ${error.message}`)
    out.push(...((data ?? []) as unknown as StateRow[]))
  }
  return out
}

// ── Gravação ────────────────────────────────────────────────────────────────────────────────

export type ApplyOutcome =
  | { edition: MixedEdition; action: "inserida" | "atualizada" | "retirada" }
  | { edition: MixedEdition; action: "pulada"; detail: string }
  | { edition: MixedEdition; action: "erro"; detail: string }

interface RowSnapshot {
  score: number | null
  source: EditionScoreSource
  status: string
  confidence: string | null
  decided_by: string
  ai_evaluation_id: string | null
  evidence: Record<string, unknown> | null
}

const SNAPSHOT_SELECT = "score, source, status, confidence, decided_by, ai_evaluation_id, evidence"

/** Grava as decisões que escrevem. Uma por versão; cada uma confere o estado NO BANCO antes de mexer. */
export async function applyStructuralPlan(
  sb: Db,
  workId: string,
  plan: StructuralPlan,
  opts: { nowIso: string; editions?: MixedEdition[] },
): Promise<ApplyOutcome[]> {
  const out: ApplyOutcome[] = []
  for (const edition of ["normal", "r18"] as MixedEdition[]) {
    if (opts.editions && !opts.editions.includes(edition)) continue
    const d = plan.decisions[edition]
    if (!decisionWrites(d)) continue
    try {
      if (d.kind === "infer") out.push(await gravarInferencia(sb, workId, edition, d, plan, opts.nowIso))
      else if (d.kind === "retract") out.push(await retirar(sb, workId, edition, d))
    } catch (err) {
      out.push({ edition, action: "erro", detail: err instanceof Error ? err.message : String(err) })
    }
  }
  return out
}

async function gravarInferencia(
  sb: Db,
  workId: string,
  edition: MixedEdition,
  d: Extract<EditionDecision, { kind: "infer" }>,
  plan: StructuralPlan,
  nowIso: string,
): Promise<ApplyOutcome> {
  const evidencia = (anterior: unknown) => ({
    regra: d.target.rule,
    origem: "inferencia_estrutural",
    decidido_em: nowIso,
    sinais: plan.sexualSignals,
    rotulo_padrao: plan.standardLabel,
    anterior,
  })
  const linha = (anterior: unknown) => ({
    score: d.target.score,
    source: "inferred_base" as const,
    status: "provisional",
    confidence: "baixa",
    decided_by: "audit",
    ai_evaluation_id: null,
    evidence: evidencia(anterior),
  })

  if (!d.over) {
    const { error } = await sb.from("work_edition_scores").insert({ work_id: workId, edition, criterion_slug: CRITERIO, ...linha(null) })
    if (!error) return { edition, action: "inserida" }
    // 23505: uma linha apareceu entre a leitura e a escrita — a próxima passada decide sobre ela.
    if ((error as { code?: string }).code === "23505") return { edition, action: "pulada", detail: "a linha apareceu no meio" }
    throw new Error(error.message)
  }

  const prev = await sb
    .from("work_edition_scores")
    .select(SNAPSHOT_SELECT)
    .eq("work_id", workId)
    .eq("edition", edition)
    .eq("criterion_slug", CRITERIO)
    .maybeSingle()
  if (prev.error) throw new Error(prev.error.message)
  const antes = prev.data as RowSnapshot | null
  if (!antes || antes.source !== d.over.source) return { edition, action: "pulada", detail: "a linha mudou no meio" }
  // Sobre inferência PRÓPRIA, o "antes" que vale é o que ela já guardava (o estado anterior a ela).
  const propria = d.over.rule != null && (OWNED_STRUCTURAL_RULES as readonly string[]).includes(d.over.rule)
  const anterior = propria ? ((antes.evidence ?? {}) as { anterior?: unknown }).anterior ?? null : antes

  let q = sb.from("work_edition_scores").update(linha(anterior)).eq("work_id", workId).eq("edition", edition).eq("criterion_slug", CRITERIO).eq("source", d.over.source)
  q = d.over.source === "not_rated" ? q.neq("decided_by", "curator") : q.eq("evidence->>regra", d.over.rule ?? "")
  const { data, error } = await q.select("work_id")
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return { edition, action: "pulada", detail: "a linha mudou no meio" }
  return { edition, action: "atualizada" }
}

async function retirar(sb: Db, workId: string, edition: MixedEdition, d: Extract<EditionDecision, { kind: "retract" }>): Promise<ApplyOutcome> {
  const { data, error } = await sb
    .from("work_edition_scores")
    .delete()
    .eq("work_id", workId)
    .eq("edition", edition)
    .eq("criterion_slug", CRITERIO)
    .eq("source", "inferred_base")
    .eq("evidence->>regra", d.current.rule ?? "")
    .select("evidence")
  if (error) throw new Error(error.message)
  const apagada = ((data ?? []) as Array<{ evidence: Record<string, unknown> | null }>)[0]
  if (!apagada) return { edition, action: "pulada", detail: "a linha mudou no meio" }

  // Devolve o que existia ANTES da inferência ("não avaliado" da auditoria, ou a base legada). Sem
  // anterior, a versão fica sem linha — o mesmo "não avaliado" de uma mixed nova.
  const anterior = (apagada.evidence ?? {}).anterior as RowSnapshot | null | undefined
  if (anterior && (anterior.source === "not_rated" || anterior.source === "inferred_base")) {
    const { error: e } = await sb.from("work_edition_scores").insert({
      work_id: workId,
      edition,
      criterion_slug: CRITERIO,
      score: anterior.score,
      source: anterior.source,
      status: anterior.status,
      confidence: anterior.confidence,
      decided_by: anterior.decided_by,
      ai_evaluation_id: anterior.ai_evaluation_id,
      evidence: anterior.evidence ?? {},
    })
    if (e) return { edition, action: "pulada", detail: `inferência retirada; a linha anterior não voltou (${e.message}) — a versão fica sem registro` }
  }
  return { edition, action: "retirada" }
}

// ── Reconciliação ───────────────────────────────────────────────────────────────────────────

export interface StructuralReconcileWork {
  workId: string
  facts: StructuralFacts
  plan: StructuralPlan
  outcomes: ApplyOutcome[]
}

export interface StructuralReconcileReport {
  works: StructuralReconcileWork[]
  /** Obras com alguma linha de fato gravada. */
  changedWorkIds: string[]
  errors: string[]
}

export async function reconcileStructuralInference(
  sb: Db,
  opts: { workIds?: string[]; apply: boolean; editions?: MixedEdition[]; nowIso?: string },
): Promise<StructuralReconcileReport> {
  const nowIso = opts.nowIso ?? new Date().toISOString()
  const entradas = await loadStructuralFacts(sb, { workIds: opts.workIds })
  const works: StructuralReconcileWork[] = []
  const changed = new Set<string>()
  const errors: string[] = []
  for (const { workId, facts } of entradas) {
    const plan = planStructuralInference(facts)
    const outcomes = opts.apply ? await applyStructuralPlan(sb, workId, plan, { nowIso, editions: opts.editions }) : []
    for (const o of outcomes) {
      if (o.action === "inserida" || o.action === "atualizada" || o.action === "retirada") changed.add(workId)
      if (o.action === "erro") errors.push(`${workId}/${o.edition}: ${o.detail}`)
    }
    works.push({ workId, facts, plan, outcomes })
  }
  return { works, changedWorkIds: [...changed], errors }
}

/** O que a reconciliação do recálculo fez — vai no resultado do recálculo e decide se a pendência fica. */
export type RecalcInferenceStatus =
  | { status: "desligada" }
  | { status: "ok"; obras: number; gravadas: number }
  /** Parte gravou, parte falhou (por linha): o que gravou fica; o resto volta na próxima passada. */
  | { status: "com_erros"; obras: number; gravadas: number; erros: string[] }
  /** Nem chegou a planejar (falha ao ler os fatos): nada foi gravado. */
  | { status: "falhou"; erro: string }

/**
 * A reconciliação ficou devendo trabalho? Então o recálculo NÃO pode limpar a pendência — senão a
 * falha sairia como sucesso e só seria refeita na próxima mudança qualquer do catálogo.
 */
export function inferenceNeedsRetry(s: RecalcInferenceStatus): boolean {
  return s.status === "com_erros" || s.status === "falhou"
}

/**
 * Os campos de pendência que o recálculo grava ao terminar. Com trabalho devido, a pendência FICA e
 * `recalc_last_edit_at` vira agora: o disparo automático espera a janela de 1h de novo — sem isso, um
 * defeito persistente viraria um recálculo inteiro a cada carga de página.
 */
export function recalcPendingAfter(s: RecalcInferenceStatus, nowIso: string): { recalc_pending: boolean; recalc_last_edit_at: string | null } {
  return inferenceNeedsRetry(s) ? { recalc_pending: true, recalc_last_edit_at: nowIso } : { recalc_pending: false, recalc_last_edit_at: null }
}

/**
 * Gancho do RECÁLCULO global. NÃO lança, de propósito: um defeito persistente aqui travaria a Nota
 * Prevista do catálogo inteiro, e esta etapa é auxiliar. Mas também não cala: o status volta para o
 * recálculo, que mantém a pendência (`inferenceNeedsRetry`) e o devolve no resultado; o log grita.
 * Reprocessar é idempotente — a passada seguinte só refaz o que faltou.
 */
export async function reconcileStructuralInferenceForRecalc(
  sb: Db,
  // Só os testes passam este parâmetro: em produção vale o interruptor.
  opts: { autoApply?: boolean } = {},
): Promise<RecalcInferenceStatus> {
  if (!(opts.autoApply ?? STRUCTURAL_INFERENCE_AUTO_APPLY)) {
    console.info("[edition-inference] gravação automática DESLIGADA (STRUCTURAL_INFERENCE_AUTO_APPLY) — recálculo segue sem reconciliar")
    return { status: "desligada" }
  }
  try {
    const r = await reconcileStructuralInference(sb, { apply: true })
    console.info(`[edition-inference] recálculo: ${r.works.length} obras olhadas · ${r.changedWorkIds.length} com gravação · ${r.errors.length} erros`)
    for (const e of r.errors) console.error(`[edition-inference] ${e}`)
    const base = { obras: r.works.length, gravadas: r.changedWorkIds.length }
    return r.errors.length > 0 ? { status: "com_erros", ...base, erros: r.errors } : { status: "ok", ...base }
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err)
    console.error("[edition-inference] reconciliação no recálculo FALHOU (o recálculo segue; a pendência fica):", erro)
    return { status: "falhou", erro }
  }
}

/**
 * Gancho da CURADORIA de versões: reconcilia a obra que acabou de mudar. `changed` = gravou algo;
 * `failed` = ficou devendo (erro numa linha ou ao ler). Nos dois casos a curadoria marca o recálculo —
 * no segundo, é a varredura dele que refaz o que faltou (a falha não fica só no log).
 */
export async function reconcileStructuralInferenceForWork(
  sb: Db,
  workId: string,
  // Só os testes passam este parâmetro: em produção vale o interruptor.
  opts: { autoApply?: boolean } = {},
): Promise<{ changed: boolean; failed: boolean }> {
  if (!(opts.autoApply ?? STRUCTURAL_INFERENCE_AUTO_APPLY)) return { changed: false, failed: false }
  try {
    const r = await reconcileStructuralInference(sb, { workIds: [workId], apply: true })
    for (const e of r.errors) console.error(`[edition-inference] ${e}`)
    return { changed: r.changedWorkIds.length > 0, failed: r.errors.length > 0 }
  } catch (err) {
    console.error(`[edition-inference] reconciliação da obra ${workId} FALHOU:`, err instanceof Error ? err.message : err)
    return { changed: false, failed: true }
  }
}
