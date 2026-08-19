/**
 * Dono ÚNICO da limpeza dos títulos alternativos: **quebra o que veio grudado** e dedupa.
 *
 * As 9 fontes externas não têm formato comum pra esse campo. AniList manda `synonyms`
 * (texto livre digitado por usuário), Comix e ComicK mandam `altTitles`/`md_titles`, e o
 * Mangago vem de uma linha de HTML. Quando alguém do outro lado escreve os cinco títulos
 * numa string só, o valor chega aqui como UM alias — e ele não é só feio: alias composto
 * **não casa com nada** em `foldTitle`, então não serve nem pra busca nem pra detecção de
 * duplicata, que é o motivo de o campo existir.
 *
 * Medido em 2026-08-18 nas 988 obras do clone local (10.072 alternativos):
 *
 * | forma | chips | é separador? |
 * |---|---|---|
 * | `" / "` (barra com espaço) | **8** | **sim, 8 de 8** — conferidos um a um |
 * | `"•"` (U+2022) | 2 | sim |
 * | `"/"` COLADO (`a/b`) | 2 | sim, mas ver abaixo |
 * | `"·"` (U+00B7) | 2 | **não** — é ponto médio DENTRO de nome chinês |
 * | `","` / `"，"` / `"、"` | 157 | **não** — pontuação interna do título |
 * | entidade HTML (`&amp;`) | 2 | — vira `&` |
 *
 * O caso que motivou isto (obra `Trash Will Always Be Trash`, na nuvem) tinha um chip de
 * 190 caracteres com cinco títulos separados por `" / "` — e os cinco **já estavam** na
 * lista como chips próprios, diferindo só na caixa e no apóstrofo curvo. Quebrado e
 * dedupado por `foldTitle`, o chip composto desaparece sem perder informação nenhuma.
 *
 * ## O que NÃO é separador, e por quê
 *
 * 🔴 **Barra COLADA (`Fate/Zero`) não quebra.** Os 2 casos medidos são de fato dois títulos
 * (`攻略精灵/攻略精靈`, simplificado e tradicional), mas o custo do erro é assimétrico:
 * deixar de quebrar 2 chips é um defeito cosmético, e quebrar `Fate/Zero` INVENTA duas obras
 * que não existem. Exigir espaço de pelo menos um lado é o que separa "lista" de "estilo".
 *
 * 🔴 **`;` só quebra seguido de espaço** — senão `Steins;Gate` vira duas. O Mangago quebrava
 * `;` colado E vírgula, e a vírgula custou caro: `Ni chasseuse, ni princesse !` está no
 * catálogo partido em dois chips, cada metade sem sentido. Vírgula é pontuação de título em
 * toda língua do catálogo (157 chips), nunca separador de lista.
 *
 * ⚠️ **Troca de escrita sem espaço NÃO é sinal de grude.** A tentação é quebrar
 * `…Hunting DogKiếp Này…` no ponto em que o alfabeto muda. Medido: 16 chips têm latim
 * encostado em CJK/hangul e **15 são legítimos** (`成为BL主人公的妹妹`, `夫をレベルMAXに育てようと思います`,
 * `作为NPC被困在…`). Só 1 é o defeito. Uma regra com 94% de falso positivo estragaria 15
 * títulos pra consertar um — o único chip grudado do catálogo fica como está.
 */


/**
 * Entidades que chegam cruas de fonte que serve HTML. São 2 chips no catálogo com `&amp;`
 * impresso na tela — mas o custo de decodificar é zero. Decodifica ANTES de quebrar:
 * `&#47;` é uma barra.
 *
 * ⚠️ **Nome de entidade vale SEM o ponto-e-vírgula**, e não é frouxidão: o próprio HTML5 as
 * aceita assim, e o catálogo tem o caso — a obra `The Regressed Demon Lord Is Kind` carrega
 * `"The Regressed Demon Lord is Kind /&nbsp"` e um chip inteiro que é só `"&nbsp"`.
 * Decodificado, ele vira espaço e o chip some sozinho; exigindo o `;`, sobraria um alias
 * literal `&nbsp` na tela. O numérico (`&#47`) continua exigindo o `;`, porque ali o dígito
 * seguinte é ambíguo.
 */
const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

