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
 *
 * ## Exclusão (`pub_status_exclude` / `per_status_exclude`)
 *
 * Até então "todos menos Cancelled" só existia como EFEITO de marcar os outros quatro —
 * a exibição sabia dizer "todos menos X" (`pushStatusChips`), a ação não existia. O par
 * `_exclude` torna a exclusão uma escolha própria, e a diferença **não é cosmética**:
 * uma lista positiva ignora um status que entre depois em `publication_status`; a
 * exclusão o adota. É a mesma razão pela qual `"all"` existe em vez de listar todos.
 *
 * 🔴 **Incluir e excluir são EXCLUSIVOS por dimensão** — o `_exclude` vence e o positivo
 * é ignorado quando os dois vêm preenchidos (URL montada à mão, preset antigo). Num
 * conjunto fechado "incluir A,B" e "excluir C,D,E" são a mesma coisa, então manter os
 * dois só produz filtro que não filtra, ocupando vaga em "Filtros ativos" e sujando o
 * preset salvo. Quem escreve na URL usa `setStatusRule`, que já limpa o outro lado.
 */

/**
 * Os DOIS parâmetros de cada dimensão, num lugar só. Todo leitor da query string do
 * /ranking sai daqui: `parseFiltersFromSearchParams` (rerank/recomendação), as páginas
 * /ranking e /favorites, e o painel de filtros. Enumerar de novo é como um param que a
 * UI escreve deixa de ser lido pela recomendação — e aí ela roda com um filtro
 * diferente do que a tela mostra, sem erro e sem log.
 *
 * Guardado por tests/unit/orchestration/status-filter-params.test.ts.
 */
export const STATUS_FILTER_PARAMS = {
  publication: { include: "pub_status", exclude: "pub_status_exclude" },
  personal: { include: "per_status", exclude: "per_status_exclude" },
} as const

export type StatusFilterKind = keyof typeof STATUS_FILTER_PARAMS

/** O que uma dimensão de status pede ao servidor. Os dois campos nunca vêm juntos. */
export interface StatusFilterSelection {
  /** Lista positiva (`in`). `undefined` = sem restrição positiva. */
  include?: string[]
  /** Exclusão (`not in`). `undefined` = nada excluído. */
  exclude?: string[]
}

function csv(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(",").map((s) => s.trim()).filter(Boolean)
}

function parseSelection(
  current: string | null | undefined,
  options: readonly string[],
  defaults: readonly string[]
): Set<string> {
  if (current === "all") return new Set(options)
  if (current != null && current !== "") return new Set(csv(current))
  return new Set(defaults)
}

/**
 * Lê os dois parâmetros de uma dimensão e devolve o que vai pro `RankingFilters`.
 *
 * `defaults` é o padrão DA PÁGINA quando o parâmetro está ausente (`["Completed"]` no
 * /ranking, nada no /favorites) — a exclusão não tem default: ausente é ausente.
 */
export function readStatusFilter(
  get: (key: string) => string | null | undefined,
  kind: StatusFilterKind,
  defaults: readonly string[] = []
): StatusFilterSelection {
  const keys = STATUS_FILTER_PARAMS[kind]
  const exclude = csv(get(keys.exclude))
  if (exclude.length > 0) return { exclude }

  const raw = get(keys.include)
  if (raw === "all") return {}
  const include = raw != null && raw !== "" ? csv(raw) : [...defaults]
  return include.length > 0 ? { include } : {}
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
  return canonicalSelection(next, options)
}

/** Vazio e "cobre tudo" têm a MESMA forma canônica: `"all"` (ver o doc do toggle). */
function canonicalSelection(selection: Set<string>, options: readonly string[]): string {
  if (selection.size === 0) return "all"
  if (options.every((option) => selection.has(option))) return "all"
  return [...selection].join(",")
}

/** Estado de um status na UI: na lista positiva, na de exclusão, ou em nenhuma. */
export type StatusRule = "include" | "exclude" | null

/**
 * Os updates de URL para pôr `status` na regra pedida — os DOIS parâmetros da dimensão,
 * sempre. É aqui que mora a exclusividade: ligar um lado limpa o outro.
 *
 * Recebe a regra ALVO, não um toggle: quem chama já sabe o estado atual do chip e passa
 * `null` para desfazer. Toggle embutido aqui exigiria adivinhar de qual dos dois lados o
 * clique veio (o `−` e o nome do pill são alvos diferentes no mesmo chip).
 *
 * Excluir TODAS as opções equivale a "nenhuma obra" — não é tela útil, e nem é
 * alcançável pelos chips positivos (lá o vazio vira `"all"`), então a última exclusão
 * possível volta a exclusão nenhuma, no mesmo espírito do `"all"`.
 */
export function setStatusRule(
  kind: StatusFilterKind,
  current: { include: string | null | undefined; exclude: string | null | undefined },
  status: string,
  rule: StatusRule,
  options: readonly string[],
  defaults: readonly string[]
): Record<string, string | null> {
  const keys = STATUS_FILTER_PARAMS[kind]
  const excluded = new Set(csv(current.exclude))
  const hadExclusion = excluded.size > 0

  if (rule === "exclude") {
    excluded.add(status)
    if (options.every((option) => excluded.has(option))) {
      return { [keys.include]: null, [keys.exclude]: null }
    }
    return { [keys.include]: null, [keys.exclude]: [...excluded].join(",") }
  }

  if (rule === null && excluded.has(status)) {
    excluded.delete(status)
    return { [keys.exclude]: excluded.size ? [...excluded].join(",") : null }
  }

  // 🔴 Saindo do modo exclusão, a lista positiva começa VAZIA — não nos defaults da
  // página nem em `"all"`. Materializar qualquer um dos dois marcaria de uma vez chips
  // que o usuário não pediu: com `"all"`, o clique em "Completed" acabaria DESMARCANDO
  // Completed (o oposto do gesto); com os defaults, "Completed" apareceria sozinho
  // mesmo quando o clique foi em "Ongoing".
  const selection = hadExclusion
    ? new Set<string>()
    : parseSelection(current.include, options, defaults)

  if (rule === null) selection.delete(status)
  else selection.add(status)

  return { [keys.include]: canonicalSelection(selection, options), [keys.exclude]: null }
}
