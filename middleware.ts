import { NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"
import type { NextRequest } from "next/server"

/**
 * Rotas da console de curadoria — as ferramentas do dono do catálogo.
 * Tem que casar com as `ENTRIES` de `components/curadoria/console-nav.tsx`.
 */
const CONSOLE_PREFIXES = ["/curadoria", "/ai-evaluation", "/settings", "/ai-usage", "/admin"]

/**
 * Rotas que exigem SESSÃO (qualquer papel serve) — não são console, mas também não
 * são do catálogo compartilhado: só falam sobre QUEM está olhando.
 *
 * 🔴 `/conta` entrou aqui em 2026-08-09 depois de medido: sem sessão,
 * `getCurrentUserId()` cai no singleton (o DONO), e `/conta/perfil` renderizava o
 * perfil de gosto **dele** para visitante anônimo — o resumo em prosa, as 40 tags, a
 * versão e o alinhamento — com "Entrar" na barra superior ao lado. Status 200, sem
 * erro e sem log: a mesma classe de [[gotcha-anonimo-vira-dono]].
 *
 * Não dá pra resolver trocando o leitor por `getSessionUserId()`: sem sessão a página
 * simplesmente não tem sujeito, e o fallback pro dono é DESEJADO em background (o
 * recalc precisa do bias dele). O que não pode é uma ROTA renderizar isso. Por isso o
 * gate é aqui — e vale para `/conta` inteira, não só `/perfil`, porque a aba Conta
 * mostra e-mail e papel.
 *
 * 🔴 `/painel` entrou no mesmo dia, pelo mesmo motivo, medido: a página imprimia o
 * `taste_profile.summary` do dono em prosa para visitante anônimo. A causa raiz foi
 * corrigida na fonte (`getTasteProfileStatusAction` devolve vazio sem sessão); este
 * gate é a 2ª camada — e o CLAUDE.md já descrevia a rota como "**a SUA biblioteca** —
 * tudo aqui é de quem olha; nada é do catálogo", o que sempre pediu sessão.
 *
 * `/descobrir` ("Mais como estas") entra pela mesma régua: metade do resultado é o
 * ALINHAMENTO de quem olha (`personal_fit_percentile`), e o filtro padrão esconde o que
 * a pessoa já leu. Sem sessão a página não tem sujeito — e os leitores per-usuário
 * devolveriam vazio, deixando um slider cuja metade não faz nada e uma lista que ignora
 * o que já foi lido. Gatear é mais honesto do que renderizar meia página.
 */
const SIGNED_IN_PREFIXES = ["/conta", "/painel", "/descobrir"]

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Refresh de sessão + o PRIMEIRO gate de rota do app.
 *
 * ## Por que o gate mora aqui, e não só no layout
 *
 * A primeira versão gateava na shell da console (`notFound()` no layout). Não funciona:
 * o Next renderiza layout e página em PARALELO, então o `notFound()` chega depois de o
 * stream já ter começado. Medido em dev — `GET /settings` anônimo devolvia **200** com o
 * HTML da página protegida no corpo, seguido do 404. Ou seja: status errado e o markup
 * do que se queria esconder indo junto na resposta.
 *
 * O proxy roda ANTES de qualquer renderização, então é o único ponto onde a decisão
 * cabe. O `notFound()` do layout ficou como segunda linha (ver console-shell.tsx): se o
 * matcher aqui mudar e deixar uma rota de fora, a página ainda não renderiza.
 *
 * ## Fail-OPEN de propósito no caso ambíguo
 *
 * Só redirecionamos quando dá pra afirmar que o usuário NÃO é curador:
 *   - sem sessão            → `/login` (o caso comum é o próprio dono deslogado)
 *   - com sessão + linha lida com papel != curador → `/`
 *   - com sessão + linha ausente ou erro de leitura → PASSA
 *
 * O último caso existe porque a regra completa (`isCurrentUserAdmin`) tem um fallback
 * legado — logado sem linha própria em `user_settings` compara contra o singleton — que
 * depende da service role e não cabe no proxy. Deixar passar aqui não abre buraco: o
 * layout aplica a regra inteira logo em seguida. Fechar aqui, sim, trancaria o dono
 * para fora num estado que a UI não explica.
 *
 * ⚠️ Isto gateia a console (papel de curador) e `/conta` (só exige sessão).
 * `/import`, `/painel` e o resto da matriz de acesso continuam abertos a qualquer
 * logado — é trabalho à parte, ainda não feito.
 */
export async function middleware(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request)

  const { pathname } = request.nextUrl
  const needsSession = matchesPrefix(pathname, SIGNED_IN_PREFIXES)
  const isConsole = matchesPrefix(pathname, CONSOLE_PREFIXES)
  if (!needsSession && !isConsole) return response

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Sessão é tudo que `/conta` pede — o papel só importa na console.
  if (!isConsole) return response

  // A própria linha do usuário — a política da migration 142 libera lê-la com a sessão,
  // sem service role. `role` é a fonte de verdade do acesso (migration 140).
  const { data, error } = await supabase
    .from("user_settings")
    .select("role, is_admin")
    .eq("current_user_id", user.id)
    .limit(1)
    .maybeSingle()

  if (error || !data) return response // ambíguo → o layout decide (ver acima)

  const row = data as { role: string | null; is_admin: boolean | null }
  // Pré-migration 140 a coluna `role` pode não existir: cai no flag legado, o mesmo
  // backfill que `getCurrentRole` faz. Sem isto o gate trancaria o dono num banco antigo.
  const isCurador = row.role === "curador" || (row.role == null && row.is_admin === true)
  if (!isCurador) return NextResponse.redirect(new URL("/", request.url))

  return response
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas EXCETO assets estáticos e imagens — refresh de
     * sessão em navegação/ações, não em bytes estáticos. O gate de rota (acima)
     * se aplica só ao subconjunto de `CONSOLE_PREFIXES`.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
