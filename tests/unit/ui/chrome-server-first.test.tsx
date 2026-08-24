/**
 * O chrome de quem está autenticado não pode nascer anônimo.
 *
 * 🔴 O defeito, medido em 2026-08-23 no build de produção contra o banco local: o
 * `AdminProvider` nascia `ANON` e só aprendia a verdade por Server Action. Carga fria do
 * curador em `/` — primeiro paint com "Entrar" e nav 0/5; chrome correto só aos **879ms**, no
 * fim de uma cascata de QUATRO actions que o Next serializa. E como `signedIn` tinha DUAS
 * fontes, entre 354ms e 879ms a barra mostrava o avatar do usuário logado ao lado do botão
 * "Entrar": 525ms de contradição na mesma barra.
 *
 * ⚠️ A prova aqui é por AÇÃO PENDENTE, não por timing: as Server Actions devolvem promises que
 * NUNCA resolvem. O que for desenhado veio do estado que o servidor entregou — se algum caminho
 * voltar a depender do POST para saber quem está olhando, o teste vê o chrome errado.
 */
import { vi, describe, it, expect, afterEach, beforeEach } from "vitest"
import { render, cleanup, screen, act } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ usePathname: () => "/" }))
vi.mock("@/server/actions/auth", () => ({ signOutAction: vi.fn() }))

/** Nenhuma action resolve: o que aparecer na tela veio do servidor. */
const pendente = () => new Promise<never>(() => {})
const chamadas = { chrome: 0, resumo: 0 }
vi.mock("@/server/actions/admin", () => ({
  getCurrentUserChrome: () => { chamadas.chrome++; return pendente() },
}))
vi.mock("@/server/actions/account", () => ({
  getAccountSummary: () => { chamadas.resumo++; return resumo.valor },
  getBalanceSummary: () => pendente(),
}))
const resumo: { valor: Promise<unknown> } = { valor: pendente() }

const badges = {
  curadoria: 0, recQueue: 0, requests: 0, settings: 0, settingsByGroup: {},
  recalcPending: false, comixHealth: "unknown" as const, clearRecalcPending: () => {},
}
vi.mock("@/components/layout/chrome-badges", () => ({ useChromeBadges: () => badges }))

import { AdminProvider } from "@/components/layout/admin-context"
import { TopNav } from "@/components/layout/top-nav"
import { AccountChip } from "@/components/layout/account-chip"
import { CHROME_REFRESH_EVENT } from "@/lib/chrome-refresh"
import type { AccountSummary, CurrentUserChrome } from "@/server/queries/current-user"

const CURADOR: CurrentUserChrome = { role: "curador", signedIn: true }
const LEITOR: CurrentUserChrome = { role: "leitor", signedIn: true }
const ANON: CurrentUserChrome = { role: "leitor", signedIn: false }
const SEM_PERFIL: AccountSummary = { displayName: null, email: null, avatarUrl: null }
const PERFIL: AccountSummary = { displayName: "Ana", email: "a@b.test", avatarUrl: "/avatar.svg?estilo=x" }

/** Os destinos que o top-nav gateia por sessão (`requiresSignedIn` em top-nav.tsx). */
const DESTINOS_PRIVADOS = ["Minha lista", "Acompanhamento", "Favoritos", "Ranking", "Recomendações"]

function montarNav(initial: CurrentUserChrome, perfil = SEM_PERFIL) {
  return render(
    <AdminProvider initial={initial}>
      <TopNav searchIndex={[]} initialProfile={perfil} />
    </AdminProvider>,
  )
}

const textoDe = (c: HTMLElement) => c.textContent ?? ""
/**
 * ⚠️ Casa o LINK, não a palavra: `textContent` concatena sem espaço ("…páginasEntrar"), então
 * `/\bEntrar\b/` não casa — a 1ª versão deste helper reprovava um chrome anônimo correto.
 * O convite ao visitante É o link para `/login`, e é ele que o `!signedIn` gateia.
 */
const temEntrar = (c: HTMLElement) => !!c.querySelector('a[href="/login"]')
const destinosVisiveis = (c: HTMLElement) => DESTINOS_PRIVADOS.filter((d) => textoDe(c).includes(d))

