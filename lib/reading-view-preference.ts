/**
 * Preferência de vista da página /leitura (lista × calendário) — em COOKIE, não em
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
