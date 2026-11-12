/**
 * Onde o "Continuar lendo" da /reading leva, decidido na checagem de capítulos e gravado em
 * `works.latest_chapter_url` (migration 221). PURO.
 *
 * A Comix é a leitura preferida — mas só quando ela RESPONDEU nesta checagem. Até 2026-11-12 o
 * link era a Comix sempre que a obra tinha hid, e o lote de capítulos achou 12 hids devolvendo
 * 404: em 9 o capítulo veio do Mangago e o botão seguia abrindo a página que não existe mais.
 *
 * Uma falha passageira da Comix também leva o link para o Mangago até a checagem seguinte — que é
 * o lado barato: o Mangago tem o capítulo. O contrário (insistir na Comix) é o link morto.
 */
export function pickReadUrl(args: {
  /**
   * URL da Comix quando ela RESPONDEU nesta checagem (`getLatestChapter().comixUrl`). Vem da
   * própria resposta, nunca remontada pela hid salva — que pode ser justamente a morta.
   */
  comixAnsweredUrl: string | null | undefined
  /** URL da fonte que venceu o capítulo (`getLatestChapter().latestUrl`). */
  winnerUrl: string | null | undefined
}): string | null {
  return args.comixAnsweredUrl ?? args.winnerUrl ?? null
}

/**
 * O link do card: o desta checagem (se a pessoa acabou de verificar), senão o gravado pela última
 * checagem, senão a Comix pelo hid (obra nunca checada — o comportamento de antes).
 */
export function continueReadingUrl(args: {
  checkedUrl: string | null | undefined
  savedUrl: string | null | undefined
  comixHid: string | null
  comixUrl: (hid: string) => string
}): string | null {
  return args.checkedUrl ?? args.savedUrl ?? (args.comixHid ? args.comixUrl(args.comixHid) : null)
}
