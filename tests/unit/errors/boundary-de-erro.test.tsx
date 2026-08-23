/**
 * O boundary substitui o fallback genérico do Next SEM virar um vazamento.
 *
 * 🔴 O que ele substitui foi medido em 2026-08-23: "This page couldn't load / A server error
 * occurred. Reload to try again." — inglês, num app em português, com um número cru ao lado.
 *
 * Teste de RENDER de propósito: o que regride aqui é a ÁRVORE DESENHADA (um detalhe interno
 * escapando para a tela, o botão desconectado do callback), e nada disso aparece num teste
 * que leia funções puras.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import AppError from "@/app/error"
import GlobalError from "@/app/global-error"
import { ERROR_COPY } from "@/lib/errors/copy"

/**
 * `location.reload` do jsdom não navega (e avisa "Not implemented"), então ele é substituído
 * por um espião. É o único jeito de provar o CLIQUE sem depender de navegação real — a
 * navegação de verdade é provada em runtime, no browser.
 */
let reloadSpy: ReturnType<typeof vi.fn>
const locationOriginal = window.location

beforeEach(() => {
  reloadSpy = vi.fn()
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...locationOriginal, reload: reloadSpy, assign: vi.fn(), replace: vi.fn() },
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: locationOriginal })
})

/** Um erro com TUDO que não pode chegar à tela. */
function erroVenenoso(digest?: string) {
  const err = Object.assign(
    new Error(
      'Falha lendo user_settings: apikey=OPACA_APIKEY jwt=eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SIG ' +
        'service_role=OPACA_ROLE user=leitor@exemplo.test — relation "public.works" does not exist',
    ),
    digest ? { digest } : {},
  )
  err.stack = `Error: ${err.message}\n    at getRanking (/app/server/queries/ranking.ts:693:11)`
  return err as Error & { digest?: string }
}

/** Tudo que NÃO pode aparecer em tela nenhuma. */
const PROIBIDOS = [
  "OPACA_APIKEY", "eyJhbGciOiJIUzI1NiJ9", "PAYLOAD", "OPACA_ROLE", "leitor@exemplo.test",
  "user_settings", "public.works", "apikey", "service_role", "getRanking", "ranking.ts",
  "does not exist", "Error:", "at ",
]

describe("A — boundary normal (app/error.tsx)", () => {
  it("fala PORTUGUÊS e oferece as duas ações", () => {
    render(<AppError error={erroVenenoso()} />)
    expect(screen.getByText(ERROR_COPY.titulo)).toBeTruthy()
    expect(screen.getByText(ERROR_COPY.descricao)).toBeTruthy()
    expect(screen.getByRole("button", { name: ERROR_COPY.tentarNovamente })).toBeTruthy()
    const inicio = screen.getByRole("link", { name: ERROR_COPY.inicio })
    expect(inicio.getAttribute("href")).toBe("/")
  })

  it("NÃO mostra a mensagem interna nem o stack", () => {
    const { container } = render(<AppError error={erroVenenoso()} />)
    const texto = container.textContent ?? ""
    for (const p of PROIBIDOS) expect(texto).not.toContain(p)
  })

  it("não escapa nem pelo HTML (atributo, title, data-*)", () => {
    const { container } = render(<AppError error={erroVenenoso("d1")} />)
    for (const p of PROIBIDOS) expect(container.innerHTML).not.toContain(p)
  })
})

