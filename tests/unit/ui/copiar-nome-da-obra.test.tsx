import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CopyButton } from "@/components/ui/copy-button"

/**
 * Teste de RENDER de propósito: o que regride aqui é o botão parar de escrever o que a
 * tela mostra — e isso só aparece na árvore desenhada, porque não há função pura a testar.
 *
 * As decisões que ele trava:
 *  - o valor vai TRIMADO (3 das 988 obras têm título com espaço nas pontas, medido em
 *    2026-08-17), que é justamente o "sem espaço nenhum" que o botão existe pra entregar;
 *  - nada de `\n` — o defeito de origem era o triple-click colando "Título\n\n";
 *  - falha da área de transferência não pode ser silenciosa: o botão não pode anunciar
 *    "Copiado!" quando nada foi copiado.
 */

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

function mockClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  })
}

// ⚠️ jsdom NÃO implementa `document.execCommand` — nem como stub —, então `vi.spyOn`
// estoura ("property is not defined"). O fallback existe para browser de verdade em
// contexto não-seguro; aqui ele só pode ser instalado à mão.
function mockExecCommand(result: boolean) {
  const fn = vi.fn().mockReturnValue(result)
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true, writable: true })
  return fn
}

beforeEach(() => {
  toastError.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("CopyButton — copiar o nome da obra", () => {
  it("escreve o texto exato, sem espaço nas pontas e sem quebra de linha", async () => {
    const escrito: string[] = []
    mockClipboard(async (text) => {
      escrito.push(text)
    })

    render(<CopyButton value="Horimiya " label="Copiar o nome da obra" />)
    fireEvent.click(screen.getByRole("button", { name: "Copiar o nome da obra" }))

    await waitFor(() => expect(escrito).toEqual(["Horimiya"]))
    expect(escrito[0]).not.toMatch(/[\n\r]/)
  })

  it("confirma na tela depois de copiar", async () => {
    mockClipboard(async () => {})

    render(<CopyButton value="As the Heart Leads" label="Copiar o nome da obra" copiedLabel="Nome copiado!" />)
    fireEvent.click(screen.getByRole("button", { name: "Copiar o nome da obra" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Nome copiado!" })).toBeTruthy())
    expect(screen.getByRole("status").textContent).toBe("Nome copiado!")
  })

  it("não anuncia sucesso quando a área de transferência recusa", async () => {
    mockClipboard(async () => {
      throw new Error("bloqueado")
    })
    // O fallback do `execCommand` também falha — é o caso "não deu de jeito nenhum".
    mockExecCommand(false)

    render(<CopyButton value="As the Heart Leads" label="Copiar o nome da obra" copiedLabel="Nome copiado!" />)
    fireEvent.click(screen.getByRole("button", { name: "Copiar o nome da obra" }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole("button", { name: "Nome copiado!" })).toBeNull()
  })

  it("cai no fallback do execCommand quando não há navigator.clipboard", async () => {
    mockClipboard(undefined)
    const execCommand = mockExecCommand(true)

    render(<CopyButton value=" Growing the Seed of Evil" label="Copiar o nome da obra" copiedLabel="Nome copiado!" />)
    fireEvent.click(screen.getByRole("button", { name: "Copiar o nome da obra" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Nome copiado!" })).toBeTruthy())
    expect(execCommand).toHaveBeenCalledWith("copy")
    expect(toastError).not.toHaveBeenCalled()
  })
})
