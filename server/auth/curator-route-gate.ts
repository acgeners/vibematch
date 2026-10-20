import "server-only"
import { NextResponse } from "next/server"
import { getSessionUserId, isCurrentUserAdmin } from "@/server/queries/current-user"

/**
 * Gate das rotas-proxy de fonte externa (`/api/animeplanet`, `/api/comick/*`). Devolve a
 * resposta de bloqueio, ou `null` quando o curador pode seguir. Tem que rodar ANTES de
 * qualquer fetch: essas rotas acionam o FlareSolverr, cuja fila é de UMA página por
 * processo e é a mesma das server actions — uma rajada anônima travaria a curadoria e a
 * aquisição de reviews em produção.
 *
 * O `middleware.ts` NÃO cobre `/api/*` (só redireciona páginas), então o gate é aqui.
 *
 * A régua é a mesma de `fetchExternalData` e `refreshWorkExternalData` (`ensureAdmin`):
 * o cliente só usa essas rotas logo depois de uma dessas actions, então o critério tem
 * que ser idêntico — um mais frouxo reabre o proxy, um mais estrito quebra o curador.
 *
 * ⚠️ Nunca 502: o cliente lê 502 como "fonte indisponível" e oferece retry
 * (`ComicKUnavailableError`). 401/403 caem em `!res.ok` ⇒ `null`.
 */
export async function gateCuradorDaRota(): Promise<NextResponse | null> {
  if (!(await getSessionUserId())) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  return null
}
