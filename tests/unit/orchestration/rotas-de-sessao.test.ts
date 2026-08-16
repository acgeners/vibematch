import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante: toda rota que fala sobre QUEM ESTÁ OLHANDO só renderiza com SESSÃO, e o
 * gate mora no proxy.
 *
 * 🔴 O que isto pega, medido em 2026-08-09 nas duas ocorrências:
 *
 *   - `GET /account/taste-profile` ANÔNIMO devolvia **200 com o perfil de gosto do DONO** — o
 *     resumo em prosa ("ama romances de fantasia com nobreza…"), as 40 tags, `v23` e o
 *     alinhamento — com "Entrar" na barra superior ao lado.
 *   - `GET /dashboard` ANÔNIMO imprimia o `taste_profile.summary` dele em prosa
 *     ("…o coração do gosto é o romance de fantasia/rofan…"), mais temas e tags.
 *
 * Nada falhava: sem sessão, `getCurrentUserId()` cai no singleton POR DESIGN (o recalc
 * em background precisa do bias do dono), então a página tinha um sujeito — o errado.
 *
 * Por que não basta trocar o leitor por `getSessionUserId()`: sem sessão a página não
 * tem sujeito NENHUM, e o fallback é desejado fora de requisição. O que não pode é uma
 * ROTA renderizar isso. (A causa raiz do `/dashboard` foi corrigida também na fonte —
 * `getTasteProfileStatusAction`, travada em `leitores-por-sessao.test.ts`.)
 *
 * Por que o proxy e não o layout: o Next renderiza layout e página em PARALELO, então
 * `notFound()` no layout chega depois de o stream ter começado (medido em `/curation/settings`:
 * 200 com o HTML protegido no corpo). O proxy roda antes de qualquer renderização.
 *
 * ⚠️ A varredura deriva os diretórios de `SIGNED_IN_PREFIXES` em vez de olhar
 * `app/account` fixo. A 1ª versão tinha a lista fixa — e foi exatamente assim que o
 * `/dashboard` passou despercebido enquanto o `/account` era corrigido.
 */

const MIDDLEWARE = readFileSync("middleware.ts", "utf8")

/** Prefixos do array `SIGNED_IN_PREFIXES` do proxy. */
function signedInPrefixes(): string[] {
  const i = MIDDLEWARE.indexOf("const SIGNED_IN_PREFIXES")
  if (i < 0) return []
  const block = MIDDLEWARE.slice(i, MIDDLEWARE.indexOf("]", i))
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
}

/** Toda rota (page.tsx) sob um prefixo, como pathname. */
function routesUnder(prefix: string): string[] {
  const root = join("app", prefix.replace(/^\//, ""))
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string, url: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) walk(p, `${url}/${entry}`)
      else if (entry === "page.tsx") out.push(url || "/")
    }
  }
  walk(root, prefix)
  return out
}

describe("arquitetura: rotas pessoais exigem sessão", () => {
  const prefixes = signedInPrefixes()

  it("o proxy declara as rotas pessoais conhecidas", () => {
    expect(prefixes).toContain("/account")
    expect(prefixes).toContain("/dashboard")
  })

  it("todo prefixo declarado aponta pra uma rota que existe", () => {
    // Prefixo órfão (rota renomeada/removida) é gate que não gateia nada — e passa
    // despercebido porque nada quebra.
    const fantasmas = prefixes.filter((p) => routesUnder(p).length === 0)
    expect(fantasmas, "prefixo no proxy sem rota correspondente em app/").toEqual([])
  })

  it("toda rota sob um prefixo declarado está de fato coberta", () => {
    // Rota nova sob um prefixo pessoal (ex.: /account/assinatura) já nasce coberta; este
    // caso trava o inverso — alguém mexer no `matchesPrefix` e quebrar o casamento.
    const descobertas = prefixes
      .flatMap(routesUnder)
      .filter((route) => !prefixes.some((p) => route === p || route.startsWith(`${p}/`)))
    expect(descobertas, "rota pessoal sem gate de sessão no proxy").toEqual([])
  })

  it("sem usuário o proxy REDIRECIONA, e não só deixa passar", () => {
    expect(MIDDLEWARE).toMatch(/if\s*\(\s*!user\s*\)/)
    expect(MIDDLEWARE).toMatch(/redirect\(new URL\("\/login"/)
  })

  it("🔴 sessão BASTA — o gate de papel é só da console", () => {
    // Sem este ramo, `/account` e `/dashboard` herdariam a checagem de curador e jogariam
    // todo leitor logado pra `/` — trancando fora justamente quem as páginas descrevem.
    expect(
      MIDDLEWARE,
      "faltou o early-return que libera rota de sessão antes do gate de papel",
    ).toMatch(/if\s*\(\s*!isConsole\s*\)\s*return response/)
  })

  it("as páginas que leem dado per-usuário continuam sob gate", () => {
    // Amarra o gate ao MOTIVO dele: estas duas leem identidade de quem olha. Se alguém
    // remover a leitura, o teste continua verde; se remover o gate, falha.
    const perfil = readFileSync("app/account/taste-profile/page.tsx", "utf8")
    expect(perfil).toMatch(/getDeclaredTagPreferences|getTasteProfileStatusAction/)
    const painel = readFileSync("app/dashboard/page.tsx", "utf8")
    expect(painel).toMatch(/getTasteProfileStatusAction/)
    for (const rota of ["/account", "/dashboard"]) expect(prefixes).toContain(rota)
  })
})