describe("B — retry é RELOAD DE DOCUMENTO", () => {
  /**
   * 🔴 Guarda da decisão de 2026-08-23, tomada por MEDIÇÃO. Probe determinístico (falha →
   * causa removida → clique), build de produção local:
   *
   *   `reset()`          — não recupera em nenhuma entrada (o boundary fica na tela).
   *   `unstable_retry()` — recupera em navegação client-side; na CARGA DIRETA não recupera
   *                        e ainda troca este boundary pelo fallback interno do Next, em
   *                        inglês. Carga direta é a forma do incidente.
   *
   * Recarregar recupera nos dois caminhos e, com a falha ainda de pé, volta a ESTE boundary
   * em vez de degradar. Um teste que continuasse exigindo `unstable_retry` protegeria a
   * decisão que acabamos de rejeitar.
   */
  it("clicar recarrega o documento", () => {
    render(<AppError error={erroVenenoso()} />)
    expect(reloadSpy).not.toHaveBeenCalled()
    screen.getByRole("button", { name: ERROR_COPY.tentarNovamente }).click()
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it("NÃO recarrega sozinho — só no clique, sem timer nem tentativa automática", async () => {
    vi.useFakeTimers()
    try {
      render(<AppError error={erroVenenoso()} />)
      vi.advanceTimersByTime(30_000)
      expect(reloadSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("o global-error recarrega pelo mesmo caminho", () => {
    const host = document.createElement("div")
    render(<GlobalError error={erroVenenoso("g2")} />, { container: host })
    host.querySelector("button")!.click()
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it("'Ir para o início' continua sendo NAVEGAÇÃO, não reload", () => {
    render(<AppError error={erroVenenoso()} />)
    const inicio = screen.getByRole("link", { name: ERROR_COPY.inicio })
    expect(inicio.getAttribute("href")).toBe("/")
    expect(reloadSpy).not.toHaveBeenCalled()
  })
})

describe("C — política do digest: exibido, discreto, e SÓ ele", () => {
  it("com digest, imprime a referência", () => {
    render(<AppError error={erroVenenoso("3178174270")} />)
    const ref = screen.getByText(`${ERROR_COPY.referencia} 3178174270`)
    expect(ref).toBeTruthy()
    // Discreto: tamanho reduzido e cor esmaecida, não um destaque.
    expect(ref.className).toMatch(/text-\[11px\]/)
    expect(ref.className).toMatch(/muted-foreground/)
  })

  it("o digest NÃO é a mensagem interna — a referência é só o hash", () => {
    const { container } = render(<AppError error={erroVenenoso("3178174270")} />)
    const texto = container.textContent ?? ""
    expect(texto).toContain("3178174270")
    for (const p of PROIBIDOS) expect(texto).not.toContain(p)
  })

  it("SEM digest, a linha some — nada de 'Referência: undefined'", () => {
    render(<AppError error={erroVenenoso()} />)
    expect(screen.queryByText(new RegExp(ERROR_COPY.referencia))).toBeNull()
    expect((document.body.textContent ?? "")).not.toContain("undefined")
  })
})

describe("D — global boundary (app/global-error.tsx)", () => {
  /**
   * 🔴 A estrutura é conferida na renderização de SERVIDOR, não no jsdom. Medido: ao montar
   * num `<div>`, o react-dom do cliente DESCARTA `<html>` e `<body>` — sobra só o `<main>`.
   * Um teste de cliente não teria como ver o requisito estrutural, e casar a string no source
   * protegeria a grafia, não o fato. `renderToStaticMarkup` devolve o documento real.
   */
  const markup = () =>
    renderToStaticMarkup(<GlobalError error={erroVenenoso("g1")} />)

  /** Para o que é comportamento (clique), o jsdom serve — sem html/body no caminho. */
  function desenharGlobal(err = erroVenenoso("g1")) {
    const host = document.createElement("div")
    const r = render(<GlobalError error={err} />, { container: host })
    return { host, r }
  }

  it("traz documento PRÓPRIO: <html lang=pt-BR> e <body>", () => {
    const html = markup()
    expect(html).toMatch(/<html[^>]*lang="pt-BR"/)
    expect(html).toContain("<body")
    expect(html).toContain("</body>")
    expect(html).toContain("</html>")
  })

  it("não parece página quebrada: estilo próprio, sem depender do CSS do app", () => {
    const html = markup()
    // Estilo INLINE porque o root layout — dono do globals.css — é justamente o que falhou.
    const body = /<body style="([^"]*)"/.exec(html)
    expect(body).toBeTruthy()
    expect(body![1]).toContain("background")
    expect(body![1]).toContain("color")
    // E nenhuma classe do Tailwind, que dependeria do CSS que pode não ter carregado.
    expect(html).not.toContain("class=")
    expect(html).toContain("SatorIA")
  })

  it("mesma cópia do boundary normal, e as duas ações", () => {
    const { host } = desenharGlobal()
    expect(host.textContent).toContain(ERROR_COPY.titulo)
    const botao = host.querySelector("button")!
    expect(botao.textContent).toBe(ERROR_COPY.tentarNovamente)
    botao.click()
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    // Navegação de DOCUMENTO: o router pode ter caído junto com o root layout.
    const link = host.querySelector('a[href="/"]')!
    expect(link.textContent).toBe(ERROR_COPY.inicio)
  })

  it("também não vaza detalhe interno", () => {
    const { host } = desenharGlobal()
    for (const p of PROIBIDOS) expect(host.innerHTML).not.toContain(p)
  })
})

describe("E — privacidade: os dois boundaries, mesmo erro venenoso", () => {
  it("nenhum valor sensível sobrevive em NENHUM dos dois", () => {
    const host = document.createElement("div")
    const a = render(<AppError error={erroVenenoso("x9")} />)
    const g = render(<GlobalError error={erroVenenoso("x9")} />, { container: host })
    for (const html of [a.container.innerHTML, g.container.innerHTML]) {
      for (const p of PROIBIDOS) expect(html).not.toContain(p)
    }
  })
})
