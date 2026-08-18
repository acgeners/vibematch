/**
 * Normalização conservadora do título de uma obra: tira espaço das pontas e conserta a
 * caixa das palavras que estão erradas por QUALQUER padrão de título em inglês.
 *
 * 🔴 O desenho que a torna segura: ela **só toca palavras que estão nas duas listas
 * abaixo**. Não é "aplicar title case no título" — é corrigir 30 palavras conhecidas e
 * copiar o resto byte a byte. Título estilizado de propósito, romanização, sigla, nome
 * próprio e as preposições de 4+ letras passam intactos **por construção**, não por uma
 * exceção que alguém lembrou de escrever.
 *
 * ## Por que estas duas listas, e não um padrão inteiro
 *
 * Medido em 2026-08-17 nas 988 obras do catálogo, contando a caixa de cada palavra em
 * posição do MEIO do título:
 *
 * | palavra | maiúscula | minúscula |
 * |---|---|---|
 * | the · a · of · to · and | 9 · 3 · 2 · 2 · 0 | 273 · 120 · 108 · 89 · 38 |
 * | My · Your · Is · This | 73 · 25 · 47 · 21 | 0 · 0 · 4 · 1 |
 * | With · Into · From | 45 · 10 · 5 | 8 · 5 · 3 |
 *
 * As duas primeiras linhas são consenso do próprio catálogo (é o padrão AP: minúscula em
 * artigo/preposição/conjunção de até 3 letras, maiúscula no resto) e viram as listas. A
 * TERCEIRA linha fica de fora de propósito: `with`/`from`/`into` são preposições de 4+
 * letras, onde AP e Chicago DISCORDAM, e o catálogo está dividido. Padronizá-las mexeria
 * em ~60 títulos que hoje concordam entre si para resolver uma discussão de estilo —
 * decidido em 2026-08-17 não fazer ([[project-padronizar-titulos-das-obras]]).
 *
 * ⚠️ **A regra ingênua ("palavrinha no meio → minúscula") tem 50% de falso positivo.** Das
 * 18 obras que ela acusava, 9 estavam CERTAS: a palavra vinha logo depois de dois-pontos
 * ou travessão (`Cassmire: The Loyal Sword`, `Regina Rena: To the Unforgiven`), onde
 * começa um subtítulo e a maiúscula é obrigatória. Daí `depoisDeFronteira`.
 */

/**
 * Artigo, preposição e conjunção de até 3 letras — minúsculas no MEIO do título.
 * É a lista do padrão AP, que é o que o catálogo já pratica (ver a tabela acima).
 *
 * ⚠️ `so` e `yet` são conjunções curtas e caberiam aqui pela regra, mas ficaram de fora:
 * nenhuma ocorrência foi medida, e lista maior que a evidência é como se corrige o que
 * ninguém conferiu.
 */
const MINUSCULA_NO_MEIO = new Set([
  "a", "an", "the",
  "and", "but", "or", "nor",
  "of", "to", "in", "on", "at", "by", "as", "for",
])

/**
 * Verbo, auxiliar, demonstrativo e pronome — maiúsculos em QUALQUER posição.
 *
 * Nenhum padrão de título discorda disto: o que se rebaixa em título é artigo, preposição
 * e conjunção, nunca verbo nem pronome. `Divorce is the Condition` e `Can I be a Sex
 * Slave` estão errados em AP, em Chicago e em qualquer manual.
 */
const MAIUSCULA_SEMPRE = new Set([
  // verbo "to be" e auxiliares
  "is", "be", "am", "are", "was", "were", "been", "being",
  "do", "does", "did", "has", "have", "had",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  // demonstrativos
  "this", "that", "these", "those",
  // pronomes e possessivos
  "i", "me", "my", "mine", "you", "your", "yours",
  "he", "him", "his", "she", "her", "hers", "it", "its",
  "we", "us", "our", "ours", "they", "them", "their", "theirs",
])

