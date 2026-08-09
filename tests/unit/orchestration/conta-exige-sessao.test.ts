import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante: `/conta` só renderiza com SESSÃO, e o gate mora no proxy.
 *
 * 🔴 O que isto pega, medido em 2026-08-09 antes da correção: `GET /conta/perfil`
 * ANÔNIMO devolvia **200 com o perfil de gosto do DONO** — o resumo em prosa ("ama
 * romances de fantasia com nobreza…"), as 40 tags, a versão v23 e o alinhamento —
 * enquanto a barra superior mostrava "Entrar". Nada falhava: sem sessão,
 * `getCurrentUserId()` cai no singleton por design (o recalc em background precisa
 * disso), então a página tinha um sujeito, só que o errado.
 *
 * Por que não basta trocar o leitor por `getSessionUserId()`: sem sessão a página não
 * tem sujeito NENHUM, e o fallback pro dono é desejado fora de requisição. O que não
 * pode é uma ROTA renderizar isso — logo, o gate é de rota.
 *
 * Por que o proxy e não o layout: o Next renderiza layout e página em PARALELO, então
 * `notFound()` no layout chega depois de o stream ter começado (medido em `/settings`:
 * 200 com o HTML protegido no corpo). O proxy roda antes de qualquer renderização.
 */

const MIDDLEWARE = readFileSync("middleware.ts", "utf8")

/** Prefixos do array `SIGNED_IN_PREFIXES` do proxy. */
function signedInPrefixes(): string[] {
  const i = MIDDLEWARE.indexOf("const SIGNED_IN_PREFIXES")
  if (i < 0) return []
  const block = MIDDLEWARE.slice(i, MIDDLEWARE.indexOf("]", i))
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
}

/** Toda rota sob app/conta (page.tsx), como pathname. */
function contaRoutes(): string[] {
  const out: string[] = []
  const walk = (dir: string, url: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) walk(p, `${url}/${entry}`)
      else if (entry === "page.tsx") out.push(url || "/")
    }
  }
  walk("app/conta", "/conta")
  return out
}

describe("arquitetura: /conta exige sessão", () => {
  it("o proxy declara /conta como rota de sessão", () => {
    expect(signedInPrefixes()).toContain("/conta")
  })

  it("toda rota sob app/conta está coberta por um prefixo do proxy", () => {
    // Rota nova sob /conta (ex.: /conta/assinatura) fica vermelha até ser coberta —
    // é a defesa contra alguém acrescentar uma página pessoal aberta sem perceber.
    const prefixes = signedInPrefixes()
    const descobertas = contaRoutes().filter(
      (route) => !prefixes.some((p) => route === p || route.startsWith(`${p}/`)),
    )
    expect(descobertas, "rota pessoal sem gate de sessão no proxy").toEqual([])
  })

  it("sem usuário o proxy REDIRECIONA, e não só deixa passar", () => {
    // O ramo tem que existir ANTES de qualquer decisão de papel: `/conta` é de
    // qualquer logado, então o gate dela é identidade, não curadoria.
    expect(MIDDLEWARE).toMatch(/if\s*\(\s*!user\s*\)/)
    expect(MIDDLEWARE).toMatch(/redirect\(new URL\("\/login"/)
  })

  it("🔴 sessão BASTA pra /conta — o gate de papel é só da console", () => {
    // Sem este ramo, `/conta` herdaria a checagem de curador e jogaria todo leitor
    // logado pra `/` — trancando fora justamente quem a página descreve.
    expect(
      MIDDLEWARE,
      "faltou o early-return que libera rota de sessão antes do gate de papel",
    ).toMatch(/if\s*\(\s*!isConsole\s*\)\s*return response/)
  })

  it("a página do perfil não perdeu o gate ao ganhar leitura per-usuário", () => {
    // A /conta/perfil passou a ler `getDeclaredTagPreferences()` (as tags declaradas
    // de quem olha). Sem sessão isso resolveria nas preferências do dono — a segunda
    // via do mesmo vazamento, por outra função.
    const page = readFileSync("app/conta/perfil/page.tsx", "utf8")
    expect(page).toMatch(/getDeclaredTagPreferences/)
    expect(signedInPrefixes()).toContain("/conta")
  })
})
