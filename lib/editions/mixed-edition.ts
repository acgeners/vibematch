/**
 * Obra `mixed` = UMA obra com DUAS edições (normal R15 e R18). Módulo PURO: qual edição está ativa,
 * qual nota de `adult_content` vale nela (migrations 213/214) e qual Nota Prevista/Chance vale nela.
 *
 * 🔴 A regra que tudo aqui protege: a nota de uma edição NUNCA vem da outra. Sem linha da edição — ou
 * com a linha em `not_rated` — o resultado é AUSÊNCIA, e quem exibe mostra "não avaliado para esta
 * edição". Cair na nota legada de `category_scores` seria mostrar a nota misturada (82 das 140 são da
 * R18) como se fosse da normal.
 *
 * Obra não-mixed (single, r18_only, unknown, sem estado) não tem edição: segue a nota legada, como
 * sempre.
 */

export const MIXED_EDITIONS = ["normal", "r18"] as const
export type MixedEdition = (typeof MIXED_EDITIONS)[number]

export function parseMixedEdition(value: unknown): MixedEdition | null {
  return value === "normal" || value === "r18" ? value : null
}

/** O estado espelhado em `works.edition_state` (mig 204). Só `mixed` tem duas edições. */
export function isMixedEditionState(state: unknown): boolean {
  return state === "mixed"
}

// ── Qual edição está ativa ──────────────────────────────────────────────────────────────────

export type EditionChoiceSource =
  | "hide_adult" //        a conta oculta 18+ ⇒ normal
  | "adult_filter_hide" // o filtro da lista pediu "esconder 18+" ⇒ normal
  | "adult_filter_only" // o filtro da lista pediu "só 18+" ⇒ R18
  | "url" //               ?edition= na página
  | "preference" //        user_settings.preferred_mixed_edition
  | "fallback" //          nada disso ⇒ normal

export interface EditionResolution {
  edition: MixedEdition
  source: EditionChoiceSource
  /**
   * A pessoa oculta 18+ e pediu a R18 na mão: a página mostra a R18 só depois de uma confirmação
   * explícita, e a preferência da conta NÃO muda.
   */
  requiresConfirmation: boolean
}

export interface EditionContext {
  /** `user_settings.hide_adult_content` de quem olha (anônimo: false). */
  hideAdult: boolean
  /** `?adult=` das listas (`hide` | `only`). */
  adultFilter?: "hide" | "only" | null
  /** `?edition=` da página da obra. */
  urlEdition?: MixedEdition | null
  /** `user_settings.preferred_mixed_edition` (anônimo: null). */
  preference?: MixedEdition | null
}

/**
 * Precedência (decisão de produto de 2026-10-10):
 *   1. ocultar 18+ (conta ou `?adult=hide`) ⇒ normal — a R18 só abre com `?edition=r18` E confirmação;
 *   2. `?adult=only` ⇒ R18;
 *   3. `?edition=` ⇒ a escolhida;
 *   4. preferência da conta;
 *   5. fallback ⇒ normal.
 */
export function resolveMixedEdition(ctx: EditionContext): EditionResolution {
  const url = ctx.urlEdition ?? null
  if (ctx.hideAdult || ctx.adultFilter === "hide") {
    if (url === "r18") return { edition: "r18", source: "url", requiresConfirmation: true }
    return { edition: "normal", source: ctx.hideAdult ? "hide_adult" : "adult_filter_hide", requiresConfirmation: false }
  }
  if (ctx.adultFilter === "only") return { edition: "r18", source: "adult_filter_only", requiresConfirmation: false }
  if (url) return { edition: url, source: "url", requiresConfirmation: false }
  if (ctx.preference) return { edition: ctx.preference, source: "preference", requiresConfirmation: false }
  return { edition: "normal", source: "fallback", requiresConfirmation: false }
}

/**
 * A edição PADRÃO de uma pessoa — a que o recálculo usa na Nota Prevista/Chance das obras `mixed`
 * (não há URL nem filtro em background). Mesma régua da página, sem os dois parâmetros.
 */
export function defaultMixedEdition(ctx: Pick<EditionContext, "hideAdult" | "preference">): MixedEdition {
  return resolveMixedEdition({ hideAdult: ctx.hideAdult, preference: ctx.preference ?? null }).edition
}

