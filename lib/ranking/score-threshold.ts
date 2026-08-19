import { sigmaToScore, scoreToSigma, snapToScoreGrid } from "@/lib/ranking/criterion-unit"

/**
 * Limiar de nota do painel de filtros: como um número digitado (ou arrastado)
 * vira parâmetro de URL, e como ele volta pra tela.
 *
 * Dono único porque as duas pontas TÊM que dizer o mesmo. O pill imprime um
 * rótulo ("≥ 7,3"), a URL guarda o valor que a query aplica, e enquanto cada
 * lado formatava/gravava por conta própria eles divergiam: `toFixed` com as
 * casas do PASSO do controle arredonda o valor real, então um limiar de 7,5 num
 * atributo (passo 1) era impresso como "≥ 8" — a tela prometendo um recorte que
 * a query não faz. Ver "dois critérios pro mesmo fato" no CLAUDE.md.
 */

/** A parte NUMÉRICA de uma nota do painel — o que basta pra virar limiar. */
export type ThresholdScale = {
  /** Domínio de EXIBIÇÃO do controle (σ quando a lente está ligada). */
  min: number
  max: number
  step: number
  unit?: "sd"
  moment?: { mean: number; sd: number }
  /**
   * Passo REAL em que os valores desta nota existem no banco. Presente só onde
   * a medição sustenta: `category_scores` está **100% na grade de 0,5** (8.811
   * de 8.811, medido em 2026-08-19), enquanto a Nota Prevista tem 2,3% e a
   * média externa 0%. É o que autoriza a dica de equivalência abaixo — sem
   * medição, ela seria palpite sobre o dado.
   */
  grid?: number
}

/**
 * Teto de casas decimais de um limiar. Existe pra que o que a URL guarda seja
 * exatamente o que a tela imprime: sem ele, digitar 7,125 gravaria 7.125 e o
 * pill mostraria "7,13" — a mesma divergência que esta seção existe pra fechar.
 * 0,01 ponto é resolução de sobra numa escala 0–10 (e em 0–100).
 */
export const MAX_THRESHOLD_DECIMALS = 2

export function numParam(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const n = parseFloat(v)
  return isNaN(n) ? undefined : n
}

/** Casas que o PASSO do controle pede (o piso da formatação). */
export function scoreDecimals(step: number): number {
  return step < 1 ? (step.toString().split(".")[1]?.length ?? 1) : 0
}

function decimalsOf(v: number): number {
  const s = String(v)
  const dot = s.indexOf(".")
  return dot < 0 ? 0 : Math.min(s.length - dot - 1, MAX_THRESHOLD_DECIMALS)
}

/**
 * Formata o limiar com as casas que ele REALMENTE tem, nunca menos.
 *
 * 🔴 O piso é o passo do controle (pra "7" virar "7,0" onde o passo é 0,5), mas
 * o teto é o valor: um limiar manual de 7,3 num atributo de passo 1 imprime
 * "7,3", não "7". Arredondar aqui é afirmar um corte diferente do aplicado.
 *
 * ⚠️ Vírgula, e é o dono ÚNICO disso: o campo manual aceita "7,3" (a interface é
 * em pt-BR), então devolver "7.3" faria o valor digitado e o valor exibido
 * usarem duas convenções a dois centímetros um do outro — na mesma linha, com o
 * rascunho ainda em vírgula. Quem imprime limiar (pill, faixa do slider, chip de
 * filtro ativo) passa por aqui.
 */
export function formatThresholdNumber(v: number, step: number): string {
  return v.toFixed(Math.max(scoreDecimals(step), decimalsOf(v))).replace(".", ",")
}

/**
 * Texto digitado → número. Aceita vírgula porque a interface é em pt-BR e o
 * campo é `inputMode="decimal"`: num `type="number"` o Chrome devolve string
 * VAZIA para "7,3", ou seja o filtro simplesmente não acontece e nada acusa.
 */
