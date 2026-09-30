/**
 * Recuperação de payload da tool `submit_evaluation` que o schema RECUSOU — só para os dois
 * defeitos OBSERVADOS na nuvem (v31, 2026-09-27), cada um com a forma exata em que apareceu.
 *
 * Roda DEPOIS de o Zod reprovar, nunca antes: payload válido não passa por aqui, então não há
 * como esta função mudar uma avaliação que já era aceita. E o resultado volta pelo MESMO Zod —
 * recuperar não dispensa validar.
 *
 * 🔴 A linha que este arquivo defende é a mesma do `coerceToolPayload`: recuperar o dado que
 * veio, sem inventar o que não veio. Cada regra exige a forma INTEIRA e recusa na primeira
 * ambiguidade; o erro que sobra é o barato (uma retentativa paga), nunca o caro (uma nota
 * plausível e errada entrando no catálogo como fato da obra).
 *
 * As duas regras:
 *
 * 1. `confidence` VAZADO dentro do `summary`. O modelo escreveu o fechamento do próprio
 *    parâmetro dentro da string e abriu o seguinte ali mesmo:
 *
 *    ```
 *    "summary": "…típica do gênero \"dark romance\".</parameter>\n<parameter name=\"confidence\">0.75"
 *    ```
 *
 *    e o payload chegou sem a chave `confidence`. Só vale com a sequência LITERAL, uma única
 *    vez, no FIM do summary, com o número em [0, 1] e a chave `confidence` ausente.
 *
 * 2. `scores` como string de JSON com ASPAS CRUAS dentro de uma justificativa
 *    (`tags de "European Ambience" e "Historical Setting"`). Não é consertar JSON: os
 *    delimitadores vêm do schema da própria tool (`{"criterion":"…","score":…,"justification":"…"}`),
 *    e a regra só aceita quando a string inteira é essa sequência, sem barra invertida nenhuma
 *    (sem escape misturado), sem caractere de controle e sem nenhum fragmento de delimitador
 *    dentro do texto. Aí as aspas internas não têm outra leitura possível.
 */

export type PayloadRecovery = "confidence_leaked_into_summary" | "scores_unescaped_quotes"

// ── Regra 1 ────────────────────────────────────────────────────────────────────────────────

/** A sequência exata observada — o fechamento do summary seguido da abertura de `confidence`. */
const CONFIDENCE_LEAK = '</parameter>\n<parameter name="confidence">'

/** Número em [0, 1], escrito como o modelo escreve: `0`, `0.75`, `1`, `1.0`. Nada de sinal, expoente ou espaço. */
const CONFIDENCE_LITERAL = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/

function recoverLeakedConfidence(obj: Record<string, unknown>): Record<string, unknown> | null {
  if ("confidence" in obj) return null // a chave existe (mesmo inválida): duas fontes para o mesmo campo
  const summary = obj.summary
  if (typeof summary !== "string") return null

  const at = summary.indexOf(CONFIDENCE_LEAK)
  if (at <= 0 || at !== summary.lastIndexOf(CONFIDENCE_LEAK)) return null

  // O vazamento tem de ser a ÚNICA marcação de parâmetro no summary: um `<parameter` a mais
  // (no meio do texto, ou um segundo campo vazando) é estrutura que esta regra não entende.
  if ((summary.match(/<\/?parameter\b/g) ?? []).length !== 2) return null

  const head = summary.slice(0, at)
  const tail = summary.slice(at + CONFIDENCE_LEAK.length)
  if (!head.trim() || !CONFIDENCE_LITERAL.test(tail)) return null

  const confidence = Number(tail)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null

  return { ...obj, summary: head, confidence }
}

// ── Regra 2 ────────────────────────────────────────────────────────────────────────────────

const RECORD_OPEN = '{"criterion":"'

/** U+0000–U+001F: inválidos crus dentro de string JSON — outro defeito, não o desta regra. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 0x20) return true
  return false
}
const SCORE_LITERAL = /^\d+(?:\.\d+)?$/

/** Fragmentos de delimitador do molde: se aparecem DENTRO de uma justificativa, a fronteira
 *  entre texto e estrutura deixa de ser única. */
