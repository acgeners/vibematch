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
 * pt-BR (vírgula) em todo lugar: até 2026-08-07 o `/curation/ai-usage` mostrava `$0.06` e
 * o popup de custo mostrava `~$0,05` na mesma sessão.
 *
 * 🔴 **Valor que aparece ao lado de outro precisa de `makeUsdScale`, não de
 * `formatUsd`.** Ver o docblock dele: escolher a unidade valor a valor faz a régua
 * trocar de unidade no meio, e foi assim que `~8,15¢ … até $0,12` saiu na mesma
 * linha.
 */

/** Em centavos: abaixo disto o valor é exibido em ¢, daqui pra cima em $. */
const CENTS_CUTOFF = 10

/**
 * Teto em centavos: mesmo que o menor valor da régua peça ¢, um vizinho a partir
 * de US$1 força a régua inteira pra dólar. Sem isso um eixo de US$0,001 a US$7,76
 * imprimiria "776¢" — nenhuma unidade única serve pra três ordens de magnitude, e
 * num eixo quem manda são os valores grandes.
 */
const CENTS_VETO = 100

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
  const abs = Math.abs(usd)
  // Mesmo cuidado do `asCents`, e ele importa MAIS aqui: quando o veto do
  // `CENTS_VETO` puxa a régua pra dólar, os menores da série caem nesta faixa.
  // Medido no /curation/ai-usage: `suggest_groups` custou US$0,0046 e a coluna Custo
  // imprimia "$0,00" — que AFIRMA que não houve custo.
  if (abs > 0 && abs < 0.005) return usd < 0 ? `>${MINUS}$0,01` : "<$0,01"
  return `${usd < 0 ? MINUS : ""}$${abs.toFixed(2).replace(".", ",")}`
}

/** Centavos do valor JÁ ARREDONDADO — é ele que decide a unidade (ver `makeUsdScale`). */
function roundedCents(usd: number): number {
  return Number((Math.abs(usd) * 100).toFixed(2))
}

/**
 * Uma régua de USD: **uma unidade só** para um conjunto de valores que o leitor
 * compara entre si.
 *
 * 🔴 **"Régua" é mais largo do que eixo de gráfico** — e essa foi a lição de
 * 2026-08-07. A 1ª versão só cobria eixo, e a lista "Quanto custa cada ação" saiu
 * com `~8,15¢` ao lado de `até $0,12` **na mesma linha**: a estimativa e o teto do
 * MESMO número, em unidades diferentes, com o leitor convertendo de cabeça pra
 * saber se o teto era muito acima. Toda comparação lado a lado é uma régua: eixo,
 * par estimativa/teto, gasto contra cap, e a lista inteira quando ela existe pra
 * ordenar as opções.
 *
 * A unidade sai do **menor** valor não-nulo, não do maior: é o menor que colapsa
 * em "$0.00", então é ele quem decide se a régua precisa de centavos. O maior só
 * exerce VETO, via `CENTS_VETO`.
 *
 * ⚠️ A decisão usa o valor **já arredondado**. Pelo bruto, US$0,0999 imprimiria
 * "10¢" e US$0,10 imprimiria "$0,10" — o mesmo número em duas unidades, um
 * centavo de distância.
 */
export interface UsdScale {
  /** "$0,13" · "5,67¢" · "—" para ausência de dado. */
  format(usd: number | null | undefined): string
  /** Idem, marcado como estimativa: "~5,67¢". */
  approx(usd: number | null | undefined): string
}

export function makeUsdScale(...valuesUsd: Array<number | null | undefined>): UsdScale {
  const magnitudes = valuesUsd
    .filter((v): v is number => v != null && Number.isFinite(v))
    .map((v) => roundedCents(v))
    // Zero não opina: num eixo ele é sempre o 1º tick, e deixá-lo decidir fixaria
    // toda régua em centavos.
    .filter((c) => c > 0)

  const cents =
    magnitudes.length === 0 ||
    (Math.min(...magnitudes) < CENTS_CUTOFF && Math.max(...magnitudes) < CENTS_VETO)

  const format = (usd: number | null | undefined): string => {
    if (usd == null || !Number.isFinite(usd)) return "—"
    return cents ? asCents(usd) : asDollars(usd)
  }
  return {
    format,
    approx: (usd) => {
      const s = format(usd)
      // "~<0,01¢" empilharia dois qualificadores para dizer a mesma coisa.
      if (s === "—" || s.startsWith("<") || s.startsWith(">")) return s
      return `~${s}`
    },
  }
}

/**
 * Valor solto, sem nada ao lado pra comparar — é a régua de um elemento só, então
 * sai da MESMA regra em vez de uma segunda cópia dela.
 */
export function formatUsd(usd: number | null | undefined): string {
  return makeUsdScale(usd).format(usd)
}

/** Idem, marcado como estimativa: "~5,67¢". */
export function formatUsdApprox(usd: number | null | undefined): string {
  return makeUsdScale(usd).approx(usd)
}
