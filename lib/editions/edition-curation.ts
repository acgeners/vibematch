/**
 * Curadoria de EDIÇÕES de uma obra — módulo PURO: decide o que gravar, a action só executa.
 *
 * Até aqui o estado de edição (`work_edition_state`, mig 204) só nascia da auditoria (mig 205) ou do
 * vínculo com o MangaUpdates no save; e a nota por edição (`work_edition_scores`, mig 213) só da mig
 * 214. Uma obra nova que a curadoria sabe ter normal + R18 não tinha caminho — e o "Marcar como 18+"
 * (o `adult_override`) era usado no lugar, escondendo a obra INTEIRA. Este módulo é o caminho certo:
 *
 *   · o ESTADO é decisão da curadoria (`basis = decided_by = 'curator'`); os gatilhos da 204 derivam
 *     o espelho em `works`, a tag "R19 disponível" e o gate. O `adult_override` NÃO é tocado.
 *   · numa obra `mixed`, o curador INFORMA a nota de conteúdo adulto de cada edição (ou "não
 *     avaliado"). Sem regra automática: nada é copiado de uma edição para a outra, nada é média.
 */
import { z } from "zod"
import { adultContentFor, editionScoreProvenance, isMixedEditionState } from "@/lib/editions/mixed-edition"
import type { EditionScoreSource, MixedEdition } from "@/lib/editions/mixed-edition"

export const CURATED_EDITION_STATES = ["single", "mixed", "r18_only", "unknown"] as const
export type CuratedEditionState = (typeof CURATED_EDITION_STATES)[number]

export const EDITION_STATE_LABEL: Record<CuratedEditionState, string> = {
  single: "Uma versão só",
  mixed: "Versão normal + versão R18",
  r18_only: "Só versão R18",
  unknown: "Indefinido (há sinal de R18, sem versão normal provada)",
}

/**
 * O que cada estado faz no PORTÃO de conteúdo 18+ (`works.is_adult`, mig 204) — impresso no diálogo,
 * porque a escolha do estado É a escolha do portão. Vale enquanto não houver "Marcar como 18+"
 * (`adult_override`), que vence os quatro.
 */
export const EDITION_STATE_EFFECT: Record<CuratedEditionState, string> = {
  single: "O 18+ segue a classificação automática da obra (tags e nota de conteúdo adulto).",
  mixed:
    "Quem oculta 18+ vê a versão normal; a R18 fica atrás da confirmação. Cada versão usa a própria nota de conteúdo adulto na Nota Prevista.",
  r18_only: "A obra inteira é 18+.",
  unknown: "A obra fica 18+ até haver prova de uma versão normal.",
}

/** Aviso quando o "Marcar como 18+" está ligado: ele vence o estado no portão. */
export function adultOverrideWarning(adultOverride: boolean | null): string | null {
  if (adultOverride === null) return null
  return adultOverride
    ? "Esta obra está marcada como 18+ à mão, e isso vence o estado das versões: ela fica oculta inteira para quem esconde 18+. Para uma obra com versão normal e R18, use “18+: voltar ao automático” no menu."
    : "Esta obra está marcada como não-18+ à mão, e isso vence o estado das versões: ela aparece inteira para quem esconde 18+, inclusive se for só R18."
}

/** Nota com vírgula, uma casa (a grade é de 0,5). */
export function formatEditionScore(score: number): string {
  return score.toFixed(1).replace(".", ",")
}

/** Aceita "7,5" e "7.5"; devolve null fora de 0–10 ou fora da grade de 0,5. */
export function parseEditionScore(text: string): number | null {
  const t = text.trim().replace(",", ".")
  if (!/^\d{1,2}(\.\d+)?$/.test(t)) return null
  const v = Number(t)
  if (!Number.isFinite(v) || v < 0 || v > 10 || !Number.isInteger(v * 2)) return null
  return v
}

const SCORE_DECIDED_BY_LABEL: Record<"audit" | "curator" | "ai", string> = {
  audit: "pela auditoria",
  curator: "pela curadoria",
  ai: "pela IA",
}

/**
 * A nota atual de uma edição, como a página da obra a descreve (mesma procedência). Para quem CURA,
 * "sem linha" e `not_rated` explícito são coisas diferentes — o leitor vê os dois como "não
 * avaliado", mas aqui a tela diz qual dos dois é, e quem registrou.
 */
