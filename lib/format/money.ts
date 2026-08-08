/**
 * Dinheiro (USD) na interface, num lugar só.
 *
 * Antes eram SEIS arquivos formatando por conta própria (oito funções, duas
 * convenções incompatíveis): `components/settings/ai-usage/format.ts` com ponto,
 * três cópias literais dela (card de saldo, os dois gráficos), a de 4 casas do
 * badge dev, e a dupla `formatUsd`/`formatUsdExact` de `lib/cost-preview/catalog.ts`
 * com vírgula — além de ~12 `toFixed()` soltos em toasts e mensagens de servidor.
 * É a mesma armadilha do `LOW_BALANCE_USD`: superfícies que opinam sobre o mesmo
 * número a partir de expressões escritas em separado divergem sem erro e sem log.
 *
 * **A unidade muda com a escala.** Abaixo de 10¢ o dólar colapsa: a maioria das
 * chamadas de IA custa entre US$0,0001 e US$0,09, e com duas casas isso vira
 * "$0.00" — informação nenhuma. Com quatro casas vira "$0.0567", que é preciso e
 * ilegível (o zero-vírgula-zero-zero não carrega nada). Em centavos o mesmo
 * número é `5,67¢`: os dígitos que importam ficam à esquerda da vírgula.
 *
 * Acima de 10¢ o inverso vale — `$0,57` lê melhor que `57,3¢` —, então o corte
 * fica exatamente onde o dólar deixa de funcionar, não em US$1.
 *
 * pt-BR (vírgula) em todo lugar: até 2026-08-07 o `/ai-usage` mostrava `$0.06` e
 * o popup de custo mostrava `~$0,05` na mesma sessão.
 */

/** Em centavos: abaixo disto o valor é exibido em ¢, daqui pra cima em $. */
const CENTS_CUTOFF = 10

/** Sinal de menos tipográfico (U+2212), o mesmo usado nos z-scores do /ranking. */
const MINUS = "−"

/**
 * `toFixed` + poda de zeros mudos, em pt-BR. **Não** trocar por
 * `Math.round(n * 10 ** k) / 10 ** k`: os dois divergem (ver `lib/score-rounding.ts`),
 * e aqui o número exibido é o mesmo que decide a unidade.
 */
function decimal(n: number, maxFractionDigits: number): string {
  let s = n.toFixed(maxFractionDigits)
  // A checagem do ponto não é decorativa: sem ela, `/\.?0+$/` come o zero de
  // "100" e imprime "1".
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "")
  return s.replace(".", ",")
}

/** "5,67¢" · "0,34¢" · "9,3¢" — no máximo 2 casas, sem zeros à direita. */
function asCents(usd: number): string {
  const cents = Math.abs(usd) * 100
  // Existe, mas some no arredondamento: dizer "0¢" afirmaria que não houve custo.
  if (cents > 0 && cents < 0.005) return usd < 0 ? `>${MINUS}0,01¢` : "<0,01¢"
  return `${usd < 0 ? MINUS : ""}${decimal(cents, 2)}¢`
}

/** "$0,13" · "$38,50" — sempre 2 casas, que é como dólar se escreve. */
function asDollars(usd: number): string {
  return `${usd < 0 ? MINUS : ""}$${Math.abs(usd).toFixed(2).replace(".", ",")}`
}

/**
 * A unidade sai do valor JÁ ARREDONDADO, não do bruto. Decidindo pelo bruto,
 * US$0,0999 imprimiria "10¢" e US$0,10 imprimiria "$0,10" — o mesmo número em
 * duas unidades, um centavo de distância.
 */
function isCentScale(usd: number): boolean {
  return Number((Math.abs(usd) * 100).toFixed(2)) < CENTS_CUTOFF
}

/** USD legível. `null`/`NaN`/`Infinity` → "—" (não "$0", que afirmaria zero). */
export function formatUsd(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—"
  return isCentScale(usd) ? asCents(usd) : asDollars(usd)
}

/** Idem, marcado como estimativa: "~5,67¢". */
export function formatUsdApprox(usd: number | null | undefined): string {
  const s = formatUsd(usd)
  // "~<0,01¢" empilharia dois qualificadores para dizer a mesma coisa.
  if (s === "—" || s.startsWith("<") || s.startsWith(">")) return s
  return `~${s}`
}

/**
 * Formatter de eixo de gráfico: fixa UMA unidade para o eixo inteiro, escolhida
 * pelo maior valor da série.
 *
 * Aplicar `formatUsd` tick a tick produziria "0¢ · 5¢ · 50¢ · $1,00" no mesmo
 * eixo — a régua trocaria de unidade no meio, e a distância entre dois ticks
 * deixaria de ser comparável a olho.
 */
export function makeUsdAxisFormatter(maxAbsUsd: number): (value: number) => string {
  const cents = isCentScale(maxAbsUsd)
  return (value: number) => {
    if (!Number.isFinite(value)) return "—"
    return cents ? asCents(value) : asDollars(value)
  }
}
