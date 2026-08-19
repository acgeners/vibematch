/**
 * Higieniza texto vindo de FORA antes de ele virar linha no Postgres.
 *
 * 🔴 Não é preciosismo — foi medido derrubando uma avaliação paga. Em 2026-08-18
 * (nuvem, obra "The Baby Fairy Is a Villainess"), duas escritas voltaram **400**:
 *
 *   POST  /rest/v1/work_reviews    → o Postgres recusou o corpo:
 *         `invalid input syntax for type json`
 *         DETAIL: "Unicode low surrogate must follow a high surrogate."
 *   PATCH /rest/v1/ai_evaluations  → o PostgREST recusou antes mesmo do banco
 *         (o MESMO texto, embutido no `raw_response`).
 *
 * A origem é o `.slice(0, 900)` que todo conector de review aplica: ele corta por
 * **unidade UTF-16**, então cortar no meio de um emoji deixa metade de um par
 * surrogate. `JSON.stringify` preserva essa metade, e nem o parser do PostgREST
 * nem o do Postgres a aceitam — o UTF-8 do banco não tem como representá-la. O
 * caractere NUL (`\x00`) é rejeitado pelo mesmo motivo, em qualquer coluna de texto.
 *
 * ⚠️ O caractere quebrado é INVISÍVEL: a string parece normal em log e em tela, o
 * `tsc` não vê nada, e a escrita falha INTEIRA por causa de um caractere que
 * ninguém consegue apontar. É a família "erro que produz resultado" — quem chamava
 * seguia em frente com a linha meio gravada.
 */

// Fast path: a esmagadora maioria dos textos não tem NUL nem surrogate nenhum, e
// aí a string original é devolvida sem cópia.
const RISKY = /[\x00\uD800-\uDFFF]/

/**
 * Remove surrogates DESEMPARELHADOS e o caractere NUL. Par válido (emoji inteiro)
 * passa intacto — o que sai é só o que o Postgres não teria como armazenar.
 */
export function pgSafeText(value: string): string
export function pgSafeText(value: string | null): string | null
export function pgSafeText(value: string | null | undefined): string | null | undefined
export function pgSafeText(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string" || !RISKY.test(value)) return value

  let out = ""
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0) continue
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1]
        i++
        continue
      }
      continue // high sem low
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue // low sem high
    out += value[i]
  }
  return out
}

/**
 * O mesmo, recursivo, para o objeto inteiro que vai virar `jsonb` — um único texto
 * quebrado lá no fundo derruba a COLUNA toda, então higienizar só o campo
 * "principal" não serve. As CHAVES também passam (o Postgres as recusa igual).
 */
export function pgSafeDeep<T>(value: T): T {
  if (typeof value === "string") return pgSafeText(value) as T
  if (Array.isArray(value)) return value.map((v) => pgSafeDeep(v)) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[pgSafeText(k)] = pgSafeDeep(v)
    }
    return out as T
  }
  return value
}
