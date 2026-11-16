import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { resolveFeatureLabel } from "@/lib/calculations/ridge-feature-labels"
import type { ExpectedExplanation } from "@/lib/calculations/expected"

/**
 * A JUSTIFICATIVA da Nota Prevista (pedido de 16/11/2026), dona do formato gravado e da leitura.
 *
 * 🔴 Não é texto de IA, de propósito. As outras justificativas do app (Veredito, atributos,
 * Interesse) são escritas por um modelo de linguagem porque o NÚMERO também é: o texto é o
 * raciocínio que o produziu. A Nota Prevista sai de um Ridge, e o raciocínio dele é a conta — uma
 * IA "explicando" depois inventaria motivos plausíveis que podem contradizer o número. Aqui cada
 * linha é uma parcela da própria soma (`ExpectedExplanation`), então justificativa e nota nunca
 * discordam, e o custo é zero.
 *
 * ⚠️ A leitura é por GRUPO, não entrada por entrada: várias entradas andam juntas (os 9 atributos e
 * a Nota.IA, que é a soma deles), e o peso de UMA delas isolada engana — o Ridge reparte o efeito
 * entre as correlatas. A soma do grupo é estável. Dentro de cada grupo, as entradas que mais pesaram
 * aparecem só como exemplo.
 */

/** O que fica gravado em `calculated_scores.expected_explanation` (e no espelho per-user). */
export interface ExpectedExplanationPayload {
  v: 1
  /** Previsão de uma obra média do treino — o ponto de partida. */
  base: number
  /** Contribuição de cada entrada (3 casas; as desprezíveis ficam fora). */
  contributions: Record<string, number>
  /** O ajuste de observação manual aplicado por cima (já com o teto de ±0,30). */
  obs: number
  /** A Nota Prevista final, a mesma da coluna `expected_score`. */
  score: number
}

export interface ExpectedExplanationEditions {
  normal: ExpectedExplanationPayload | null
  r18: ExpectedExplanationPayload | null
}

/**
 * A coluna inteira. O topo é sempre a justificativa da MESMA nota das colunas (`expected_score`):
 * em obra mixed, a da edição padrão. Quando a edição padrão não tem nota, o topo fica só com as
 * edições — nunca com a justificativa da outra edição, que afirmaria uma nota que a linha não tem.
 */
export type ExpectedExplanationColumn =
  | (ExpectedExplanationPayload & { editions?: ExpectedExplanationEditions })
  | { v: 1; editions: ExpectedExplanationEditions }

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Monta o que é gravado. `score` é a Nota Prevista final (depois do clamp e do ajuste). */
export function toExplanationPayload(
  explanation: ExpectedExplanation,
  observationAdjustment: number,
  score: number,
): ExpectedExplanationPayload {
  const contributions: Record<string, number> = {}
  for (const [name, c] of Object.entries(explanation.contributions)) {
    if (Math.abs(c) >= 0.0005) contributions[name] = round3(c)
  }
  return {
    v: 1,
    base: round3(explanation.base),
    contributions,
    obs: round3(Math.min(Math.max(observationAdjustment, -0.3), 0.3)),
    score: round3(score),
  }
}

export type ExplanationGroupKey = "atributos" | "gosto" | "externa" | "formato" | "leitura" | "outros"

export const EXPLANATION_GROUP_LABELS: Record<ExplanationGroupKey, string> = {
  atributos: "Atributos da obra",
  gosto: "Seu gosto",
  externa: "Recepção externa",
  formato: "Formato e publicação",
  leitura: "Sua leitura",
  outros: "Outros",
}

/** Grupo de cada entrada do modelo. Entrada nova cai em "outros" — nunca some da conta. */
export function groupOfFeature(name: string): ExplanationGroupKey {
  if (name in CRITERIA_INFO || name === "IA(n)" || name === "ArtEstimate") return "atributos"
  if (["SinopseScore", "LovedTagOverlap", "AvoidedTagOverlap", "CriterionFitScore"].includes(name)) return "gosto"
  if (name === "Nota.M" || name === "LogVotos") return "externa"
  if (["Cps.N", "ReleaseAge", "RunLength"].includes(name) || name.startsWith("Status_") || name.startsWith("Origin_"))
    return "formato"
  if (name.startsWith("post_")) return "leitura"
  return "outros"
}

/**
 * Nome legível de cada entrada. O dono é `resolveFeatureLabel` — o mesmo do gráfico de pesos da
 * Calibração e do perfil de gosto. Um segundo mapa aqui faria a mesma entrada ter dois nomes.
 */
export const featureLabel = resolveFeatureLabel

export interface ExplanationGroup {
  key: ExplanationGroupKey
  label: string
  /** Soma das contribuições do grupo. */
  delta: number
  /** As entradas que mais pesaram no grupo (até 3), na direção que pesaram. */
  top: Array<{ name: string; label: string; delta: number }>
}

export interface ExplanationView {
  base: number
  groups: ExplanationGroup[]
  obs: number
  score: number
  /**
   * A soma das parcelas não é a nota porque a conta passou do limite da escala (0 a 10). Comparado
   * com a NOTA, não com o intervalo: o modelo é limitado ANTES do ajuste manual, então 10,3 − 0,3
   * vira 9,7 e não 10 — a soma fica dentro da escala e mesmo assim não é a nota.
   */
  clamped: boolean
}

/** Agrupa e ordena para a tela: grupos por peso (maior |Δ| primeiro), sem os vazios. */
export function describeExplanation(payload: ExpectedExplanationPayload): ExplanationView {
  const byGroup = new Map<ExplanationGroupKey, Array<{ name: string; delta: number }>>()
  for (const [name, delta] of Object.entries(payload.contributions)) {
    const g = groupOfFeature(name)
    const list = byGroup.get(g) ?? []
    list.push({ name, delta })
    byGroup.set(g, list)
  }
  const groups: ExplanationGroup[] = [...byGroup.entries()]
    .map(([key, items]) => {
      const delta = items.reduce((s, i) => s + i.delta, 0)
      const top = [...items]
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3)
        .filter((i) => Math.abs(i.delta) >= 0.05)
        .map((i) => ({ ...i, label: featureLabel(i.name) }))
      return { key, label: EXPLANATION_GROUP_LABELS[key], delta, top }
    })
    .filter((g) => Math.abs(g.delta) >= 0.005 || g.top.length > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const linear = payload.base + groups.reduce((s, g) => s + g.delta, 0) + payload.obs
  return {
    base: payload.base,
    groups,
    obs: payload.obs,
    score: payload.score,
    // Folga de arredondamento: 3 casas por parcela e as desprezíveis (< 0,0005) fora.
    clamped: Math.abs(linear - payload.score) > 0.03,
  }
}

/**
 * A justificativa da edição pedida, ou `null`. Em obra mixed a nota exibida pode ser de uma edição
 * que não é a das colunas — e a justificativa tem de ser a DELA, nunca a da outra.
 */
export function explanationForEdition(
  column: ExpectedExplanationColumn | null | undefined,
  edition: "normal" | "r18" | null,
  columnEdition: string | null,
): ExpectedExplanationPayload | null {
  if (!column || column.v !== 1) return null
  if (edition && column.editions) return column.editions[edition] ?? null
  if (!("base" in column)) return null
  if (edition && columnEdition && edition !== columnEdition) return null
  return column
}