export function parseThresholdInput(raw: string): number | null {
  const t = raw.trim().replace(",", ".").replace("−", "-")
  if (t === "" || t === "-" || t === "+" || t === "." || t === "-.") return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Extremos da escala em PONTOS — que é o que a URL guarda.
 *
 * 🔴 Não é `def.min`/`def.max`: sob a lente σ o domínio de exibição é em desvios
 * (ex.: −3,8σ a +2,2σ) enquanto o valor gravado continua em pontos 0–10. E fora
 * da lente as duas notas de escala 0–100 (Alinhamento e Veredito) têm extremos
 * próprios — era exatamente isso que um `>= 10` fixo ignorava, descartando TODO
 * limiar máximo dessas duas.
 */
export function pointsBounds(def: ThresholdScale): { min: number; max: number } {
  return def.unit === "sd" ? { min: 0, max: 10 } : { min: def.min, max: def.max }
}

/** Pontos (como está na URL) → domínio de EXIBIÇÃO do controle. */
export function toDisplayValue(def: ThresholdScale, points: number | undefined): number | undefined {
  if (points == null) return undefined
  if (def.unit !== "sd") return points
  return scoreToSigma(points, def.moment) ?? undefined
}

/**
 * Domínio de exibição → pontos, que é o que vai pra URL.
 *
 * Em σ encaixa na grade de 0,5 (ver snapToScoreGrid): lá o número vem de uma
 * conversão, e um limiar fracionário faz o pill em Pontos mentir. Em pontos o
 * valor é o que a pessoa escolheu — só arredondado ao teto de casas, pra tela e
 * URL nunca discordarem.
 */
export function toPointsValue(
  def: ThresholdScale,
  display: number,
  bound: "min" | "max",
): number | null {
  if (def.unit !== "sd") return parseFloat(display.toFixed(MAX_THRESHOLD_DECIMALS))
  const p = sigmaToScore(display, def.moment)
  return p == null ? null : snapToScoreGrid(p, bound)
}

/**
 * Limiar (no domínio de exibição) → valor do parâmetro, ou `null` pra apagá-lo.
 *
 * Limiar na ponta da escala não é filtro: "≤ 10" e "≥ 0" não excluem ninguém, e
 * gravá-los criaria chip prometendo recorte que não existe.
 */
export function thresholdToParam(
  def: ThresholdScale,
  display: number | null,
  bound: "min" | "max",
): string | null {
  if (display == null) return null
  const p = toPointsValue(def, display, bound)
  if (p == null) return null
  const bounds = pointsBounds(def)
  if (bound === "max" && p >= bounds.max) return null
  if (bound === "min" && p <= bounds.min) return null
  return String(p)
}

export function isOffGrid(v: number, grid: number | undefined): boolean {
  if (!grid || grid <= 0) return false
  return Math.abs(v / grid - Math.round(v / grid)) > 1e-9
}

/**
 * O limiar ON-GRID que recorta exatamente o mesmo conjunto.
 *
 * 🔴 NÃO é `snapToScoreGrid`, e a direção é o OPOSTO dele. Aquele existe pra
 * ALARGAR um limiar convertido de σ (mínimo desce, pra não perder as obras da
 * borda). Aqui a pergunta é outra — "quanto vale, na prática, o que eu digitei?"
 * —, e com as notas em múltiplos de 0,5 um `≥ 7,3` admite 7,5 e exclui 7,0: ele
 * equivale a `≥ 7,5`, o TETO. Usar o outro faria a dica dizer "≥ 7,0", que é
 * falso.
 */
export function equivalentGridThreshold(v: number, bound: "min" | "max", grid: number): number {
  const snapped = bound === "min" ? Math.ceil(v / grid) * grid : Math.floor(v / grid) * grid
  return parseFloat(snapped.toFixed(MAX_THRESHOLD_DECIMALS))
}