afterEach(cleanup)
beforeEach(() => { resumo.valor = pendente(); chamadas.chrome = 0; chamadas.resumo = 0 })

describe("curador autenticado — o chrome já nasce certo", () => {
  it("destinos privados presentes ANTES de qualquer Server Action", () => {
    const { container } = montarNav(CURADOR)
    expect(destinosVisiveis(container)).toEqual(DESTINOS_PRIVADOS)
  })

  it('"Entrar" ausente', () => {
    const { container } = montarNav(CURADOR)
    expect(temEntrar(container)).toBe(false)
  })

  it("a porta da Curadoria aparece — é o que só o papel privilegiado vê", () => {
    const { container } = montarNav(CURADOR)
    expect(container.querySelector('a[href^="/curation"]')).toBeTruthy()
  })
})

describe("leitor autenticado", () => {
  it("destinos privados presentes e sem \"Entrar\"", () => {
    const { container } = montarNav(LEITOR)
    expect(destinosVisiveis(container)).toEqual(DESTINOS_PRIVADOS)
    expect(temEntrar(container)).toBe(false)
  })

  it("a Curadoria NÃO aparece — sessão não é papel", () => {
    const { container } = montarNav(LEITOR)
    expect(container.querySelector('a[href^="/curation"]')).toBeNull()
  })
})

describe("anônimo — nenhuma regressão", () => {
  it('chrome anônimo: "Entrar" presente e destinos privados ausentes', () => {
    const { container } = montarNav(ANON)
    expect(temEntrar(container)).toBe(true)
    expect(destinosVisiveis(container)).toEqual([])
    expect(container.querySelector('a[href^="/curation"]')).toBeNull()
  })

  it("o Catálogo continua aberto a quem não entrou", () => {
    const { container } = montarNav(ANON)
    expect(textoDe(container)).toContain("Catálogo")
  })
})

describe("AccountChip — a segunda verdade não existe mais", () => {
  /**
   * 🔴 A contradição MEDIDA: o avatar chegava com o resumo (354ms) e o "Entrar" só saía com o
   * contexto (879ms). Aqui o resumo resolve JÁ e o contexto diz que há sessão — se o chip
   * voltasse a decidir auth pelo próprio fetch, o par apareceria junto.
   */
  it("avatar e sessão no MESMO render — a contradição não tem mais onde nascer", () => {
    // A barra INTEIRA, porque a contradição medida era entre dois componentes vizinhos: o
    // avatar vinha do chip (POST) e o "Entrar" do nav (contexto), e eles chegavam em momentos
    // diferentes. Hoje os dois vêm do MESMO render do servidor, então não há ordem possível
    // em que um contradiga o outro — e o teste afirma isso SEM esperar promise nenhuma.
    const { container } = montarNav(CURADOR, PERFIL)
    expect(container.querySelector("header img")).toBeTruthy()
    expect(temEntrar(container)).toBe(false)
    expect(chamadas.chrome + chamadas.resumo).toBe(0)
  })

  it("resumo ATRASADO não deixa o chip anunciar sessão que não existe", () => {
    // Contexto anônimo + resumo pendente: o chip já diz "Visitante", porque quem sabe da
    // sessão é o servidor — não este fetch. Antes ele esperava o resumo para decidir.
    const { container } = render(
      <AdminProvider initial={ANON}>
        <AccountChip initialProfile={SEM_PERFIL} />
      </AdminProvider>,
    )
    expect(textoDe(container)).toContain("Visitante")
    expect(container.querySelector("img")).toBeNull()
  })

  /**
   * ⚠️ Casa o FATO — o campo não existe mais no DTO —, e não a grafia de uma linha do chip.
   * Enquanto ele existir em `AccountSummary`, alguém pode voltar a lê-lo.
   */
  it("`AccountSummary` não carrega mais `signedIn` nem `role`", async () => {
    const { readFileSync } = await import("node:fs")
    const fonte = readFileSync("server/actions/account.ts", "utf8")
    const dto = fonte.slice(fonte.indexOf("export interface AccountSummary"))
    const corpo = dto.slice(0, dto.indexOf("}"))
    expect(corpo).not.toMatch(/\bsignedIn\b/)
    expect(corpo).not.toMatch(/\brole\b/)
  })
})

