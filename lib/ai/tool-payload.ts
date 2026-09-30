/**
 * Desfaz o duplo-encode do payload de uma tool. O modelo às vezes entrega um
 * campo estruturado como STRING de JSON (`"scores": "[{...}]"`, `"rankings":
 * "[{...}]"`) — ou o input inteiro como string — mesmo com `input_schema`
 * correto (`type: "array"` + `items`). Visto em produção 2026-07-22 com
 * sonnet-5: `stop_reason: "tool_use"` (ou seja, resposta COMPLETA, não
 * truncada) e o Zod reprovando com "expected array, received string".
 *
 * Descartar isso significa jogar fora uma resposta inteira já paga por uma
 * questão de codificação, com o dado todo ali. Mesmo espírito do
 * `enforceAuditableReviewUsage`, que deixou de ser fatal pelo mesmo motivo.
 *
 * Só recupera o que de fato é JSON válido: prosa numa string continua reprovando
 * no schema (aí o dado realmente não veio). Puro e sem efeito colateral — quem
 * chama decide o que logar.
 *
 * `fields` são os campos de 1º nível a tentar desembrulhar (default = os da
 * avaliação IA). O fluxo de recomendação passa `["rankings"]`. O desembrulho do
 * input INTEIRO como string acontece sempre, antes dos campos.
 */
export function coerceToolPayload(
  input: unknown,
  fields: readonly string[] = ["scores", "reviewUsage", "review_usage"],
): { value: unknown; coerced: string[] } {
  const coerced: string[] = []
  const parseIfJson = (v: unknown, label: string): unknown => {
    if (typeof v !== "string") return v
    try {
      const parsed: unknown = JSON.parse(v)
      // Só aceita se virou estrutura. `JSON.parse('"texto"')` devolve string e
      // `JSON.parse('7')` devolve número — nenhum dos dois é o que se perdeu aqui.
      if (parsed === null || typeof parsed !== "object") return v
      coerced.push(label)
      return parsed
    } catch {
      return v
    }
  }

  const top = parseIfJson(input, "input")
  if (top === null || typeof top !== "object" || Array.isArray(top)) return { value: top, coerced }

  const obj = { ...(top as Record<string, unknown>) }
  for (const field of fields) {
    if (field in obj) obj[field] = parseIfJson(obj[field], field)
  }
  return { value: obj, coerced }
}

// ── Diagnóstico de payload RECUSADO ─────────────────────────────────────────────────────────

/**
 * Teto do payload guardado quando a resposta é recusada, em CODE POINTS. Medido: o maior
 * payload recusado real (v31) tem 4.209 caracteres, e a saída inteira da avaliação é limitada
 * a `max_tokens: 4500` (~18 mil caracteres no pior caso). 16 mil guarda todo caso observado
 * com folga de 3,8× sem deixar uma resposta patológica virar dezenas de KB — e isso importa
 * porque `/curation/ai-usage` lê a `metadata` INTEIRA de cada chamada do período.
 */
export const PAYLOAD_RECUSADO_MAX_CODE_POINTS = 16_000
const MOTIVO_MAX_CODE_POINTS = 2_000

/** Por que a resposta paga foi descartada. Erro de provider/rede NÃO entra aqui: esse já é
 *  `status: error` na própria linha, e nunca chega ao parse. */
export type ClassePayloadRecusado = "schema" | "sem_tool" | "pos_processamento"

export interface PayloadRecusado {
  versao: 1
  classe: ClassePayloadRecusado
  motivo: string
  /** Campo de 1º nível → tipo recebido (`array`, `string`, `number`, `null`…). */
  campos: Record<string, string>
  /** Campo de 1º nível que chegou como texto com cara de JSON e não parseia → erro do parse.
   *  É o que separa "JSON interno quebrado" de "o modelo mandou prosa". */
  json_invalido?: Record<string, string>
  /** O input CRU da tool, serializado ANTES de qualquer coerção — o que o modelo mandou. */
  bruto: string
  truncado: boolean
  /** Tamanho do serializado inteiro, em code points (antes do corte). */
  tamanho: number
  /** Presente quando a recuperação de payload (`tool-payload-recovery.ts`) salvou esta resposta
   *  sem retentativa: as formas aplicadas. O `bruto` continua sendo o ORIGINAL recusado. */
  recuperado?: string[]
}

/**
 * Corta por CODE POINT, nunca por unidade UTF-16: `.slice(0, n)` parte um emoji ao meio e a
 * metade órfã derruba a escrita inteira no Postgres (ver `lib/text/pg-safe-text.ts`).
 */
export function truncarPorCodePoint(texto: string, max: number): { texto: string; truncado: boolean; tamanho: number } {
  let tamanho = 0
  let corte = -1
  for (let i = 0; i < texto.length; i++) {
    if (tamanho === max) corte = i
    const c = texto.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = texto.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) i++
    }
    tamanho++
  }
  if (tamanho <= max) return { texto, truncado: false, tamanho }
  return { texto: texto.slice(0, corte), truncado: true, tamanho }
}

function tipoDe(v: unknown): string {
  if (v === null) return "null"
  if (Array.isArray(v)) return "array"
  return typeof v
}

/** Mensagem do `JSON.parse` para texto que PARECE estrutura; `null` se parseia ou não parece. */
function erroDeJson(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!(t.startsWith("{") || t.startsWith("["))) return null
  try {
    JSON.parse(t)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/**
 * Descreve a resposta recusada para ela sobreviver ao descarte. Sem isto a única pista era a
 * mensagem do Zod com 120 caracteres de preview — medido na v31: 7 das 9 recusas ficaram sem
 * causa observável. Puro: quem chama decide onde gravar.
 */
export function descreverPayloadRecusado(
  input: unknown,
  motivo: string,
  classe: ClassePayloadRecusado,
): PayloadRecusado {
  const objeto = input !== null && typeof input === "object" && !Array.isArray(input)
  const campos: Record<string, string> = objeto
    ? Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, tipoDe(v)]))
    : { "(input)": tipoDe(input) }

  const json_invalido: Record<string, string> = {}
  const entradas: Array<[string, unknown]> = objeto ? Object.entries(input as Record<string, unknown>) : [["(input)", input]]
  for (const [k, v] of entradas) {
    const erro = erroDeJson(v)
    if (erro) json_invalido[k] = erro
  }

  const serializado = typeof input === "string" ? input : (JSON.stringify(input) ?? String(input))
  const bruto = truncarPorCodePoint(serializado, PAYLOAD_RECUSADO_MAX_CODE_POINTS)
  return {
    versao: 1,
    classe,
    motivo: truncarPorCodePoint(motivo, MOTIVO_MAX_CODE_POINTS).texto,
    campos,
    ...(Object.keys(json_invalido).length > 0 ? { json_invalido } : {}),
    bruto: bruto.texto,
    truncado: bruto.truncado,
    tamanho: bruto.tamanho,
  }
}