/**
 * O selo "18+" ao lado do título. Obra `mixed`: quem decide é a EDIÇÃO ATIVA — R18 sim, normal não.
 * O gate global (`is_adult`) não serve aqui: numa mixed ele é falso por construção (mig 204) e só um
 * `adult_override` o liga — e aí ligaria nas DUAS edições, afirmando "18+" sobre a versão normal.
 * Fora das mixed, o gate de sempre. Só o SELO: o portão de conteúdo (ocultar 18+) segue no gate.
 */
export function showsAdultBadge(input: { isMixed: boolean; activeEdition: MixedEdition | null; isAdult: boolean }): boolean {
  return input.isMixed ? input.activeEdition === "r18" : input.isAdult
}

// ── A nota da edição ────────────────────────────────────────────────────────────────────────

export const EDITION_SCORE_SOURCES = [
  "not_rated",
  "inferred_base",
  "reused_existing",
  "ai_evaluated",
  "curator_confirmed",
] as const
export type EditionScoreSource = (typeof EDITION_SCORE_SOURCES)[number]

/**
 * Força da procedência — a MESMA ordem de `work_edition_score_strength` (mig 213), que recusa
 * rebaixar. `inferred_base` (o baseline 5,0) é o mais fraco que ainda tem número.
 *
 * ⚠️ Não há fonte "derivada por regra": a existência da R18, e o piso de tag explícita sozinho, não
 * viram nota de edição (decisão de 2026-10-11).
 */
export const EDITION_SCORE_STRENGTH: Record<EditionScoreSource, number> = {
  not_rated: 0,
  inferred_base: 1,
  reused_existing: 2,
  ai_evaluated: 2,
  curator_confirmed: 3,
}

export interface EditionScoreRow {
  work_id: string
  edition: MixedEdition
  criterion_slug: string
  score: number | null
  source: EditionScoreSource
  status: "rated" | "provisional" | "not_rated"
  confidence: "alta" | "media" | "baixa" | null
  ai_evaluation_id?: string | null
  evidence?: Record<string, unknown> | null
}

export type AdultContentResolution =
  | { kind: "legacy"; score: number | null }
  | { kind: "edition"; edition: MixedEdition; score: number; row: EditionScoreRow }
  | { kind: "absent"; edition: MixedEdition; row: EditionScoreRow | null }

export interface AdultContentInput {
  isMixed: boolean
  /** A nota de `category_scores` (a única que obra não-mixed tem). */
  legacyScore: number | null | undefined
  /** As linhas de `work_edition_scores` da obra (qualquer edição/critério). */
  editionRows: ReadonlyArray<EditionScoreRow> | undefined
}

/** `adultContentFor(work, edition)` — nunca devolve a nota de outra edição. */
export function adultContentFor(input: AdultContentInput, edition: MixedEdition | null): AdultContentResolution {
  if (!input.isMixed) return { kind: "legacy", score: input.legacyScore ?? null }
  // Obra mixed sem edição escolhida é erro de quem chama: ausência, nunca a nota misturada.
  const ed: MixedEdition = edition ?? "normal"
  const row =
    input.editionRows?.find((r) => r.edition === ed && r.criterion_slug === "adult_content") ?? null
  if (!row || row.score == null || row.source === "not_rated") return { kind: "absent", edition: ed, row }
  return { kind: "edition", edition: ed, score: Number(row.score), row }
}

/**
 * O mapa de notas por critério VISTO numa edição: troca `adult_content` pela nota da edição, ou o
 * REMOVE quando ela não existe. Devolve o mesmo objeto quando não há o que trocar (obra não-mixed).
 */
export function scoresForEdition<T extends Record<string, number>>(scores: T, resolution: AdultContentResolution): T {
  if (resolution.kind === "legacy") return scores
  const next = { ...scores }
  if (resolution.kind === "edition") (next as Record<string, number>).adult_content = resolution.score
  else delete (next as Record<string, number>).adult_content
  return next
}

/** Agrupa linhas de `work_edition_scores` por obra. */
export function groupEditionRows(rows: ReadonlyArray<EditionScoreRow>): Map<string, EditionScoreRow[]> {
  const out = new Map<string, EditionScoreRow[]>()
  for (const r of rows) {
    const list = out.get(r.work_id)
    if (list) list.push(r)
    else out.set(r.work_id, [r])
  }
  return out
}