const AMBIGUOUS_IN_TEXT = ['"}', '"criterion"', '"score"', '"justification"', RECORD_OPEN]

function recoverScoresWithRawQuotes(
  obj: Record<string, unknown>,
  criterionSlugs: readonly string[],
): Record<string, unknown> | null {
  const raw = obj.scores
  if (typeof raw !== "string") return null

  // Se já é JSON válido, o `coerceToolPayload` teria desembrulhado: outro defeito, outra regra.
  try {
    JSON.parse(raw)
    return null
  } catch {
    // segue — o JSON está quebrado, é o caso desta regra
  }

  // Nenhum escape e nenhum caractere de controle: a única diferença para um JSON válido pode
  // ser a aspa interna sem escape. Com `\` presente, a string mistura convenções e não há
  // leitura única.
  if (raw.includes("\\") || hasControlChar(raw)) return null
  if (!raw.startsWith(`[${RECORD_OPEN}`) || !raw.endsWith('"}]')) return null

  const starts: number[] = []
  for (let i = raw.indexOf(RECORD_OPEN); i !== -1; i = raw.indexOf(RECORD_OPEN, i + 1)) starts.push(i)

  const slugs = new Set(criterionSlugs)
  const seen = new Set<string>()
  const records: Array<{ criterion: string; score: number; justification: string }> = []
  let hadRawQuote = false

  for (let i = 0; i < starts.length; i++) {
    const isLast = i === starts.length - 1
    const end = isLast ? raw.length - 1 : starts[i + 1] - 1
    if (raw[end] !== (isLast ? "]" : ",")) return null
    const record = raw.slice(starts[i], end)

    const m = /^\{"criterion":"([a-z_]+)","score":([^,"]+),"justification":"([\s\S]*)"\}$/.exec(record)
    if (!m) return null
    const [, criterion, scoreLiteral, text] = m

    if (!slugs.has(criterion) || seen.has(criterion)) return null
    if (!SCORE_LITERAL.test(scoreLiteral)) return null
    const score = Number(scoreLiteral)
    if (score < 0 || score > 10) return null
    if (AMBIGUOUS_IN_TEXT.some((frag) => text.includes(frag))) return null

    // Aspas internas têm de vir em PARES: uma aspa solta é texto que abriu e não fechou —
    // o sinal de que a fronteira pode estar noutro lugar.
    const quotes = (text.match(/"/g) ?? []).length
    if (quotes % 2 !== 0) return null
    if (quotes > 0) hadRawQuote = true

    seen.add(criterion)
    records.push({ criterion, score, justification: text })
  }

  // Sem aspa crua, o que quebrou o JSON foi outra coisa — que esta regra não conhece.
  if (!hadRawQuote || records.length === 0) return null

  return { ...obj, scores: records }
}

// ── Entrada ────────────────────────────────────────────────────────────────────────────────

/**
 * Tenta as duas recuperações sobre um payload que o schema recusou. Puro, sem log: quem chama
 * valida de novo e decide o que registrar. Sem recuperação aplicável, devolve o input INTACTO
 * e `recovered` vazio.
 */
export function recoverEvaluationToolPayload(
  input: unknown,
  criterionSlugs: readonly string[],
): { value: unknown; recovered: PayloadRecovery[] } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { value: input, recovered: [] }
  }
  let obj = input as Record<string, unknown>
  const recovered: PayloadRecovery[] = []

  const withConfidence = recoverLeakedConfidence(obj)
  if (withConfidence) {
    obj = withConfidence
    recovered.push("confidence_leaked_into_summary")
  }
  const withScores = recoverScoresWithRawQuotes(obj, criterionSlugs)
  if (withScores) {
    obj = withScores
    recovered.push("scores_unescaped_quotes")
  }

  return { value: recovered.length ? obj : input, recovered }
}