/**
 * Depois destes, a palavra seguinte fica como está — ou porque abre um subtítulo (`:` `-`
 * `–` `—`), ou porque abre uma oração nova (`,` `;` `.` `?` `!`).
 *
 * ⚠️ A VÍRGULA é ESCOLHA da curadora (2026-08-17), não regra de manual — AP e Chicago
 * mandariam minúscula, porque conjunção é conjunção em qualquer posição. O caso concreto é
 * `I'm Married into a Family of Tyrants, But Isn't Their Obsession…`: rebaixar aquele `But`
 * é tecnicamente correto e a única coisa que consegue é chamar atenção para si. Custo
 * medido de incluí-la: **1 título a menos no plano, 20 → 19** — nenhum outro caso do
 * catálogo tem palavra da lista logo depois de vírgula.
 */
const FRONTEIRA = /[:\-–—?!.;,]$/

/**
 * 🔴 A fronteira também pode ser PREFIXO do próprio token, e a 1ª versão só olhava o
 * sufixo do token anterior. Pego pelo ensaio contra o catálogo real:
 * `Nullitas ~The Counterfeit Bride~` viraria `~the Counterfeit Bride~` — o `~` abre um
 * subtítulo exatamente como o dois-pontos, mas gruda na palavra em vez de ficar solto.
 *
 * A régua é ampla de propósito — QUALQUER prefixo não-alfabético conta como abertura
 * (`~The`, `(The`, `"The`, `[The`). O erro que ela pode cometer é deixar de corrigir uma
 * palavra, nunca estragar uma que estava certa; e esse é o lado barato.
 */
function abreSegmento(prefixo: string): boolean {
  return prefixo.length > 0
}

/** Separa prefixo/sufixo não-alfabético do miolo: `"(the"`, `"the,"`, `"Beast!"`. */
const TOKEN = /^([^\p{L}]*)([\p{L}'’]+)([^\p{L}]*)$/u

/**
 * ⚠️ Palavra com maiúscula INTERNA fica intacta — é o que protege sigla (`XXX`, `OOTD`),
 * caixa toda alta e nome próprio estilizado (`McCoy`). Uma checagem só cobre os três, e
 * cobre também a sigla que ninguém previu.
 */
function temMaiusculaInterna(miolo: string): boolean {
  const resto = miolo.slice(1)
  return resto !== resto.toLowerCase()
}

export function normalizeWorkTitle(titulo: string): string {
  // `split` com captura preserva o espaçamento original: a função muda CAIXA e as pontas,
  // nunca o espaço interno. Colapsar espaço duplo aqui seria uma segunda mudança viajando
  // de carona na primeira.
  const partes = titulo.trim().split(/(\s+)/)
  const indicesDePalavra = partes.map((p, i) => (p.trim() ? i : -1)).filter((i) => i >= 0)

  for (let n = 0; n < indicesDePalavra.length; n++) {
    const i = indicesDePalavra[n]
    const m = partes[i].match(TOKEN)
    if (!m) continue // token sem letra nenhuma ("-", "&", "★")

    const [, antes, miolo, depois] = m
    if (temMaiusculaInterna(miolo)) continue

    const chave = miolo.toLowerCase().replace(/[’]/g, "'")
    const primeira = n === 0
    const ultima = n === indicesDePalavra.length - 1
    const depoisDeFronteira =
      abreSegmento(antes) || (n > 0 && FRONTEIRA.test(partes[indicesDePalavra[n - 1]]))

    let novo: string | null = null
    if (MAIUSCULA_SEMPRE.has(chave)) {
      novo = miolo.charAt(0).toUpperCase() + miolo.slice(1)
    } else if (MINUSCULA_NO_MEIO.has(chave) && !primeira && !ultima && !depoisDeFronteira) {
      novo = miolo.toLowerCase()
    }

    if (novo != null && novo !== miolo) partes[i] = `${antes}${novo}${depois}`
  }

  return partes.join("")
}

/** `null` quando não há nada a corrigir — o chamador não precisa comparar de novo. */
export function titleFixOrNull(titulo: string): string | null {
  const novo = normalizeWorkTitle(titulo)
  return novo === titulo ? null : novo
}