// ── Como a procedência aparece na tela ──────────────────────────────────────────────────────

export const EDITION_LABEL: Record<MixedEdition, string> = { normal: "Versão normal", r18: "Versão R18" }

/**
 * A frase de procedência da nota da edição. 🔴 O baseline tem de dizer que NÃO é avaliação — é o
 * que impede o 5,0 de ser lido como "a IA leu e deu 5".
 */
export function editionScoreProvenance(resolution: AdultContentResolution): { label: string; detail: string } | null {
  if (resolution.kind === "legacy") return null
  if (resolution.kind === "absent") {
    return {
      label: "Não avaliado para esta versão",
      detail:
        resolution.edition === "normal"
          ? "Ainda não há nota de conteúdo adulto da versão normal. A nota da versão R18 não vale aqui."
          : "Ainda não há nota de conteúdo adulto da versão R18. A nota da versão normal não vale aqui.",
    }
  }
  switch (resolution.row.source) {
    case "inferred_base":
      return {
        label: "Nota-base provisória (inferida)",
        detail:
          "Não é avaliação. Versão não adulta de uma obra com versão R18 sexual confirmada: presume-se conteúdo sexual atenuado/censurado, sem evidência suficiente de cenas explícitas nesta versão.",
      }
    case "curator_confirmed":
      return { label: "Confirmada pela curadoria", detail: "A curadoria confirmou a nota desta versão a partir das reviews existentes." }
    case "ai_evaluated":
      return { label: "Avaliada para esta versão", detail: "Avaliação de IA feita especificamente para esta versão." }
    case "reused_existing":
      return { label: "Da avaliação da obra", detail: "A nota da avaliação existente foi atribuída a esta versão pela auditoria de versões." }
    default:
      return null
  }
}

// ── A Nota Prevista/Chance da edição ────────────────────────────────────────────────────────

/**
 * Os campos da PREVISÃO que dependem da edição (o `adult_content` entra no Ridge e na Chance). Numa
 * obra `mixed`, `calculated_scores.expected_by_edition` guarda estes campos para as DUAS edições
 * (migration 213); as colunas de sempre guardam os da edição padrão de quem recebe a nota.
 */
export const EDITION_PREDICTION_FIELDS = [
  "expected_score",
  "expected_baseline",
  "expected_quality_adj",
  "expected_is_stub",
  "chance_score",
  "chance_is_stub",
] as const
export type EditionPredictionField = (typeof EDITION_PREDICTION_FIELDS)[number]
export interface EditionPrediction {
  expected_score: number | null
  expected_baseline: number | null
  expected_quality_adj: number | null
  expected_is_stub: boolean
  chance_score: number | null
  chance_is_stub: boolean
}
export type PredictionByEdition = Record<MixedEdition, EditionPrediction>

/** A previsão "não calculada para esta edição" — o mesmo formato de quem não tem modelo. */
export const ABSENT_EDITION_PREDICTION: EditionPrediction = {
  expected_score: null,
  expected_baseline: null,
  expected_quality_adj: null,
  expected_is_stub: true,
  chance_score: null,
  chance_is_stub: true,
}

/**
 * Os contratos de scoring cujo recálculo grava a previsão POR EDIÇÃO. Um checkout anterior à fase 2
 * grava `expected_*` sobre a nota MISTURADA e não toca `expected_edition`/`expected_by_edition` — a
 * linha dele não pode ser lida como previsão de edição nenhuma. Ao trocar `SCORING_CONTRACT`, o nome
 * novo entra aqui (o pin `contrato-canonico-pin.test.ts` cobra).
 */
export const EDITION_AWARE_SCORING_CONTRACTS: ReadonlySet<string> = new Set(["s9-fantasy-b-edicao-v1"])

export type PredictionView = "own" | "edition" | "absent"

/**
 * 🔴 A linha de `calculated_scores` VISTA numa edição — dono único da leitura da previsão das mixed.
 *
 * - Obra não-mixed: a linha passa intacta (`own`).
 * - Obra mixed: os campos de `EDITION_PREDICTION_FIELDS` viram os da edição pedida, lidos de
 *   `expected_by_edition` (`edition`). Sem a edição gravada, ou com a linha gravada por um contrato
 *   que não conhece edição, eles viram "não calculada" (`absent`) — NUNCA a previsão da outra edição
 *   nem a calculada sobre a nota misturada.
 *
 * Devolve a MESMA referência quando não há o que trocar.
 */
