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
 *
 * Mais três, dos payloads RECUSADOS no gate art4 (2026-09-30, `.pilot/gate-art4-…`), dois deles
 * no v30 de PRODUÇÃO (braço A):
 *
 * 3. O payload INTEIRO dentro do `summary`: o modelo fechou o summary e escreveu `confidence`,
 *    `scores` (e, na variante com Arte, `art`) como TEXTO ali dentro. Dois moldes exatos, cada um
 *    com o número exato de marcações — não é um parser de XML. Ver `LEAK_TEMPLATES`.
 * 4. Uma linha `<!--criterio-->` entre dois registros de `scores` (rótulo de seção).
 * 5. A regra 2 com quebras de linha ESTRUTURAIS (`[\n{…},\n{…}\n]`), só nos separadores.
 *
 * As três novas exigem, no fim, os 11 critérios completos e únicos: recuperar não pode produzir
 * um payload que o pós-processamento completaria com "Não avaliado." em silêncio.
 */

export type PayloadRecovery =
  | "confidence_leaked_into_summary"
  | "scores_unescaped_quotes"
  | "payload_leaked_into_summary"
  | "payload_and_art_leaked_into_summary"
  | "scores_comment_line"
  | "scores_unescaped_quotes_multiline"

export interface RecoveryOptions {
  /** Só a variante que PEDE `art` pode recuperar um `art` vazado — na produção é parâmetro desconhecido. */
  allowArt?: boolean
}

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

/**
 * Regra 5: a forma "uma linha por registro" da regra 2. Só aceita `\n` nas TRÊS posições de
 * separador (depois do `[`, entre `"},` e `{"criterion":"`, antes do `]`) e em TODAS elas — mistura
 * de separador com e sem quebra é outra forma. Devolve a string compacta, ou `null`.
 *
 * Por que a fronteira é única: JSON não admite `\n` cru dentro de string, então a leitura em que
 * toda quebra é ESPAÇO ESTRUTURAL é a única com um só defeito (a aspa sem escape, que é o desta
 * regra); qualquer outra exige um segundo defeito no texto.
 */
function compactarSeparadoresEmLinha(raw: string): string | null {
  const SEP_NL = `"},\n${RECORD_OPEN}`
  const SEP = `"},${RECORD_OPEN}`
  if (!raw.startsWith(`[\n${RECORD_OPEN}`) || !raw.endsWith('"}\n]')) return null
  if (raw.includes(SEP)) return null // separadores misturados
  const separadores = raw.split(SEP_NL).length - 1
  if ((raw.match(/\n/g) ?? []).length !== separadores + 2) return null // quebra fora de separador
  return `[${raw.slice(2, -2)}]`.split(SEP_NL).join(SEP)
}

