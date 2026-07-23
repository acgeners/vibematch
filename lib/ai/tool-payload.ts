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
