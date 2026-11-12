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
  /** hid da Comix vinculado (ou resolvido nesta checagem). */
  comixHid: string | null
  /** A Comix devolveu capítulo nesta checagem (`bySource.comix != null`). */
  comixAnswered: boolean
  /** URL da fonte que venceu o capítulo (`getLatestChapter().latestUrl`). */
  winnerUrl: string | null | undefined
  /** Monta a URL da Comix a partir do hid. */
  comixUrl: (hid: string) => string
}): string | null {
  if (args.comixHid && args.comixAnswered) return args.comixUrl(args.comixHid)
  return args.winnerUrl ?? null
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