describe("reconciliação — quem inicializa não impede quem corrige", () => {
  it("o servidor inicializa e o `app:chrome-refresh` continua atualizando", async () => {
    // A action resolve com um papel DIFERENTE do inicial: é o caso da troca de plano.
    const mod = await import("@/server/actions/admin")
    const espiao = vi.spyOn(mod, "getCurrentUserChrome").mockResolvedValue(CURADOR)
    const { container } = render(
      <AdminProvider initial={LEITOR}>
        <TopNav searchIndex={[]} initialProfile={SEM_PERFIL} />
      </AdminProvider>,
    )
    // Nasce leitor: sem porta de curadoria.
    expect(container.querySelector('a[href^="/curation"]')).toBeNull()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(CHROME_REFRESH_EVENT))
      await Promise.resolve()
    })
    expect(container.querySelector('a[href^="/curation"]')).toBeTruthy()
    espiao.mockRestore()
  })

  it("prop NOVA do servidor é adotada — é o caminho do login (redirect sem re-mount)", () => {
    const { container, rerender } = render(
      <AdminProvider initial={ANON}>
        <TopNav searchIndex={[]} initialProfile={SEM_PERFIL} />
      </AdminProvider>,
    )
    expect(temEntrar(container)).toBe(true)
    // Login: o servidor re-renderiza o layout e manda o estado novo, mas o Provider NÃO
    // re-monta. Sem adotar a prop, o chrome ficaria anônimo depois de entrar.
    rerender(
      <AdminProvider initial={CURADOR}>
        <TopNav searchIndex={[]} initialProfile={SEM_PERFIL} />
      </AdminProvider>,
    )
    expect(temEntrar(container)).toBe(false)
    expect(destinosVisiveis(container)).toEqual(DESTINOS_PRIVADOS)
  })

  it("prop IGUAL não desfaz o que o cliente reconciliou", async () => {
    const mod = await import("@/server/actions/admin")
    const espiao = vi.spyOn(mod, "getCurrentUserChrome").mockResolvedValue(CURADOR)
    const { container, rerender } = render(
      <AdminProvider initial={LEITOR}>
        <TopNav searchIndex={[]} initialProfile={SEM_PERFIL} />
      </AdminProvider>,
    )
    await act(async () => {
      window.dispatchEvent(new CustomEvent(CHROME_REFRESH_EVENT))
      await Promise.resolve()
    })
    expect(container.querySelector('a[href^="/curation"]')).toBeTruthy()
    // Re-render com a MESMA prop de antes: não pode reverter o estado mais novo.
    rerender(
      <AdminProvider initial={LEITOR}>
        <TopNav searchIndex={[]} initialProfile={SEM_PERFIL} />
      </AdminProvider>,
    )
    expect(container.querySelector('a[href^="/curation"]')).toBeTruthy()
    espiao.mockRestore()
  })
})