function decodeEntidades(texto: string): string {
  if (!texto.includes("&")) return texto
  return texto.replace(/&(#x[0-9a-f]+;|#\d+;|[a-z]+;?)/gi, (inteiro, bruto: string) => {
    const corpo = bruto.replace(/;$/, "")
    if (corpo.startsWith("#")) {
      const code = corpo[1]?.toLowerCase() === "x"
        ? Number.parseInt(corpo.slice(2), 16)
        : Number.parseInt(corpo.slice(1), 10)
      // Fora do plano Unicode válido, devolve o texto original: inventar caractere é pior
      // do que deixar a entidade à mostra.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : inteiro
    }
    return ENTIDADES[corpo.toLowerCase()] ?? inteiro
  })
}

/**
 * Separadores de LISTA. Quebra linha, tabulação, `•`, `|` e `｜` sempre; `/` só com espaço
 * de pelo menos um lado; `;` só seguido de espaço. Ver o bloco acima para o motivo medido
 * de cada exclusão.
 */
const SEPARADOR = /[\n\r\t]+|\s*[•|｜]\s*|;\s+|\s+\/\s*|\s*\/\s+/

/** Um valor cru → os títulos que ele de fato contém. Sem separador, devolve ele mesmo. */
export function splitAlternativeTitle(raw: string): string[] {
  return decodeEntidades(raw)
    .split(SEPARADOR)
    .map((parte) => parte.trim())
    // Sem letra nem número não é título: é a ponta de uma string que terminava em separador.
    .filter((parte) => /[\p{L}\p{N}]/u.test(parte))
}

/**
 * Chave de dedup: só o que é INVISÍVEL na tela — caixa, aspas/apóstrofos curvos e espaço
 * repetido. É o suficiente para o caso que motivou tudo: quebrar `A / B / C` produz partes
 * que já existem na lista diferindo apenas em `’` contra `'` e na caixa.
 *
 * 🔴 **Não é `foldTitle`, e a diferença foi MEDIDA.** `foldTitle` (a régua de IDENTIDADE da
 * busca e da detecção de duplicata) apaga acento e pontuação, o que é certo para casar
 * nomes e errado para escolher qual chip mostrar. Rodado no catálogo, ele colide 5 pares —
 * e nos 5 o que sobrevive é a versão PIOR, só porque veio antes:
 *
 * | mantinha | descartava |
 * |---|---|
 * | `Qing Guixia, Dagong Daren!` | `Qǐng Guìxia, Dàgōng Dàren!` |
 * | `Buin eun Milbat eseo Gidaryeotda` | `Buin-eun Milbat-eseo Gidaryeotda` |
 * | `곱게 키웠더니, 짐승` | `곱게 키웠더니 짐승` |
 *
 * Romanização com tom e com hífen é outra grafia do título, não repetição — e a busca não
 * perde nada com ela na lista, porque quem casa nomes já dobra tudo por `foldTitle`. Com a
 * chave daqui, o mesmo catálogo tem **zero** colisão: só some o que a quebra duplicou.
 *
 * ⚠️ Dedup escolhe o PRIMEIRO, sem reescrever nada: a função quebra e descarta, nunca muda
 * o texto de um título que já estava separado (fora a decodificação de entidade).
 */
function chaveDeExibicao(titulo: string): string {
  return titulo
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function normalizeAlternativeTitles(values: Array<string | null | undefined>): string[] {
  const vistos = new Set<string>()
  const saida: string[] = []
  for (const valor of values) {
    if (typeof valor !== "string") continue
    for (const titulo of splitAlternativeTitle(valor)) {
      const chave = chaveDeExibicao(titulo)
      if (vistos.has(chave)) continue
      vistos.add(chave)
      saida.push(titulo)
    }
  }
  return saida
}

/**
 * `null` quando não há nada a corrigir — o backfill não precisa comparar de novo, e uma
 * lista já normalizada não vira UPDATE à toa.
 */
export function alternativeTitlesFixOrNull(
  values: Array<string | null | undefined> | null | undefined,
): string[] | null {
  const atuais = (values ?? []).filter((v): v is string => typeof v === "string")
  const novos = normalizeAlternativeTitles(atuais)
  const igual = novos.length === atuais.length && novos.every((v, i) => v === atuais[i])
  return igual ? null : novos
}
