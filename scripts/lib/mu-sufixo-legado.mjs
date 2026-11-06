/**
 * O rodapé da página do MangaUpdates que a raspagem antiga gravou DENTRO do texto da review.
 *
 * Até 2026-11 os comentários vinham da página `www.mangaupdates.com/series/...`, e o regex do
 * corpo terminava em `</div>\s*</div>`: num comentário EDITADO ele passava do fim do corpo e
 * levava junto o rodapé (`... Last updated 6 years ago` + `Was this comment useful? Yes No`).
 * Medido no backup da nuvem de 2026-11-01: **563 das 2.768** reviews do MU, em 265 obras.
 *
 * Desde o PR #583 o texto vem da API e sai SEM esse rodapé. Como a persistência acumulativa
 * deduplica por texto exato, a linha antiga e a nova não se reconhecem: a próxima coleta grava
 * a versão limpa ao lado da suja. Cortar o rodapé do legado é o que as faz coincidir.
 *
 * 🔴 A régua é ESTRITA de propósito: só reconhece o rodapé na forma exata da página. A forma
 * cortada (o teto de 900 do conector caiu no meio do rodapé) só vale para texto que de fato
 * bateu no teto. Qualquer outra coisa fica intocada e é contada à parte.
 */

const MARCA = " ... Last updated"
const RODAPE = "Was this comment useful? Yes No"
// " 6 years ago", " a year ago", " 8 months ago" — a página imprime o tempo relativo.
const TEMPO = /^ (?:an?|\d+) (?:second|minute|hour|day|week|month|year)s? ago/
// O mesmo, porém cortado em qualquer ponto: " 3 years ag", " 9 month", " 2 ", "".
const TEMPO_CORTADO = /^(?: (?:an?|\d+)?(?: [a-z]*){0,2})?$/
/** O conector corta em 900 unidades UTF-16; o saneamento pode tirar meio emoji (→ 899). */
export const TETO_DO_CONECTOR = 900
const cortadoNoTeto = (texto) => texto.length >= TETO_DO_CONECTOR - 1

/**
 * Separa o rodapé legado do fim do texto. Devolve `null` quando o texto não termina no rodapé
 * reconhecido — inclusive quando só se PARECE com ele.
 *
 * @param {string} texto
 * @returns {{ limpo: string, sufixo: string, cortado: boolean } | null}
 */
export function separarSufixoLegado(texto) {
  const i = texto.lastIndexOf(MARCA)
  if (i < 0) return null
  const sufixo = texto.slice(i)
  const resto = sufixo.slice(MARCA.length)
  const cortado = cortadoNoTeto(texto)

  const tempo = TEMPO.exec(resto)
  let reconhecido
  if (tempo) {
    const depois = resto.slice(tempo[0].length)
    reconhecido = depois === RODAPE || depois === "" || (cortado && RODAPE.startsWith(depois))
  } else {
    reconhecido = cortado && TEMPO_CORTADO.test(resto)
  }
  if (!reconhecido) return null

  const limpo = texto.slice(0, i)
  if (!limpo.trim()) return null
  return { limpo, sufixo, cortado }
}
