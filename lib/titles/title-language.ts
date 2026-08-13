/**
 * Ordem de idioma dos títulos alternativos — inglês primeiro.
 *
 * O catálogo é majoritariamente manhwa/manhua, e cada obra carrega os títulos de todas as
 * fontes: medido em 13/08/2026, **10.072 títulos alternativos** em 988 obras, sendo
 * **63,6% em alfabeto latino** e o resto em japonês/chinês (18,4%), coreano (6,3%),
 * cirílico (5,9%), tailandês (4,7%) e árabe (1,0%). Sem ordenação, o chip que a pessoa
 * consegue LER aparece em posição aleatória — as fontes devolvem em ordem própria.
 *
 * 🔴 **Inglês só por sinal POSITIVO, nunca por ausência de sinal.** A primeira versão
 * classificava "ASCII sem marca de outra língua" como inglês, e isso engolia romanização
 * asiática — "Neukdae Sillang", "Manyeo, 30 Se", "S-geup Dungeon-ui Yeojuin" apareciam no
 * topo como se fossem inglês. Trocar por evidência positiva inverte o tipo de erro: um
 * título inglês sem nenhuma palavra funcional cai pro segundo grupo, o que custa uma
 * posição na lista — enquanto o falso positivo poluía justamente o topo, que é o que esta
 * ordenação existe pra limpar.
 *
 * Conferido à mão em **70 títulos sorteados** do catálogo (duas amostras): nenhum falso
 * positivo e nenhum inglês óbvio fora. `'s`, `-ing`, `-ed`, `-tion` recuperam os títulos
 * sem palavra funcional ("Adult Reading Club", "Lord Preston's Secret Private Tutor").
 *
 * ⚠️ Isto NÃO é um detector de idioma — é uma régua de ORDENAÇÃO. Ela não precisa dizer
 * qual língua é; precisa acertar quem vem primeiro.
 */

/** 0 = inglês · 1 = outro idioma em alfabeto latino · 2 = outro sistema de escrita. */
export type TitleLanguageRank = 0 | 1 | 2

/** Sistemas de escrita não-latinos que aparecem no catálogo (36,4% dos títulos). */
const NON_LATIN =
  /[぀-ヿ㐀-䶿一-鿿가-힯Ѐ-ӿ฀-๿؀-ۿ]/

/** Diacríticos que o inglês não usa — sinal forte de outra língua latina. */
const NON_ENGLISH_DIACRITICS = /[àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæßđğşıø]/

/**
 * Palavras funcionais do inglês. ⚠️ Sem as que colidem com português/espanhol/italiano
 * (`a`, `o`, `e`, `no`, `do`, `em`, `as`, `is`, `con`): "A Herdeira Acidental" contava
 * como inglês por causa do artigo.
 */
const EN_WORDS = new Set(
  `the of to and in on with for from by at than then this that not but how what who when where why
   my me you your his her she he it its our we they their been were was are am ill dont wont cant
   into out up down over after before again more most only just about because while during without
   within all`.split(/\s+/),
)

/** Palavras funcionais das outras línguas que aparecem no catálogo. */
const OTHER_WORDS = new Set(
  `el la los las del al un una unos unas para con sin como cómo que qué es soy eres mi tu su
   os do da dos das na nos nas um uma sem porque eu meu minha seu sua ou mas até você vamos
   le les du des aux pour avec sans comment est je mon ma ses dans cette ce qui
   lo gli della delle di senza sono mio mia nel che
   der die das den dem ein eine für mit ohne wie ich mein meine und aber im zum ist nicht
   yang dengan untuk saya aku dari adalah tidak akan sang
   của và tôi là không được cho anh người на не и мы`.split(/\s+/),
)

/** Morfologia inglesa — recupera o título sem palavra funcional. */
const EN_MORPHOLOGY = /'s\b|\b\w{4,}(?:ing|ed|tion|ness|ment|ful|less|ly)\b/i

export function titleLanguageRank(title: string): TitleLanguageRank {
  const text = title.trim()
  if (!text) return 1
  if (NON_LATIN.test(text)) return 2

  const lower = text.toLowerCase()
  if (NON_ENGLISH_DIACRITICS.test(lower)) return 1

  const words = lower.match(/[a-z']+/g) ?? []
  let en = 0
  let other = 0
  for (const word of words) {
    if (EN_WORDS.has(word)) en++
    if (OTHER_WORDS.has(word)) other++
  }
  if (other > en) return 1
  return en > 0 || EN_MORPHOLOGY.test(lower) ? 0 : 1
}

/**
 * Ordena por idioma preservando a ordem de origem dentro de cada grupo (`sort` é estável
 * no V8): a ordem que as fontes devolveram costuma ter alguma intenção — a primeira
 * costuma ser a mais usada —, e embaralhar dentro do grupo jogaria isso fora.
 */
export function sortByTitleLanguage<T>(items: T[], getTitle: (item: T) => string): T[] {
  return [...items].sort((a, b) => titleLanguageRank(getTitle(a)) - titleLanguageRank(getTitle(b)))
}
