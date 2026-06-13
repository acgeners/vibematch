/**
 * Remove surrogates UTF-16 não-pareados de uma string.
 *
 * Caracteres fora do BMP (emoji, alguns CJK) são um par high (\uD800–\uDBFF) +
 * low (\uDC00–\uDFFF). Truncar texto por code unit (vários `.slice(0, N)` em
 * `lib/external/*` sobre reviews/comentários raspados) pode cortar no meio do
 * par e deixar uma metade órfã. Essa metade é UTF-8/JSON inválida e faz a API
 * da Anthropic responder 400 "The request body is not valid JSON: no low
 * surrogate in string". Aqui removemos a metade solta (o outro lado já se
 * perdeu, então não há caractere a recuperar).
 */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function stripLoneSurrogates(value: string): string {
  return value.replace(LONE_SURROGATE, "")
}

/**
 * Aplica `stripLoneSurrogates` recursivamente em todas as strings de um payload
 * (string/array/objeto plano), retornando uma cópia limpa. Defesa central usada
 * antes de serializar o corpo das requisições à Anthropic — independente de qual
 * truncamento upstream introduziu o surrogate solto.
 */
export function deepStripLoneSurrogates<T>(value: T): T {
  if (typeof value === "string") {
    return stripLoneSurrogates(value) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepStripLoneSurrogates(item)) as unknown as T
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      out[key] = deepStripLoneSurrogates(val)
    }
    return out as T
  }
  return value
}
