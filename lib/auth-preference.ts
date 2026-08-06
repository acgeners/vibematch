/**
 * Preferências do `/login` que o SERVIDOR precisa enxergar — as duas em COOKIE, pelo mesmo
 * motivo de `lib/sidebar-preference.ts`: o `/login` é renderizado no servidor, e estado inicial
 * lido de `localStorage` faz o SSR divergir do primeiro render do cliente.
 */

/**
 * "Manter-me conectado", do `/login`.
 *
 * Só existe quando a resposta é NÃO (`"0"`). Ausência = persistir, que é o comportamento
 * histórico — assim ninguém que já estava logado é afetado pela chegada do checkbox.
 *
 * E ele mesmo é cookie de SESSÃO: se sobrevivesse ao fechamento do browser, a escolha
 * "não me mantenha conectado" de um computador emprestado ficaria grudada na máquina
 * para sempre, sem nada na UI que explicasse por quê.
 */
export const SESSION_PERSIST_COOKIE = "satoria_persist"

/**
 * Último email que entrou COM SUCESSO, só pra pré-preencher o campo do `/login`.
 * 🔴 Nunca a senha: isso é campo de conveniência, não de credencial.
 */
export const LAST_EMAIL_COOKIE = "satoria_last_email"

/** Um email lembrado por 180 dias — depois disso, quem voltou já não é "de novo". */
export const LAST_EMAIL_MAX_AGE = 60 * 60 * 24 * 180

/** Interpreta o cookie: só `"0"` desliga a persistência. */
export function persistFromCookieValue(value: string | undefined): boolean {
  return value !== "0"
}

/**
 * Tira `maxAge`/`expires` das opções de um cookie de auth, transformando-o em cookie de
 * SESSÃO — o browser o descarta ao fechar.
 *
 * 🔴 Tem que ser aplicado nos DOIS pontos que escrevem cookie de auth: `lib/supabase/server.ts`
 * (actions e route handlers) e `lib/supabase/middleware.ts` (todo request). Aplicar só no
 * primeiro não dá erro nenhum — o refresh do middleware simplesmente reescreve o cookie com o
 * `maxAge` de volta na navegação seguinte, e o "não persistir" deixa de valer em silêncio,
 * que é o pior desfecho possível pra um controle de segurança.
 */
export function applySessionPersistence<T extends { maxAge?: number; expires?: Date }>(
  options: T | undefined,
  persist: boolean
): T | undefined {
  if (persist || !options) return options
  const rest = { ...options }
  delete rest.maxAge
  delete rest.expires
  return rest
}