describe("uma autoridade só", () => {
  /**
   * ⚠️ Deriva do filesystem: o resolver é o dono, e o root layout tem de usá-lo em vez de
   * chamar a Server Action (módulo `"use server"` é superfície HTTP pública).
   */
  it("o root layout resolve pelo server-only, não pela Server Action", async () => {
    const { readFileSync } = await import("node:fs")
    const layout = readFileSync("app/layout.tsx", "utf8")
    expect(layout).toContain("readCurrentUserChrome")
    expect(layout).not.toContain("@/server/actions/admin")
    expect(layout).toMatch(/<AdminProvider\s+initial=/)
  })

  /**
   * 🔴 Este caso nasceu de uma sonda que NÃO reprovou: injetei `role: "leitor"` por cima do
   * resolver no layout e a suíte inteira passou verde — porque os testes de render montam o
   * `AdminProvider` à mão e nunca exercitam o layout. A ponte entre os dois não tinha rede.
   *
   * ⚠️ Captura o IDENTIFICADOR de que a prop deriva, em vez de casar o nome da variável:
   * renomear é mudança inocente e não pode pintar a suíte de vermelho. O que ele proíbe é a
   * prop carregar qualquer coisa que não seja, literalmente, o que o resolver devolveu.
   */
  it("o valor passado ao Provider É o que o resolver devolveu — sem override", async () => {
    const { readFileSync } = await import("node:fs")
    const layout = readFileSync("app/layout.tsx", "utf8")
    // ⚠️ Casa as DUAS formas: atribuição direta ou o destructuring do `Promise.all` que
    // resolve chrome e perfil juntos. O que a regra protege é o valor chegar INTACTO ao
    // Provider — não a forma de escrever a linha.
    const atribuicao =
      layout.match(/const\s+(\w+)\s*=\s*await\s+readCurrentUserChrome\(\)/) ??
      layout.match(/const\s*\[\s*(\w+)[^\]]*\]\s*=\s*await\s+Promise\.all\(\[\s*readCurrentUserChrome\(\)/)
    expect(atribuicao).toBeTruthy()
    const nome = atribuicao![1]
    expect(layout).toMatch(new RegExp(`<AdminProvider\\s+initial=\\{${nome}\\}`))
    // Nenhum papel escrito à mão no layout: quem decide é o resolver.
    expect(layout).not.toMatch(/role:\s*["'](curador|assinante|leitor)["']/)
  })

  it("a Server Action DERIVA do resolver — não repete a regra", async () => {
    const { readFileSync } = await import("node:fs")
    const action = readFileSync("server/actions/admin.ts", "utf8")
    const corpo = action.slice(action.indexOf("export async function getCurrentUserChrome"))
    expect(corpo).toContain("readCurrentUserChrome()")
    // A composição (sessão + papel) mora num lugar só.
    expect(corpo).not.toMatch(/getSessionUserId\s*\(/)
  })

  it("o Provider NÃO nasce anônimo por padrão", async () => {
    const { readFileSync } = await import("node:fs")
    const ctx = readFileSync("components/layout/admin-context.tsx", "utf8")
    expect(ctx).toMatch(/useState<CurrentUserChrome>\(initial\)/)
  })
})

describe("o mount não refaz o que o servidor entregou", () => {
  /**
   * 🔴 O arranjo server-first ficava pela metade sem isto: o HTML já vinha certo e a hidratação
   * disparava um POST só para reconfirmar `{signedIn, role}`. O dado nasce fresco — e o
   * primeiro disparo é redundante por construção, não por acaso de timing.
   *
   * ⚠️ "Não dispara no mount" não é "nunca mais dispara": navegação, TTL e
   * `app:chrome-refresh` seguem valendo. É o teste de reconciliação ao lado que garante isso.
   */
  it("getCurrentUserChrome NÃO é chamada na montagem", () => {
    montarNav(CURADOR)
    expect(chamadas.chrome).toBe(0)
  })

  it("getAccountSummary NÃO é chamada na montagem", () => {
    render(
      <AdminProvider initial={CURADOR}>
        <AccountChip initialProfile={PERFIL} />
      </AdminProvider>,
    )
    expect(chamadas.resumo).toBe(0)
  })

  it("nem para o anônimo — que também recebeu resposta do servidor", () => {
    montarNav(ANON)
    expect(chamadas.chrome).toBe(0)
  })
})

describe("profile nasce do servidor", () => {
  it("o avatar já está na tela no primeiro render, sem POST nenhum", () => {
    const { container } = render(
      <AdminProvider initial={CURADOR}>
        <AccountChip initialProfile={PERFIL} />
      </AdminProvider>,
    )
    const img = container.querySelector("img")
    expect(img).toBeTruthy()
    expect(img!.getAttribute("src")).toBe(PERFIL.avatarUrl)
    expect(chamadas.resumo).toBe(0)
  })

  it("o nome vem junto — nada de \"Minha conta\" enquanto o perfil não chega", () => {
    const { container } = render(
      <AdminProvider initial={CURADOR}>
        <AccountChip initialProfile={PERFIL} />
      </AdminProvider>,
    )
    expect(textoDe(container)).toContain("Ana")
  })

  it("perfil VAZIO não inventa avatar — o ícone neutro é o desfecho certo", () => {
    const { container } = render(
      <AdminProvider initial={CURADOR}>
        <AccountChip initialProfile={SEM_PERFIL} />
      </AdminProvider>,
    )
    expect(container.querySelector("img")).toBeNull()
  })

  /** ⚠️ Quem edita nome/avatar dispara `refreshChrome()`; é por aí que o valor novo entra. */
  it("mutação real (app:chrome-refresh) atualiza o perfil", async () => {
    resumo.valor = Promise.resolve({ displayName: "Outro Nome", email: null, avatarUrl: null })
    const { container } = render(
      <AdminProvider initial={CURADOR}>
        <AccountChip initialProfile={PERFIL} />
      </AdminProvider>,
    )
    expect(textoDe(container)).toContain("Ana")
    await act(async () => {
      window.dispatchEvent(new CustomEvent(CHROME_REFRESH_EVENT))
      await resumo.valor
    })
    expect(chamadas.resumo).toBe(1)
    expect(textoDe(container)).toContain("Outro Nome")
  })
})

describe("o profile também tem um dono server-only", () => {
  it("o layout resolve pelo query, não pela Server Action", async () => {
    const { readFileSync } = await import("node:fs")
    const layout = readFileSync("app/layout.tsx", "utf8")
    expect(layout).toContain("readAccountSummary")
    expect(layout).not.toContain("@/server/actions/account")
  })

  it("os dois resolvers partem em PARALELO — sem waterfall", async () => {
    const { readFileSync } = await import("node:fs")
    const layout = readFileSync("app/layout.tsx", "utf8")
    expect(layout).toMatch(/Promise\.all\(\[\s*readCurrentUserChrome\(\),\s*readAccountSummary\(\),?\s*\]\)/)
  })

  /**
   * 🔴 Nasceu de uma sonda que NÃO reprovou: troquei o `initialProfile` do layout por um objeto
   * vazio e a suíte passou inteira — porque os testes de render montam o chip à mão e nunca
   * exercitam a cadeia layout → TopNav → AccountChip. É a MESMA lacuna que a role já tinha
   * tido, e ela reaparece toda vez que a prova de ponta a ponta é substituída por uma
   * montagem conveniente.
   *
   * ⚠️ Captura o IDENTIFICADOR de que a prop deriva, não o nome da variável.
   */
  it("o perfil passado ao TopNav É o que o resolver devolveu — sem substituto", async () => {
    const { readFileSync } = await import("node:fs")
    const layout = readFileSync("app/layout.tsx", "utf8")
    const atribuicao = layout.match(
      /const\s*\[[^\]]*?,\s*(\w+)\s*\]\s*=\s*await\s+Promise\.all\(\[[\s\S]*?readAccountSummary\(\)/,
    ) ?? layout.match(/const\s+(\w+)\s*=\s*await\s+readAccountSummary\(\)/)
    expect(atribuicao).toBeTruthy()
    expect(layout).toMatch(new RegExp(`initialProfile=\\{${atribuicao![1]}\\}`))
    // Nenhum perfil literal no layout: quem decide é o resolver.
    expect(layout).not.toMatch(/initialProfile=\{\{/)
  })

  it("o TopNav repassa o perfil ao chip sem substituir", async () => {
    const { readFileSync } = await import("node:fs")
    const nav = readFileSync("components/layout/top-nav.tsx", "utf8")
    expect(nav).toMatch(/<AccountChip[^>]*initialProfile=\{initialProfile\}/)
  })

  it("a Server Action de resumo DERIVA do resolver", async () => {
    const { readFileSync } = await import("node:fs")
    const acao = readFileSync("server/actions/account.ts", "utf8")
    const corpo = acao.slice(acao.indexOf("export async function getAccountSummary"))
    expect(corpo.slice(0, 200)).toContain("readAccountSummary()")
  })
})
