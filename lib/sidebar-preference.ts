/**
 * Preferência de colapso da sidebar — em COOKIE, não em localStorage.
 *
 * O servidor precisa saber o valor pra emitir a sidebar já no estado final. Com
 * localStorage ele não sabe: o SSR mandava a sidebar EXPANDIDA e o cliente, que lê a
 * preferência, renderizava COLAPSADA → a hidratação divergia em toda navegação
 * (`Hydration failed` + `Cannot read properties of null (reading 'parentNode')`), e o
 * usuário ainda via o menu pular de expandido pra trilho. Cookie o servidor lê.
 *
 * Nome sem `:` de propósito — dois-pontos não é um token válido de nome de cookie
 * (RFC 6265); os browsers toleram, mas não vale a aposta.
 */
export const SIDEBAR_COLLAPSED_COOKIE = "sidebar_collapsed"

/** Chave antiga em localStorage, migrada pro cookie no primeiro load (ver sidebar.tsx). */
export const SIDEBAR_COLLAPSED_LEGACY_KEY = "sidebar:collapsed"

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function readCollapsedCookie(): boolean {
  if (typeof document === "undefined") return false
  return document.cookie
    .split("; ")
    .some((entry) => entry === `${SIDEBAR_COLLAPSED_COOKIE}=1`)
}

export function writeCollapsedCookie(collapsed: boolean): void {
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}
