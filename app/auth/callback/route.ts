import { createClient } from "@/lib/supabase/server"

/**
 * Callback do OAuth (Google). O Supabase redireciona pra cá com ?code=…;
 * trocamos o code por uma sessão (grava os cookies) e mandamos pra home.
 * O trigger handle_new_user (migration 137) já provisionou a linha free.
 */

/**
 * ⚠️ Redirect RELATIVO, de propósito.
 *
 * Até 2026-08-04 esta rota montava o destino com o `origin` de `request.url`. Em route handler
 * atrás de proxy isso NÃO é o host público: o servidor standalone enxerga o endereço interno do
 * container (`HOSTNAME=0.0.0.0 PORT=3000`, ver Dockerfile), então o login em produção terminava
 * jogando a pessoa em `https://0.0.0.0:3000/` — sessão criada com sucesso e usuária em lugar
 * nenhum. Ninguém tinha percebido porque ninguém nunca havia logado em prod.
 *
 * No `middleware.ts` o mesmo padrão funciona (medido: `/curadoria` → `https://satoria.fly.dev/login`):
 * lá o Next preenche a URL a partir dos headers do proxy. A diferença é entre middleware e route
 * handler, não entre um jeito certo e um errado de escrever — por isso o middleware fica como está.
 *
 * `Location` relativo é permitido pelo HTTP (RFC 7231) e resolve sem depender de `x-forwarded-host`,
 * que funcionaria mas seria confiar num header do cliente para montar URL de redirect.
 */
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } })
}

/**
 * Só aceita caminho interno. Sem isto, `?next=https://exemplo-malicioso` transformaria o callback
 * num open redirect com a marca do app — e `//host` escapa junto, porque é URL protocol-relative.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/"
  return raw
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const next = safeNext(searchParams.get("next"))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return redirectTo(next)
  }

  // Este callback atende dois fluxos, e mandar os dois pro mesmo lugar mente pra um deles:
  // quem clicou num link de redefinição expirado cairia no /login lendo "oauth", palavra que
  // não tem nada a ver com o que a pessoa estava fazendo.
  if (next === "/nova-senha") return redirectTo("/recuperar-senha?error=link")
  return redirectTo("/login?error=oauth")
}
