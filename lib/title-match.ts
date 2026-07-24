/**
 * Normalização ÚNICA de títulos, compartilhada pela busca de /titles e pela
 * detecção de duplicata de /titles/new.
 *
 * Por que existe: as duas coisas tinham normalização própria (`normalizeTitleMatch`
 * em server/actions/works.ts e `normalizeTitleSearchMatch` em server/queries/works.ts,
 * ambas só `trim().toLowerCase()`), e a busca do ranking ainda tokenizava por conta
 * própria exigindo os tokens EM ORDEM. Resultado: "Ladys Risque" não achava
 * "A Lady's Risqué Hobby" — e, pior, a duplicata acusava obra que a busca jurava
 * não existir. Divergir aqui produz um bug MUDO (a busca "funciona", só devolve
 * menos), então as duas passam a importar deste módulo.
 *
 * ⚠️ Isto resolve o casamento de nomes. NÃO resolve o caso em que a obra salva
 * simplesmente não tem o alias guardado — pra isso existe o backfill de
 * `alternative_titles` e a auto-cura em `createWork`.
 */

/**
 * Dobra o texto pra uma forma comparável: minúsculo, sem acento, sem pontuação,
 * espaços colapsados.
 *
 * `NFD` separa a letra do acento (é → e + ́ ) e o range ̀-ͯ apaga o acento
 * solto. Sem isto, "Risqué" e "Risque" são strings diferentes pro JS.
 */
export function foldTitle(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Pontuação, símbolos e separadores viram espaço (não somem): "Ero♥Märchen"
    // precisa virar "ero marchen" e não "eromarchen", senão o token "marchen"
    // não casa mais.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
}

/** Tokens comparáveis de um nome. `[]` quando não sobra nada. */
export function titleTokens(value: string | null | undefined): string[] {
  const folded = foldTitle(value)
  return folded ? folded.split(" ") : []
}

/**
 * Forma compacta: dobrada e SEM espaço nenhum. "A Lady's Risqué Hobby" →
 * "aladysrisquehobby".
 */
export function foldCompact(value: string | null | undefined): string {
  return foldTitle(value).replace(/ /g, "")
}

/**
 * Abaixo disto o fallback compacto não roda. Com 3 letras "the" viraria substring
 * de meio catálogo; com 4+ a busca contígua já é específica o bastante.
 */
const MIN_COMPACT_QUERY = 4

/**
 * A consulta casa o nome?
 *
 * Duas regras, nesta ordem:
 *
 * 1. **Prefixo de palavra, ordem livre** — todo token da busca tem que começar
 *    alguma palavra do nome. "script villainess" acha "The Villainess Flips the
 *    Script". Prefixo (e não substring solta) evita que "ma" case com "drama" e
 *    traga meio catálogo, mas ainda deixa digitar pela metade ("villain" acha
 *    "villainess") — que é o que faz a busca ao-vivo parecer viva.
 *
 * 2. **Fallback compacto** — a busca inteira, sem espaço, como substring do nome
 *    sem espaço. Existe por causa do apóstrofo: "A Lady's Risqué Hobby" tokeniza
 *    em `lady` + `s`, e quem digita "Ladys Risque" não casa prefixo nenhum. Só
 *    roda com 4+ caracteres, senão "the" casaria com tudo.
 */
export function nameMatchesQuery(name: string | null | undefined, queryTokens: string[]): boolean {
  if (!queryTokens.length) return false
  const nameTokens = titleTokens(name)
  if (!nameTokens.length) return false

  if (queryTokens.every((qt) => nameTokens.some((nt) => nt.startsWith(qt)))) return true

  const compactQuery = queryTokens.join("")
  if (compactQuery.length < MIN_COMPACT_QUERY) return false
  return nameTokens.join("").includes(compactQuery)
}

/** Os nomes pelos quais uma obra pode ser encontrada. */
export interface MatchableWorkNames {
  title?: string | null
  original_title?: string | null
  alternative_titles?: string[] | null
}

export function workNameList(work: MatchableWorkNames): string[] {
  return [work.title, work.original_title, ...(work.alternative_titles ?? [])].filter(
    (n): n is string => Boolean(n && n.trim()),
  )
}

/** A obra casa a busca por qualquer um dos seus nomes? */
export function workMatchesQuery(work: MatchableWorkNames, queryTokens: string[]): boolean {
  return workNameList(work).some((name) => nameMatchesQuery(name, queryTokens))
}

/**
 * Qual nome da obra casou a busca — pro dropdown poder dizer "achou por: 악당과의
 * 육아일기" quando o casamento veio de um título alternativo. Sem isto o usuário vê
 * um nome que não tem nada a ver com o que ele digitou.
 *
 * Devolve `null` quando quem casou foi o `title` (aí não há o que explicar).
 */
