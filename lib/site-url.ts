/**
 * URL pública do app, para os links que o SUPABASE monta e manda por email
 * (hoje: o de redefinição de senha).
 *
 * ## Em produção: env, nunca header
 *
 * Atrás de proxy o servidor não enxerga o host público — foi assim que o login em produção
 * despejava a pessoa em `https://0.0.0.0:3000/` (ver `app/auth/callback/route.ts`). Aqui seria
 * pior: o endereço errado sai num EMAIL, que a pessoa abre horas depois. E a alternativa,
 * `x-forwarded-host`, é header do cliente — montar link de auth com valor que o cliente escolhe
 * é como se abre um redirect envenenado.
 *
 * ## Em desenvolvimento: o host de quem pediu
 *
 * 🔴 `localhost` e `127.0.0.1` são hosts DIFERENTES para cookies. O fluxo de recuperação é PKCE:
 * o `resetPasswordForEmail` grava um *code verifier* em cookie no host onde o pedido foi feito, e
 * o `/auth/callback` precisa achar esse cookie para trocar o `code` por sessão. Pedindo de
 * `localhost:3001` e voltando em `127.0.0.1:3001`, o verifier não existe e o callback falha —
 * medido, dá `?error=oauth`, que ainda por cima não fala em senha nenhuma.
 *
 * Em dev não há proxy, então o host do request é confiável e é o único jeito de o link voltar
 * para onde a pessoa realmente está. `SITE_URL` continua vencendo se estiver definida.
 */
const DEV_FALLBACK = "http://127.0.0.1:3001"

function normalize(url: string): string {
  return url.replace(/\/+$/, "")
}

export function getSiteUrl(requestHost?: string | null): string {
  const raw = process.env.SITE_URL?.trim()
  const isProd = process.env.NODE_ENV === "production"

  if (isProd) {
    if (raw) return normalize(raw)
    // Sem host configurado o email sairia com link inválido — melhor falhar aqui, onde o
    // erro aparece pra quem operou, do que na caixa de entrada de quem esqueceu a senha.
    throw new Error(
      "SITE_URL não configurada — o email de redefinição de senha sairia com link inválido."
    )
  }

  // Dev: o host de quem está pedindo tem prioridade justamente por causa do verifier PKCE.
  if (requestHost && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(requestHost)) {
    return `http://${requestHost}`
  }
  return raw ? normalize(raw) : DEV_FALLBACK
}
