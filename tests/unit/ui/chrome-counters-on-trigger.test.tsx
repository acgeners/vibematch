import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ usePathname: () => "/catalog" }))
vi.mock("@/server/actions/auth", () => ({ signOutAction: vi.fn() }))
vi.mock("@/server/actions/account", () => ({
  getAccountSummary: vi.fn(),
  getBalanceSummary: vi.fn(),
}))

// O hook busca no cliente; aqui só o valor inicial importa — o que se testa é o
// que a barra DESENHA sem que ninguém abra menu nenhum.
vi.mock("@/lib/use-refresh", () => ({ useChromeData: () => {} }))

const badges = {
  curadoria: 0,
  recQueue: 0,
  requests: 0,
  settings: 0,
  settingsByGroup: {},
  recalcPending: false,
  comixHealth: "unknown" as const,
  clearRecalcPending: () => {},
}
vi.mock("@/components/layout/chrome-badges", () => ({ useChromeBadges: () => badges }))

const session = { signedIn: true }
vi.mock("@/components/layout/admin-context", () => ({
  useIsSignedIn: () => session.signedIn,
  useIsAdmin: () => false,
}))

import { AccountChip } from "@/components/layout/account-chip"
import { CurationMenu } from "@/components/layout/curation-menu"

/**
 * O contador tem que estar no GATILHO — não dentro do menu.
 *
 * É a invariante que sustentou recolher fila de curadoria, saldo e alerta de fontes
 * pra dentro de um dropdown: a nota antiga do CLAUDE.md ("ficam como ícone porque
 * dentro de um dropdown o número não é visto") continua verdadeira, e o que a resolve
 * é o badge subir pro gatilho. Se o badge sumir, os ícones soltos têm que voltar.
 *
 * ⚠️ O dropdown de Curadoria já nem existe mais — virou botão-link pra `/curation`,
 * porque curadoria é MODO e não ação pontual. Isso não afrouxa a invariante, aperta:
 * sem menu pra abrir, o badge é o único aviso de que há trabalho lá dentro. (O avatar
 * segue sendo dropdown, e para ele a regra vale na forma original.)
 *
 * 🔴 **Isto é teste de RENDER de propósito.** A primeira versão era varredura de
 * source procurando `recQueue > 0` no trecho do gatilho — e passava com o badge
 * desligado (`signedIn && false &&`), porque o mesmo `recQueue > 0` aparecia no
 * `title` do botão. Texto no arquivo não distingue "condição certa" de "condição
 * desligada"; só renderizar distingue.
 */
describe("contador do chrome aparece sem abrir o menu", () => {
  afterEach(() => {
    cleanup()
    Object.assign(badges, { curadoria: 0, recQueue: 0, requests: 0 })
    session.signedIn = true
  })

  it("avatar mostra a fila de recomendação no gatilho", () => {
    Object.assign(badges, { recQueue: 3 })
    render(<AccountChip compact />)
    expect(screen.getByText("3")).toBeDefined()
  })

  it("sem fila, o avatar não inventa um zero", () => {
    render(<AccountChip compact />)
    expect(screen.queryByText("0")).toBeNull()
  })

  it("visitante não vê o número — a contagem é do catálogo, não dele", () => {
    // `recQueue` sai de `getAlignmentQueueWorks`, que conta obras do CATÁLOGO. Sem o gate
    // de sessão o anônimo veria o número do dono — a família do [[gotcha-anonimo-vira-dono]].
    session.signedIn = false
    Object.assign(badges, { recQueue: 3 })
    render(<AccountChip compact />)
    expect(screen.queryByText("3")).toBeNull()
  })

  it("Curadoria soma no gatilho o que a Visão geral detalha", () => {
    // 2 na fila de atributos + 1 pedido do leitor = 3 esperando decisão.
    //
    // Desde que o dropdown virou botão-link (2026-08-07), este número é o ÚNICO sinal
    // de que há trabalho na console pra quem está fora dela — não há mais menu pra abrir
    // e conferir. As duas parcelas saem de `DECISION_QUEUES`, a mesma lista que a Visão
    // geral itera, então o badge nunca aponta pra uma página que não o explica.
    Object.assign(badges, { curadoria: 2, requests: 1 })
    render(<CurationMenu />)
    expect(screen.getByText("3")).toBeDefined()
  })

  it("sem pendência, Curadoria não mostra badge", () => {
    render(<CurationMenu />)
    expect(screen.queryByText("0")).toBeNull()
  })
})
