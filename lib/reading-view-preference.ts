/**
 * Preferência de vista da página /reading (lista × calendário) — em COOKIE, não em
 * localStorage. O servidor renderiza a página já na vista final; com localStorage o
 * SSR não saberia o valor e o primeiro render do cliente divergiria → hidratação
 * quebrada (ver `lib/sidebar-preference.ts` e a armadilha documentada no CLAUDE.md).
 *
 * Nome sem `:` de propósito — dois-pontos não é token válido de nome de cookie (RFC 6265).
 */
export const READING_VIEW_COOKIE = "reading_view"

export type ReadingView = "list" | "calendar"

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/** Normaliza um valor cru de cookie para uma vista válida (default: lista). */
export function normalizeReadingView(value: string | null | undefined): ReadingView {
  return value === "calendar" ? "calendar" : "list"
}

export function writeReadingViewCookie(view: ReadingView): void {
  if (typeof document === "undefined") return
  document.cookie = `${READING_VIEW_COOKIE}=${view}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}

/**
 * Os grupos recolhidos da /reading (`seção:banda`), também em cookie e pelo mesmo motivo: o
 * servidor já desenha a lista recolhida. O separador é `|` porque vírgula não é válida em valor de
 * cookie (RFC 6265).
 */
export const READING_COLLAPSED_BANDS_COOKIE = "reading_collapsed_bands"

const BAND_KEY = /^[a-z_]+:[a-z_]+$/

/** Cookie cru → chaves válidas. Valor adulterado vira lista vazia, nunca erro de render. */
export function parseCollapsedBands(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split("|").filter((key) => BAND_KEY.test(key))
}

export function writeCollapsedBandsCookie(keys: Iterable<string>): void {
  if (typeof document === "undefined") return
  const value = [...keys].join("|")
  document.cookie = `${READING_COLLAPSED_BANDS_COOKIE}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}
