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

import { render, screen, fireEvent } from "@testing-library/react"
import { CurationRequestActions } from "@/components/titles/curation-request-panel"

beforeEach(() => {
  papel = { role: "leitor", signedIn: true }
})

const montar = (props: Partial<Parameters<typeof CurationRequestActions>[0]> = {}) =>
  render(<CurationRequestActions workId="w1" pedidosAbertos={[]} {...props} />)

describe("CurationRequestActions — quem vê o quê", () => {
  it("leitor logado vê os três pedidos", () => {
    montar()
    expect(screen.getByText("Pedir atualização dos dados")).toBeTruthy()
    expect(screen.getByText("Pedir revisão da avaliação")).toBeTruthy()
    expect(screen.getByText("Reportar erro na ficha")).toBeTruthy()
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

const botao = (nome: RegExp) => screen.getByRole("button", { name: nome })

/**
 * O CAMPO de texto (migration 195). Teste de RENDER de propósito: a action pode estar perfeita
 * e o campo simplesmente não existir na tela, ou existir e não ser exigido — e a suíte de
 * `curation-requests.test.ts`, que só exercita o servidor, passaria verde nos dois casos.
 */
describe("o campo “o que está errado”", () => {
  it("clicar num pedido ABRE o formulário — não envia direto", () => {
    montar()
    fireEvent.click(botao(/Reportar erro na ficha/))

    expect(screen.getByRole("textbox"), "sem campo, o pedido volta a não dizer o quê").toBeTruthy()
    expect(screen.getByText("O que está errado?")).toBeTruthy()
    // Os outros botões saem de cena enquanto o formulário está aberto: dois pedidos meio
    // preenchidos ao mesmo tempo é estado que a tela não sabe representar.
    expect(screen.queryByRole("button", { name: /Pedir atualização/ })).toBeNull()
  })

  it("🔴 report_error não envia sem texto; os outros dois enviam", () => {
    const { unmount } = montar()
    fireEvent.click(botao(/Reportar erro na ficha/))
    expect(
      (botao(/Enviar pedido/) as HTMLButtonElement).disabled,
      "sem texto o pedido é ininteligível — o botão não pode estar clicável",
    ).toBe(true)

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a capa é do spin-off" } })
    expect((botao(/Enviar pedido/) as HTMLButtonElement).disabled).toBe(false)

    unmount()
    montar()
    fireEvent.click(botao(/Pedir atualização dos dados/))
    expect(
      (botao(/Enviar pedido/) as HTMLButtonElement).disabled,
      "aqui a nota é OPCIONAL — exigi-la travaria o pedido que já existia antes da 195",
    ).toBe(false)
  })

  it("o campo NÃO corta o que a pessoa cola", () => {
    montar()
    fireEvent.click(botao(/Reportar erro na ficha/))
    // `maxLength` trunca em silêncio, e cortar por unidade UTF-16 parte emoji ao meio — que é
    // como se fabrica o surrogate solto que derruba a escrita inteira. O excesso tem de ficar
    // visível na tela, com o botão desabilitado.
    expect(screen.getByRole("textbox").getAttribute("maxlength")).toBe(null)
  })

  it("excesso desabilita o envio e diz quanto sobra", async () => {
    const { CURATION_NOTE_MAX } = await import("@/server/queries/curation-requests")
    montar()
    fireEvent.click(botao(/Reportar erro na ficha/))
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "a".repeat(CURATION_NOTE_MAX + 7) },
    })

    expect((botao(/Enviar pedido/) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/7 caracteres a mais/)).toBeTruthy()
  })
})

describe("pedido já em aberto", () => {
  const aberto = (kind: string, note: string | null = null) => ({
    id: `p-${kind}`,
    kind: kind as never,
    quando: "hoje",
    note,
  })

  it("o texto volta pra quem escreveu", () => {
    montar({ pedidosAbertos: [aberto("report_error", "A capa é do spin-off.")] })
    // Sem isto, "você reportou um erro" não diz QUAL — e a pessoa não tem como saber se o que
    // ela viu já foi contado.
    expect(screen.getByText(/A capa é do spin-off\./)).toBeTruthy()
  })

  it("🔴 report_error segue disponível com um em aberto; update_data some", () => {
    montar({ pedidosAbertos: [aberto("report_error"), aberto("update_data")] })

    // "Rebusque esta obra" é UM pedido: o 2º clique não acrescenta nada e o botão sai.
    expect(screen.queryByRole("button", { name: /Pedir atualização dos dados/ })).toBeNull()
    // Erro relatado é TEXTO, e a mesma obra pode ter dois erros diferentes. Esconder o botão
    // deixaria a pessoa sem como contar o segundo — e a unicidade da 195 já permite os dois.
    expect(
      screen.queryByRole("button", { name: /Reportar erro na ficha/ }),
      "a régua daqui tem de casar com a chave única da 195, que inclui a NOTA",
    ).toBeTruthy()
  })

  it("ficha incompleta não oferece nem o report_error", () => {
    montar({ fichaIncompleta: true })
    // Ficha que ainda não foi preenchida não tem dado ERRADO — tem dado ausente, que é o que a
    // `IncompleteWorkBanner` já diz.
    expect(screen.queryByRole("button", { name: /Reportar erro/ })).toBeNull()
  })
})