function recoverScoresWithRawQuotes(
  obj: Record<string, unknown>,
  criterionSlugs: readonly string[],
): { obj: Record<string, unknown>; multiline: boolean } | null {
  if (typeof obj.scores !== "string") return null
  let raw: string = obj.scores

  // Se já é JSON válido, o `coerceToolPayload` teria desembrulhado: outro defeito, outra regra.
  try {
    JSON.parse(raw)
    return null
  } catch {
    // segue — o JSON está quebrado, é o caso desta regra
  }

  let multiline = false
  if (raw.includes("\n")) {
    const compacto = compactarSeparadoresEmLinha(raw)
    if (compacto == null) return null
    raw = compacto
    multiline = true
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

  return { obj: { ...obj, scores: records }, multiline }
}

// ── Regras 3 e 4 ───────────────────────────────────────────────────────────────────────────

/** Toda marcação da tool que pode aparecer num vazamento — usada para CONTAR, nunca para parsear. */
const TOOL_MARKUP = /<\/?(?:parameter|invoke|function_calls|summary|confidence|scores|reviewsRejectedReason|art)\b|antml:/g

/**
 * Os dois moldes OBSERVADOS, byte a byte, com quantas marcações cada um tem. A contagem exata é o
 * que impede o `([\s\S]+?)` do texto de engolir estrutura: se há uma marcação a mais em qualquer
 * lugar (no texto, dentro do JSON, um campo repetido), a contagem não fecha e nada é recuperado.
 *
 * - `payload_leaked_into_summary` — E04 (braço A, v30) e E01 (braço B): `scores` é o último e
 *   vai até o fim da string, sem fechamento.
 * - `payload_and_art_leaked_into_summary` — E03 (braço B): abre com `</summary>`, fecha tudo,
 *   traz `art` e termina em `</invoke>\n`. Só na variante que pede Arte.
 */
const LEAK_TEMPLATES = [
  {
    nome: "payload_leaked_into_summary" as const,
    marcacoes: 4,
    art: false,
    re: /^([\s\S]+?)<\/parameter>\n<parameter name="confidence">([^<]*)<\/parameter>\n<parameter name="scores">([\s\S]+)$/,
  },
  {
    nome: "payload_and_art_leaked_into_summary" as const,
    marcacoes: 8,
    art: true,
    re: /^([\s\S]+?)<\/summary>\n<parameter name="confidence">([^<]*)<\/parameter>\n<parameter name="scores">([\s\S]+)<\/parameter>\n<parameter name="art">([\s\S]+)<\/parameter>\n<\/invoke>\n$/,
  },
]

function recoverPayloadLeakedIntoSummary(
  obj: Record<string, unknown>,
  opts: RecoveryOptions,
): { obj: Record<string, unknown>; nome: PayloadRecovery } | null {
  // Os campos reais têm de estar AUSENTES: com a chave presente seriam duas fontes para o mesmo campo.
  if ("confidence" in obj || "scores" in obj) return null
  const summary = obj.summary
  if (typeof summary !== "string") return null
  const marcacoes = (summary.match(TOOL_MARKUP) ?? []).length

  for (const t of LEAK_TEMPLATES) {
    if (marcacoes !== t.marcacoes) continue
    if (t.art && (!opts.allowArt || "art" in obj)) return null
    const m = t.re.exec(summary)
    if (!m) continue
    const [, head, confLiteral, scoresTexto, artTexto] = m
    if (!head.trim() || !CONFIDENCE_LITERAL.test(confLiteral)) return null
    const confidence = Number(confLiteral)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null

    // `scores` sai como estava escrito: JSON válido vira lista; JSON quebrado segue como STRING
    // para as regras de `scores` — os mesmos bytes enfrentam a mesma régua que enfrentariam no campo
    // certo. A completude é conferida no fim, na entrada.
    let scores: unknown = scoresTexto
    try {
      scores = JSON.parse(scoresTexto)
    } catch {
      // segue como string
    }

    const out: Record<string, unknown> = { ...obj, summary: head, confidence, scores }
    if (t.art) {
      let art: unknown
      try {
        art = JSON.parse(artTexto)
      } catch {
        return null // Arte malformada num molde que a traz: o molde não fecha
      }
      if (!art || typeof art !== "object" || Array.isArray(art)) return null
      out.art = art
    }
    return { obj: out, nome: t.nome }
  }
  return null
}

/** `\n<!--rotulo-->\n` entre dois registros, com o rótulo igual ao critério do registro SEGUINTE. */
const COMMENT_LINE = /\n<!--([a-z_]+)-->\n(?=\{"criterion":"([a-z_]+)")/g

function recoverScoresCommentLine(obj: Record<string, unknown>): Record<string, unknown> | null {
  const raw = obj.scores
  if (typeof raw !== "string" || !raw.includes("<!--")) return null
  const linhas = [...raw.matchAll(COMMENT_LINE)]
  if (linhas.length === 0 || linhas.some((m) => m[1] !== m[2])) return null
  const limpo = raw.replace(COMMENT_LINE, "\n")
  if (limpo.includes("<!--") || limpo.includes("-->")) return null // comentário fora da forma
  // O parse é a PROVA de que cada comentário estava fora de string: dentro dela, a quebra de linha
  // que sobra seria `\n` cru, e JSON não a aceita.
  try {
    return { ...obj, scores: JSON.parse(limpo) }
  } catch {
    return null
  }
}

/** Os 11 critérios, cada um uma vez, com a forma exata do schema da tool. */
function scoresCompletos(scores: unknown, criterionSlugs: readonly string[]): boolean {
  if (!Array.isArray(scores) || scores.length !== criterionSlugs.length) return false
  const vistos = new Set<string>()
  for (const s of scores) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return false
    const r = s as Record<string, unknown>
    if (Object.keys(r).sort().join() !== "criterion,justification,score") return false
    if (typeof r.criterion !== "string" || !criterionSlugs.includes(r.criterion) || vistos.has(r.criterion)) return false
    if (typeof r.score !== "number" || !Number.isFinite(r.score) || r.score < 0 || r.score > 10) return false
    if (typeof r.justification !== "string") return false
    vistos.add(r.criterion)
  }
  return vistos.size === criterionSlugs.length
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
  opts: RecoveryOptions = {},
): { value: unknown; recovered: PayloadRecovery[] } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { value: input, recovered: [] }
  }
  let obj = input as Record<string, unknown>
  const recovered: PayloadRecovery[] = []

  // O vazamento do payload inteiro vem antes da regra 1: as duas olham o summary, e a regra 1 recusa
  // sozinha quando há mais de uma marcação de parâmetro — nunca concorrem.
  const leak = recoverPayloadLeakedIntoSummary(obj, opts)
  if (leak) {
    obj = leak.obj
    recovered.push(leak.nome)
  } else {
    const withConfidence = recoverLeakedConfidence(obj)
    if (withConfidence) {
      obj = withConfidence
      recovered.push("confidence_leaked_into_summary")
    }
  }
  const withComment = recoverScoresCommentLine(obj)
  if (withComment) {
    obj = withComment
    recovered.push("scores_comment_line")
  }
  const withScores = recoverScoresWithRawQuotes(obj, criterionSlugs)
  if (withScores) {
    obj = withScores.obj
    recovered.push(withScores.multiline ? "scores_unescaped_quotes_multiline" : "scores_unescaped_quotes")
  }

  // As regras novas não entregam payload incompleto: sem os 11, nada é recuperado.
  const NOVAS: PayloadRecovery[] = [
    "payload_leaked_into_summary",
    "payload_and_art_leaked_into_summary",
    "scores_comment_line",
    "scores_unescaped_quotes_multiline",
  ]
  if (recovered.some((r) => NOVAS.includes(r)) && !scoresCompletos(obj.scores, criterionSlugs)) {
    return { value: input, recovered: [] }
  }

  return { value: recovered.length ? obj : input, recovered }
}