export function describeCurrentEditionScore(edition: MixedEdition, cur: CurrentEditionScore | undefined): string {
  if (!cur) return "Sem registro (não avaliado)"
  if (cur.score == null || cur.source === "not_rated") {
    const quem = cur.decidedBy ? SCORE_DECIDED_BY_LABEL[cur.decidedBy] : null
    return quem ? `Não avaliado · registrado ${quem}` : "Não avaliado (registrado)"
  }
  const prov = editionScoreProvenance({
    kind: "edition",
    edition,
    score: cur.score,
    row: { work_id: "", edition, criterion_slug: "adult_content", score: cur.score, source: cur.source, status: "rated", confidence: null },
  })
  return `${formatEditionScore(cur.score)} · ${prov?.label ?? cur.source}`
}

const notaDeEdicao = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manter") }),
  z.object({
    kind: z.literal("nota"),
    // Mesma grade das notas de critério: 0 a 10, de meio em meio ponto.
    value: z.number().min(0).max(10).refine((v) => Number.isInteger(v * 2), "A nota anda de 0,5 em 0,5."),
  }),
  z.object({ kind: z.literal("nao_avaliado") }),
])
export type EditionScoreInput = z.infer<typeof notaDeEdicao>

export const editionCurationSchema = z.object({
  state: z.enum(CURATED_EDITION_STATES),
  r18ExtraChapters: z.boolean(),
  scores: z.object({ normal: notaDeEdicao, r18: notaDeEdicao }),
})
export type EditionCurationInput = z.infer<typeof editionCurationSchema>

export interface CurrentEditionScore {
  score: number | null
  source: EditionScoreSource
  /** A evidência da linha atual (ex.: a justificativa da mig 214) — guardada em `anterior` ao trocar. */
  evidence?: Record<string, unknown> | null
  decidedBy?: "audit" | "curator" | "ai" | null
}
export type EditionDecidedBy = "audit" | "curator" | "legacy" | "auto"
const EDITION_BASES = [
  "mangaupdates_description",
  "mangaupdates_category",
  "reviews",
  "synopsis_text",
  "synopsis_marker",
  "edition_tag",
  "legacy_r19_edition",
  "curator",
] as const
export type EditionBasis = (typeof EDITION_BASES)[number]

export interface CurrentEditionCuration {
  state: CuratedEditionState | null
  r18ExtraChapters: boolean
  evidence: Record<string, unknown> | null
  scores: Partial<Record<MixedEdition, CurrentEditionScore>>
  decidedBy?: EditionDecidedBy | null
  basis?: string | null
  decidedAt?: string | null
}

/**
 * O estado que existia ANTES da 1ª decisão da curadoria — gravado em `evidence.antes_da_curadoria`
 * quando a curadoria decide pela primeira vez, e mantido nas decisões seguintes. É dele que "Remover
 * decisão da curadoria" volta. `null` = não havia estado nenhum (a obra era tratada como edição única).
 * Chave AUSENTE (decisão de curadoria sem esse registro) é outra coisa: não se sabe para onde voltar.
 */
export interface EstadoAntesDaCuradoria {
  state: CuratedEditionState
  r18_extra_chapters: boolean
  basis: EditionBasis
  decided_by: Exclude<EditionDecidedBy, "curator">
  decided_at: string | null
}
const ANTES = "antes_da_curadoria"

/**
 * O que o recálculo lê do ESTADO de edição é só isto: se a obra é `mixed` (`isMixedEditionState`,
 * em `server/actions/calculations.ts`). `single`, `r18_only`, `unknown` e "sem estado" dão a mesma
 * previsão. (A tag "R19 disponível", que também entra nas features, muda junto: o gatilho da 204 a
 * mantém presente se e só se a obra é mixed.) Mesma função do recálculo — nunca uma régua paralela.
 */
function usaNotaPorEdicao(state: CuratedEditionState | null): boolean {
  return isMixedEditionState(state)
}

/**
 * A nota de conteúdo adulto que a PREVISÃO usa numa edição — pela mesma `adultContentFor` do
 * recálculo. `null` = a edição entra sem nota (sem linha, `not_rated`). Trocar a origem sem trocar
 * o número (5,0 provisório → 5,0 da curadoria) não muda nada aqui.
 */
function notaNaPrevisao(edition: MixedEdition, score: number | null, source: EditionScoreSource | null): number | null {
  if (source == null) return null
  const r = adultContentFor(
    {
      isMixed: true,
      legacyScore: null,
      editionRows: [{ work_id: "", edition, criterion_slug: "adult_content", score, source, status: "rated", confidence: null }],
    },
    edition,
  )
  return r.kind === "edition" ? r.score : null
}