export function predictionForEdition<T>(
  row: T,
  isMixed: boolean,
  edition: MixedEdition | null,
): { row: T; view: PredictionView } {
  if (!isMixed || row == null) return { row, view: "own" }
  const r = row as unknown as Record<string, unknown>
  const ed: MixedEdition = edition ?? "normal"
  const contrato = typeof r.scoring_contract === "string" ? r.scoring_contract : null
  const porEdicao = r.expected_by_edition as Partial<PredictionByEdition> | null | undefined
  const daEdicao = contrato && EDITION_AWARE_SCORING_CONTRACTS.has(contrato) ? porEdicao?.[ed] : undefined
  const fields: EditionPrediction = daEdicao
    ? {
        expected_score: numOrNull(daEdicao.expected_score),
        expected_baseline: numOrNull(daEdicao.expected_baseline),
        expected_quality_adj: numOrNull(daEdicao.expected_quality_adj),
        expected_is_stub: daEdicao.expected_is_stub !== false,
        chance_score: numOrNull(daEdicao.chance_score),
        chance_is_stub: daEdicao.chance_is_stub !== false,
      }
    : ABSENT_EDITION_PREDICTION
  return { row: { ...(row as object), ...fields } as T, view: daEdicao ? "edition" : "absent" }
}

/**
 * 🔴 As casas das colunas de `calculated_scores`/`user_calculated_scores` (`numeric(p, casas)`, migs
 * 066/068/132/146). As colunas de sempre são arredondadas PELO BANCO ao gravar; a cópia por edição vai
 * num jsonb, que guarda o número cheio. Sem arredondar igual, a mesma previsão sai com casas diferentes
 * e a TELA diverge: medido em 2026-10-11, *I Tamed the Angsty Male Lead With My Fists* mostrava 7,8 na
 * home (coluna 7,75) e 7,7 na página (jsonb 7,7478). Mesma família da mig 146.
 */
export const EDITION_PREDICTION_SCALE = {
  expected_score: 2,
  expected_baseline: 3,
  expected_quality_adj: 3,
  chance_score: 2,
} as const

/**
 * Arredonda EXATAMENTE como uma coluna `numeric(p, casas)` arredonda o número que o supabase-js manda:
 * o texto de ida e volta do JS (`String(x)`, o mesmo do `JSON.stringify`), meio para LONGE do zero.
 * `Math.round(x * 10^casas)` não serve: 7,745 é 7,74499… em binário e daria 7,74; o banco grava 7,75.
 */
export function roundLikeNumericColumn(x: number, casas: number): number {
  if (!Number.isFinite(x)) return x
  const texto = String(x)
  // Notação exponencial só aparece fora de [1e-7, 1e21): nas escalas daqui, só o quase-zero.
  if (/e/i.test(texto)) return Math.abs(x) < 1 ? 0 : x
  const negativo = texto.startsWith("-")
  const [inteiro, fracao = ""] = (negativo ? texto.slice(1) : texto).split(".")
  if (fracao.length <= casas) return x
  let digitos = BigInt(inteiro + fracao.slice(0, casas))
  if (fracao.charCodeAt(casas) - 48 >= 5) digitos += BigInt(1)
  const txt = digitos.toString().padStart(casas + 1, "0")
  const valor = Number(`${txt.slice(0, txt.length - casas)}.${txt.slice(txt.length - casas)}`)
  return negativo && valor !== 0 ? -valor : valor
}

/** A previsão de uma edição como as colunas de sempre a gravariam. Dono único: o recálculo. */
export function asPersistedEditionPrediction(p: EditionPrediction): EditionPrediction {
  const r = (v: number | null, casas: number) => (v == null ? null : roundLikeNumericColumn(v, casas))
  return {
    ...p,
    expected_score: r(p.expected_score, EDITION_PREDICTION_SCALE.expected_score),
    expected_baseline: r(p.expected_baseline, EDITION_PREDICTION_SCALE.expected_baseline),
    expected_quality_adj: r(p.expected_quality_adj, EDITION_PREDICTION_SCALE.expected_quality_adj),
    chance_score: r(p.chance_score, EDITION_PREDICTION_SCALE.chance_score),
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