export function matchedAliasFor(work: MatchableWorkNames, queryTokens: string[]): string | null {
  if (nameMatchesQuery(work.title, queryTokens)) return null
  const alias = workNameList(work).find((name) => nameMatchesQuery(name, queryTokens))
  return alias ?? null
}

/**
 * Faixa de qualidade do casamento, pra ordenar as sugestões:
 *   3 = nome idêntico · 2 = começa com a busca · 1 = casa os tokens · 0 = não casa
 *
 * Só o `title` ganha o bônus de faixa alta; um alias que casa exato continua
 * valendo mais que um token solto, mas menos que o título principal — senão obra
 * cujo alias é uma palavra genérica sobe na frente da que você quer.
 */
export function matchTier(work: MatchableWorkNames, rawQuery: string): 0 | 1 | 2 | 3 {
  const foldedQuery = foldTitle(rawQuery)
  if (!foldedQuery) return 0
  const queryTokens = foldedQuery.split(" ")

  let best: 0 | 1 | 2 | 3 = 0
  const primary = foldTitle(work.title)
  if (primary === foldedQuery) return 3
  if (primary.startsWith(foldedQuery)) best = 2

  for (const name of workNameList(work)) {
    const folded = foldTitle(name)
    if (!folded) continue
    if (folded === foldedQuery) best = best < 2 ? 2 : best
    else if (folded.startsWith(foldedQuery) && best < 2) best = 1
    else if (best < 1 && nameMatchesQuery(name, queryTokens)) best = 1
  }
  return best
}

// ---------------------------------------------------------------------------
// Chaves de DUPLICATA
// ---------------------------------------------------------------------------

/**
 * Aliases genéricos demais pra provar que duas obras são a mesma. "Official",
 * "English" e afins aparecem em dezenas de obras — casar por eles junta obras que
 * não têm nada a ver.
 */
const WEAK_DUPLICATE_ALIAS_KEYS = new Set([
  "status",
  "official",
  "english",
  "korean",
  "japanese",
  "chinese",
  "novel",
  "webtoon",
  "oneshot",
  "one shot",
  "promo",
  "promo art",
])

export function isWeakDuplicateAlias(foldedKey: string): boolean {
  return WEAK_DUPLICATE_ALIAS_KEYS.has(foldedKey)
}

/**
 * Acima disto um alias fragmento continua sendo chave de duplicata. Com 1-2
 * palavras ("Your Majesty", "Duke", "Your Highness") o alias é quase sempre um
 * honorífico ou pedaço solto de um nome mais longo — não prova identidade. Com 3+
 * palavras já é específico o bastante pra provar ("My Unexpected Marriage").
 */
const MAX_FRAGMENT_ALIAS_TOKENS = 2

/**
 * O alias é um pedaço curto de um nome mais LONGO da própria obra?
 *
 * Fontes externas quebram títulos na vírgula: "Your Majesty, Your Territory Is
 * Not Good" entra como "Your Majesty" + "Your Territory Is Not Good". O primeiro
 * fragmento ("your majesty") reaparece em dezenas de obras do gênero e, como
 * chave de duplicata, casava obras que não têm nada a ver — e a auto-cura então
 * fundia os aliases das duas. Prefixo/sufixo em fronteira de palavra (não
 * substring solta, senão "art" casaria "smart").
 */
function isShortFragmentOfLongerName(key: string, allFoldedNames: string[]): boolean {
  if (!key || key.split(" ").length > MAX_FRAGMENT_ALIAS_TOKENS) return false
  return allFoldedNames.some(
    (other) => other !== key && (other.startsWith(key + " ") || other.endsWith(" " + key)),
  )
}

/**
 * Chaves normalizadas pelas quais uma obra é considerada duplicata de outra:
 * título e título original sempre; aliases só quando não são genéricos NEM
 * fragmento curto de um nome mais longo da própria obra.
 *
 * Duplicata compara IGUALDADE de chave (não prefixo) — "Villain Duke" não pode
 * bloquear o cadastro de "Villain Duke's Precious One".
 */
export function duplicateKeys(work: MatchableWorkNames): string[] {
  const strong = [work.title, work.original_title]
    .map(foldTitle)
    .filter(Boolean)

  const allFoldedNames = [work.title, work.original_title, ...(work.alternative_titles ?? [])]
    .map(foldTitle)
    .filter(Boolean)

  const aliases = (work.alternative_titles ?? [])
    .map(foldTitle)
    .filter((key) => key && !isWeakDuplicateAlias(key))
    // Título/original nunca caem nesta regra — só o pacote de aliases.
    .filter((key) => !isShortFragmentOfLongerName(key, allFoldedNames))

  return [...new Set([...strong, ...aliases])]
}
