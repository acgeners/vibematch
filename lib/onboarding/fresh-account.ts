/**
 * Para onde vai quem acabou de entrar pelo Google (ou por qualquer link que passe pelo
 * `/auth/callback`). O cadastro por email já desvia para `/welcome` em `signUpAction`; o Google
 * não passava por lá, e a conta nova caía na home sem nunca ver as boas-vindas.
 *
 * A régua é a IDADE da conta, não o botão clicado: "Entrar com Google" no /login também cria conta,
 * e "Criar conta com Google" no /signup também entra numa conta antiga.
 */

/**
 * Conta criada há menos que isto é "nova". A troca do code acontece segundos depois do
 * consentimento no Google; a folga cobre relógio desencontrado e quem demora na tela de consentimento.
 */
export const FRESH_ACCOUNT_WINDOW_MS = 10 * 60 * 1000

export function isFreshAccount(createdAt: string | null | undefined, nowMs: number): boolean {
  if (!createdAt) return false
  const created = Date.parse(createdAt)
  if (!Number.isFinite(created)) return false
  return Math.abs(nowMs - created) <= FRESH_ACCOUNT_WINDOW_MS
}

/**
 * O destino depois de autenticar. Só troca o destino PADRÃO ("/"): quem chegou com um `next`
 * explícito (redefinição de senha, link para uma página) vai para ele.
 */
export function landingAfterAuth(next: string, createdAt: string | null | undefined, nowMs: number): string {
  return next === "/" && isFreshAccount(createdAt, nowMs) ? "/welcome" : next
}
