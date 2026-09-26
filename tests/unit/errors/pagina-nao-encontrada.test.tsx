/**
 * O 404 fala PORTUGUÊS e não ecoa o que o visitante digitou.
 *
 * 🔴 O que ele substitui: até 2026-09-25 os 5 `notFound()` do trunk serviam a tela padrão
 * do Next — "404 | This page could not be found", em inglês, num app inteiro em pt-BR.
 * Um deles (`components/curation/console-shell.tsx`) é a resposta que um LEITOR LOGADO
 * recebe ao bater em `/curation`, e em inglês ele não distingue "errei o endereço" de
 * "não tenho acesso".
 *
 * Teste de RENDER de propósito: o que regride é a ÁRVORE DESENHADA — uma saída faltando,
 * o caminho pedido vazando para a tela. Nada disso aparece lendo a constante de texto.
 */
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import NotFound from "@/app/not-found"
import { NOT_FOUND_COPY, ERROR_COPY } from "@/lib/errors/copy"

afterEach(cleanup)

describe("app/not-found.tsx", () => {
  it("fala português — e não sobrou nada do fallback em inglês", () => {
    render(<NotFound />)
    expect(screen.getByText(NOT_FOUND_COPY.titulo)).toBeTruthy()
    expect(screen.getByText(NOT_FOUND_COPY.descricao)).toBeTruthy()

    const texto = document.body.textContent ?? ""
    for (const ingles of ["could not be found", "This page", "404 |", "Not Found"]) {
      expect(texto).not.toContain(ingles)
    }
  })

  it("oferece DUAS saídas navegáveis, e elas apontam para rotas reais", () => {
    render(<NotFound />)
    const inicio = screen.getByRole("link", { name: NOT_FOUND_COPY.inicio })
    const catalogo = screen.getByRole("link", { name: NOT_FOUND_COPY.catalogo })
    expect(inicio.getAttribute("href")).toBe("/")
    expect(catalogo.getAttribute("href")).toBe("/catalog")
  })

  it("NÃO oferece 'Tentar novamente' — 404 é definitivo, não transitório", () => {
    render(<NotFound />)
    expect(screen.queryByText(ERROR_COPY.tentarNovamente)).toBeNull()
    // e não há botão de ação que sugira recarregar
    expect(document.body.textContent).not.toContain("Tentar novamente")
  })

  it("não ecoa caminho, slug nem id pedido", () => {
    render(<NotFound />)
    const texto = document.body.textContent ?? ""
    // A tela não recebe o caminho — nem por prop, nem por leitura de window.
    expect(texto).not.toMatch(/\/catalog\/[a-z0-9-]{6,}/i)
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i) // uuid
  })

  it("o texto do 404 é DISTINTO do texto de erro — não prometem a mesma coisa", () => {
    expect(NOT_FOUND_COPY.titulo).not.toBe(ERROR_COPY.titulo)
    expect(NOT_FOUND_COPY.descricao).not.toBe(ERROR_COPY.descricao)
  })
})