/** Linha de `work_edition_scores` como a curadoria grava (só `adult_content` nesta fase). */
export interface CuratedScoreRow {
  edition: MixedEdition
  criterion_slug: "adult_content"
  score: number | null
  source: "curator_confirmed" | "not_rated"
  status: "rated" | "not_rated"
  confidence: null
  ai_evaluation_id: null
  decided_by: "curator"
  evidence: Record<string, unknown>
}

export type ScoreOp =
  | { edition: MixedEdition; op: "upsert"; row: CuratedScoreRow; marksRecalc: boolean }
  /** "Não avaliado" sobre uma nota existente. O gatilho da 213 recusa REBAIXAR num UPDATE (e no
   *  upsert), e não há como abrir a exceção pelo PostgREST: a action apaga e insere — e, se a inserção
   *  falhar, devolve a linha apagada (ver `server/actions/work-editions.ts`). */
  | { edition: MixedEdition; op: "replace"; row: CuratedScoreRow; marksRecalc: boolean }

export interface EditionCurationPlan {
  /** Linha de `work_edition_state` a gravar (upsert), ou null se o estado não mudou. */
  state: {
    state: CuratedEditionState
    r18_extra_chapters: boolean
    basis: "curator"
    decided_by: "curator"
    decided_at: string
    evidence: Record<string, unknown>
  } | null
  scoreOps: ScoreOp[]
  /**
   * A obra entra ou sai de `mixed` ⇒ marcar o recálculo. Trocar entre `single`, `r18_only`,
   * `unknown` e "sem estado" não muda a previsão e não marca. Cada nota diz o seu (`marksRecalc`),
   * e a action só conta a que foi de fato GRAVADA.
   */
  stateMarksRecalc: boolean
  /** Estado ou nota mudam no plano (usado para dizer na tela se haverá recálculo). */
  affectsPrediction: boolean
}

const MIXED_EDITIONS_ORDER: MixedEdition[] = ["normal", "r18"]

export function planEditionCuration(
  current: CurrentEditionCuration,
  input: EditionCurationInput,
  nowIso: string,
): EditionCurationPlan {
  const isMixed = input.state === "mixed"
  const extras = isMixed && input.r18ExtraChapters
  const stateChanged = current.state !== input.state || current.r18ExtraChapters !== extras

  const state = stateChanged
    ? {
        state: input.state,
        r18_extra_chapters: extras,
        basis: "curator" as const,
        decided_by: "curator" as const,
        decided_at: nowIso,
        // A evidência anterior (auditoria, MangaUpdates) fica; a decisão da curadoria entra por cima.
        evidence: {
          ...(current.evidence ?? {}),
          ...snapshotAntesDaCuradoria(current),
          curadoria: { decidido_em: nowIso, estado_anterior: current.state, extras_r19: extras },
        },
      }
    : null

  // Nota por edição só existe em obra mixed (o gatilho da 213 recusa o resto).
  const scoreOps: ScoreOp[] = []
  if (isMixed) {
    for (const edition of MIXED_EDITIONS_ORDER) {
      const wanted = input.scores[edition]
      const cur = current.scores[edition] ?? null
      const anterior = cur ? { source: cur.source, score: cur.score, ...(cur.evidence ? { evidence: cur.evidence } : {}) } : null
      const evidence = { curadoria: { decidido_em: nowIso, anterior } }
      const antes = notaNaPrevisao(edition, cur?.score ?? null, cur?.source ?? null)
      if (wanted.kind === "nota") {
        if (cur && cur.source === "curator_confirmed" && cur.score === wanted.value) continue
        scoreOps.push({
          edition,
          op: "upsert",
          row: { edition, criterion_slug: "adult_content", score: wanted.value, source: "curator_confirmed", status: "rated", confidence: null, ai_evaluation_id: null, decided_by: "curator", evidence },
          marksRecalc: antes !== wanted.value,
        })
      } else if (wanted.kind === "nao_avaliado") {
        if (cur && cur.source === "not_rated") continue
        const row: CuratedScoreRow = { edition, criterion_slug: "adult_content", score: null, source: "not_rated", status: "not_rated", confidence: null, ai_evaluation_id: null, decided_by: "curator", evidence }
        const marksRecalc = antes !== null
        scoreOps.push(cur ? { edition, op: "replace", row, marksRecalc } : { edition, op: "upsert", row, marksRecalc })
      }
    }
  }

  const stateMarksRecalc = usaNotaPorEdicao(current.state) !== usaNotaPorEdicao(input.state)
  return { state, scoreOps, stateMarksRecalc, affectsPrediction: stateMarksRecalc || scoreOps.some((o) => o.marksRecalc) }
}

