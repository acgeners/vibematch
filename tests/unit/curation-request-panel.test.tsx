import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

/**
 * Quem vê os botões de pedido. As três regras aqui são de PRODUTO, não de segurança — o
 * servidor recusa sozinho (`ensureSignedIn` na action) —, e por isso nenhuma delas quebra
 * nada quando some: o botão só passa a aparecer para quem ele não ajuda.
 *
 * A terceira é a que custou uma passada no browser para aparecer.
 */

let papel: { role: string; signedIn: boolean } = { role: "leitor", signedIn: true }

vi.mock("@/components/layout/admin-context", async () => {
  const { roleAllows } = await import("@/lib/plans/roles")
  return {
    useIsSignedIn: () => papel.signedIn,
    useCan: (p: Parameters<typeof roleAllows>[1]) =>
      roleAllows(papel.role as Parameters<typeof roleAllows>[0], p),
  }
})
vi.mock("@/server/actions/curation-requests", () => ({
  createCurationRequest: async () => ({ ok: true }),
  cancelCurationRequest: async () => ({ ok: true }),
}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => () => {} }))
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }))

import { render, screen } from "@testing-library/react"
import { CurationRequestActions } from "@/components/titles/curation-request-panel"

beforeEach(() => {
  papel = { role: "leitor", signedIn: true }
})

const montar = (props: Partial<Parameters<typeof CurationRequestActions>[0]> = {}) =>
  render(<CurationRequestActions workId="w1" pedidosAbertos={[]} {...props} />)

describe("CurationRequestActions — quem vê o quê", () => {
  it("leitor logado vê os dois pedidos", () => {
    montar()
    expect(screen.getByText("Pedir atualização dos dados")).toBeTruthy()
    expect(screen.getByText("Pedir revisão da avaliação")).toBeTruthy()
  })

  it("anônimo não vê nada — falta identidade, não permissão", () => {
    // O papel de um anônimo TAMBÉM é `leitor` (o contexto é fail-closed), então checar só a
    // permissão deixaria o botão aparecer para o visitante, que ao clicar tomaria
    // "Entre na sua conta". Isto cobre de quebra a janela em que o chrome ainda não respondeu.
    papel = { role: "leitor", signedIn: false }
    const { container } = montar()
    expect(container.textContent).toBe("")
  })

  it("curador não pede favor a si mesmo", () => {
    // Ele tem "Atualizar dados" e "✨ Avaliar" na mesma faixa; oferecer "pedir" ao lado seria
    // um botão que enfileira trabalho para a própria pessoa que está olhando.
    papel = { role: "curador", signedIn: true }
    const { container } = montar()
    expect(container.textContent).toBe("")
  })

  it("obra ainda não enriquecida NÃO oferece pedido", () => {
    // REGRESSÃO (achada no browser, não na suíte): `ai_eval_status = 'pending'` já É a fila do
    // curador — é o que alimenta o badge. Um pedido aqui seria uma segunda linha para o mesmo
    // trabalho, a dupla fonte de verdade que a migration 177 recusa por escrito. Quem explica
    // a espera é a faixa "Ficha incompleta", que não pede nada.
    montar({ fichaIncompleta: true })
    expect(screen.queryByText("Pedir atualização dos dados")).toBeNull()
    expect(screen.queryByText("Pedir revisão da avaliação")).toBeNull()
  })

  it("pedido em aberto vira aviso, e o OUTRO tipo segue disponível", () => {
    // A constraint é `(user_id, work_id, kind)`: os dois tipos coexistem na mesma obra. Se o
    // painel escondesse ambos ao ver um pedido, o segundo tipo ficaria inalcançável.
    montar({ pedidosAbertos: [{ id: "p1", kind: "update_data", quando: "ontem" }] })
    expect(screen.getByText("Você pediu uma atualização desta obra")).toBeTruthy()
    expect(screen.getByText("Cancelar pedido")).toBeTruthy()
    expect(screen.queryByText("Pedir atualização dos dados")).toBeNull()
    expect(screen.getByText("Pedir revisão da avaliação")).toBeTruthy()
  })
})
