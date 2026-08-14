import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { useEffect } from "react"
import { buildChromeAlerts, alertDotTone } from "@/lib/curadoria/chrome-alerts"
import { LOW_BALANCE_USD } from "@/lib/ai-usage/balance"
import type { BalanceStatus } from "@/server/queries/ai-usage"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ usePathname: () => "/titles" }))
vi.mock("@/server/actions/account", () => ({ getBalanceSummary: vi.fn() }))

/** O saldo chega por fetch de cliente; aqui ele é injetado assim que monta. */
const balance: { current: BalanceStatus | null } = { current: null }
vi.mock("@/lib/use-refresh", () => ({
  useChromeData: (_fetch: unknown, setter: (v: BalanceStatus | null) => void) => {
    // `useEffect`, não chamada direta: setState durante o render do PAI é o que o
    // lint do React proíbe, e aqui produziria um aviso a cada teste.
    useEffect(() => setter(balance.current), [])
  },
}))

const badges = {
  curadoria: 0,
  recQueue: 0,
  requests: 0,
  settings: 0,
  settingsByGroup: {},
  recalcPending: false,
  comixHealth: "unknown" as "unknown" | "ok" | "degraded" | "down",
  clearRecalcPending: () => {},
}
vi.mock("@/components/layout/chrome-badges", () => ({ useChromeBadges: () => badges }))

import { CurationMenu } from "@/components/layout/curation-menu"

function status(remainingUsd: number | null): BalanceStatus {
  return {
    balanceUsd: 17.17,
    setAt: "2026-07-27T21:04:15.282+00:00",
    spentSinceUsd: remainingUsd == null ? 0 : 17.17 - remainingUsd,
    remainingUsd,
    callsSince: 1448,
  }
}

/**
 * O gatilho, pelo `href` — nem `getByRole("link")` solto, nem por nome acessível.
 *
 * Duas coisas atrapalham a query óbvia, e as duas são o modal fazendo o certo:
 * com saldo negativo o `NegativeBalanceDialog` abre junto e traz os próprios links
 * ("Adicionar créditos", "Reinformar o saldo"), e o Radix ainda marca todo o resto
 * da página como `aria-hidden` enquanto ele está aberto — então o botão de Curadoria
 * some da árvore de acessibilidade e `getByRole` não o acha. Buscar pelo destino é
 * o que continua valendo nos dois estados.
 */
function curationLink(): HTMLElement {
  const link = document.querySelector<HTMLElement>('a[href="/curadoria"]')
  if (!link) throw new Error("gatilho de Curadoria não renderizou")
  return link
}

function ariaLabel(): string {
  return curationLink().getAttribute("aria-label") ?? ""
}

function dotClasses(): string {
  // O ponto é o único `aria-hidden` com `rounded-full` dentro do link — o badge de
  // contagem tem texto e não é escondido de leitor de tela.
  const dot = curationLink().querySelector('[aria-hidden][class*="rounded-full"]')
  return dot?.className ?? ""
}

/**
 * O ponto colorido do gatilho de Curadoria e o texto que o explica.
 *
 * 🔴 **Teste de RENDER de propósito.** O que regride aqui não é a fórmula de
 * `buildChromeAlerts` — é o COMPONENTE deixar de consumi-la: um `if` de cor escrito
 * à mão no JSX passa verde em qualquer teste que chame só a função pura, e produz
 * exatamente a falha que a lista existe pra impedir (ponto vermelho, explicação
 * âmbar). Por isso cada caso confere a COR e o TEXTO na mesma árvore desenhada.
 */
describe("o ponto de alerta diz o que quer", () => {
  afterEach(() => {
    cleanup()
    balance.current = null
    badges.comixHealth = "unknown"
  })

  it("saldo negativo: ponto vermelho, e o rótulo traz o número", () => {
    balance.current = status(-11.1)
    render(<CurationMenu />)
    expect(dotClasses()).toContain("bg-rose-500")
    expect(ariaLabel()).toContain("Saldo da Anthropic: −$11,10")
  })

  it("saldo abaixo de $2: ponto âmbar", () => {
    balance.current = status(1.4)
    render(<CurationMenu />)
    expect(dotClasses()).toContain("bg-amber-500")
    expect(ariaLabel()).toContain("$1,40")
  })

  it("saldo entre $2 e $5 NÃO acende — o limiar caiu de 5 pra 2", () => {
    // Guarda a mudança pedida em 2026-08-14. Com o `<= 5` antigo esta faixa acendia
    // âmbar; se alguém reverter o limiar (ou trocar `<` por `<=` em $2), o ponto
    // volta a aparecer com folga e este caso reprova.
    balance.current = status(3)
    render(<CurationMenu />)
    expect(dotClasses()).toBe("")
  })

  it("exatamente no limiar ainda é folga", () => {
    balance.current = status(LOW_BALANCE_USD)
    render(<CurationMenu />)
    expect(dotClasses()).toBe("")
  })

  it("Comix fora do ar acende vermelho sem nenhum problema de dinheiro", () => {
    balance.current = status(40)
    badges.comixHealth = "down"
    render(<CurationMenu />)
    expect(dotClasses()).toContain("bg-rose-500")
    expect(ariaLabel()).toContain("Comix: fora do ar")
  })

  it("dois problemas ao mesmo tempo: um ponto, e o rótulo cita os DOIS", () => {
    // 🔴 A regressão que este caso pega: mostrar só o mais grave. Resolver o saldo
    // apagaria o ponto e o alerta da Comix junto, sem a Comix ter voltado.
    balance.current = status(-11.1)
    badges.comixHealth = "degraded"
    render(<CurationMenu />)
    const label = ariaLabel()
    expect(dotClasses()).toContain("bg-rose-500")
    expect(label).toContain("Saldo da Anthropic")
    expect(label).toContain("Comix: instável")
  })

  it("nada errado: sem ponto e sem alerta no rótulo", () => {
    balance.current = status(40)
    badges.comixHealth = "ok"
    render(<CurationMenu />)
    expect(dotClasses()).toBe("")
    expect(ariaLabel()).toBe("Curadoria do catálogo")
  })
})

/** A lista que sustenta o ponto — a cor tem que sair dela, não de um `if` paralelo. */
describe("buildChromeAlerts", () => {
  it("saldo negativo é crítico, não 'baixo'", () => {
    // Os tons são exclusivos entre si: um `tone === "low"` escrito à mão deixaria o
    // pior caso — o negativo — fora do alerta.
    const alerts = buildChromeAlerts({ remainingUsd: -0.01, comixHealth: "ok" })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe("critical")
    expect(alertDotTone(alerts)).toBe("rose")
  })

  it("um alerta crítico entre vários manda na cor", () => {
    const alerts = buildChromeAlerts({ remainingUsd: 1, comixHealth: "down" })
    expect(alerts.map((a) => a.key)).toEqual(["balance", "comix"])
    expect(alertDotTone(alerts)).toBe("rose")
  })

  it("saldo nunca informado não alerta", () => {
    // `null` é "nunca informado", não "zero" — alarmar aqui acenderia o ponto em toda
    // instalação nova, que é o alarme que ninguém lê.
    expect(buildChromeAlerts({ remainingUsd: null, comixHealth: "ok" })).toEqual([])
    expect(alertDotTone([])).toBeNull()
  })
})
