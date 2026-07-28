/**
 * Semântica dos filtros de status por chip (`pub_status` / `per_status` na URL).
 *
 * O parâmetro tem TRÊS formas, e a diferença entre elas é o que faz o toggle parecer
 * mágico quando errado:
 *
 * | valor        | significa                              | como a UI desenha        |
 * |--------------|----------------------------------------|--------------------------|
 * | ausente      | o padrão da página (ex.: `Completed`)  | só os chips do padrão    |
 * | `"all"`      | SEM filtro no servidor                 | TODOS os chips marcados  |
 * | `"a,b,c"`    | exatamente esses                       | esses chips marcados     |
 *
 * Como `"all"` desenha todos os chips marcados, clicar num deles tem que DESMARCAR só
 * aquele — e pra isso o `"all"` precisa ser materializado na lista de opções antes do
 * toggle. Sem isso o clique virava seleção ÚNICA (o oposto do que a UI prometia).
 */

function parseSelection(
  current: string | null | undefined,
  options: readonly string[],
  defaults: readonly string[]
): Set<string> {
  if (current === "all") return new Set(options)
  if (current != null && current !== "") {
    return new Set(current.split(",").map((s) => s.trim()).filter(Boolean))
  }
  return new Set(defaults)
}

/**
 * Devolve o novo valor do parâmetro depois de clicar no chip `status`.
 *
 * `options` é a lista COMPLETA de status conhecidos — não só os visíveis. No status
 * pessoal os terminais (`Finished`, `Dropped`) não viram chip mas estão dentro do
 * `"all"`; materializar só os visíveis faria essas obras sumirem do ranking em silêncio.
 *
 * Volta a `"all"` em dois casos: quando a seleção passa a cobrir todas as opções (aí
 * `"all"` é a forma canônica — e a única que também alcança obra com status fora da
 * lista, ex. `publication_status_id` nulo) e quando a seleção fica vazia (filtro de
 * status sem nenhum valor não devolveria obra nenhuma, então equivale a "sem restrição").
 */
export function toggleStatusParam(
  current: string | null | undefined,
  status: string,
  options: readonly string[],
  defaults: readonly string[]
): string {
  const next = parseSelection(current, options, defaults)
  if (next.has(status)) next.delete(status)
  else next.add(status)

  if (next.size === 0) return "all"
  if (options.every((option) => next.has(option))) return "all"
  return [...next].join(",")
}