/**
 * Na 1ª decisão da curadoria, fotografa o estado de antes. Nas seguintes (já é da curadoria) não faz
 * nada: a foto que vale é a de ANTES da curadoria, e ela já está na evidência (que é preservada).
 */
function snapshotAntesDaCuradoria(current: CurrentEditionCuration): Record<string, unknown> {
  if (current.decidedBy === "curator") return {}
  if (current.state == null) return { [ANTES]: null }
  return {
    [ANTES]: {
      state: current.state,
      r18_extra_chapters: current.r18ExtraChapters,
      basis: current.basis,
      decided_by: current.decidedBy,
      decided_at: current.decidedAt ?? null,
    },
  }
}

function lerAntesDaCuradoria(evidence: Record<string, unknown> | null): EstadoAntesDaCuradoria | null | undefined {
  if (!evidence || !(ANTES in evidence)) return undefined
  const v = evidence[ANTES]
  if (v === null) return null
  const o = v as Partial<EstadoAntesDaCuradoria> | undefined
  const valido =
    o != null &&
    (CURATED_EDITION_STATES as readonly string[]).includes(String(o.state)) &&
    (EDITION_BASES as readonly string[]).includes(String(o.basis)) &&
    ["audit", "legacy", "auto"].includes(String(o.decided_by))
  // Foto ilegível é tratada como AUSENTE: voltar para um estado inventado seria pior que não voltar.
  return valido ? (o as EstadoAntesDaCuradoria) : undefined
}

export type RevertPlan =
  /** A decisão atual não é da curadoria: não há o que remover. */
  | { kind: "sem_decisao" }
  /** Decisão da curadoria sem a foto do estado anterior: não se sabe para onde voltar. */
  | { kind: "sem_registro" }
  /** Não havia estado antes da curadoria: "sem decisão" é ausência de linha. */
  | { kind: "apagar"; marksRecalc: boolean }
  | {
      kind: "restaurar"
      row: {
        state: CuratedEditionState
        r18_extra_chapters: boolean
        basis: EditionBasis
        decided_by: Exclude<EditionDecidedBy, "curator">
        decided_at: string
        evidence: Record<string, unknown>
      }
      marksRecalc: boolean
    }

/**
 * "Remover decisão da curadoria": volta ao estado que existia antes dela (auditoria, MangaUpdates,
 * legado) ou, se não havia nenhum, à ausência de estado. NÃO toca nota por edição nem `adult_override`.
 *
 * O recálculo só é marcado se a previsão muda — e ela só lê se a obra é `mixed`.
 */
export function planRevertEditionCuration(current: CurrentEditionCuration, nowIso: string): RevertPlan {
  if (current.decidedBy !== "curator") return { kind: "sem_decisao" }
  const antes = lerAntesDaCuradoria(current.evidence)
  if (antes === undefined) return { kind: "sem_registro" }
  const marksRecalc = usaNotaPorEdicao(current.state) !== usaNotaPorEdicao(antes?.state ?? null)
  if (antes === null) return { kind: "apagar", marksRecalc }

  const { [ANTES]: _foto, curadoria, ...resto } = current.evidence ?? {}
  void _foto
  const historico = Array.isArray(resto.curadoria_removida) ? (resto.curadoria_removida as unknown[]) : []
  return {
    kind: "restaurar",
    marksRecalc,
    row: {
      state: antes.state,
      r18_extra_chapters: antes.state === "mixed" && antes.r18_extra_chapters,
      basis: antes.basis,
      decided_by: antes.decided_by,
      decided_at: antes.decided_at ?? nowIso,
      evidence: {
        ...resto,
        // O registro da decisão removida fica — remover não apaga história.
        curadoria_removida: [
          ...historico,
          { removido_em: nowIso, estado: current.state, extras_r19: current.r18ExtraChapters, decisao: curadoria ?? null },
        ],
      },
    },
  }
}

/** O que a tela diz sobre a remoção: para onde volta, ou por que não dá. */
export function describeRevertTarget(plan: RevertPlan): string | null {
  switch (plan.kind) {
    case "sem_decisao":
      return null
    case "sem_registro":
      return "Esta decisão não guardou o estado anterior, então não há para onde voltar."
    case "apagar":
      return "Volta para: sem decisão (tratada como versão única)."
    case "restaurar":
      return `Volta para: ${EDITION_STATE_LABEL[plan.row.state]} (${DECIDED_BY_LABEL[plan.row.decided_by]}).`
  }
}

export const DECIDED_BY_LABEL: Record<EditionDecidedBy, string> = {
  audit: "auditoria",
  curator: "curadoria",
  legacy: "regra antiga (R19 disponível)",
  auto: "MangaUpdates (automático)",
}
