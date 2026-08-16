import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen, fireEvent } from "@testing-library/react"

vi.mock("server-only", () => ({}))
// O painel importa a action de upload, que puxa a cadeia de server actions inteira.
// Só o caminho de MONTAR é exercitado aqui; o upload tem seu próprio caminho.
vi.mock("@/server/actions/account", () => ({ uploadAvatar: vi.fn() }))

import { AvatarPicker } from "@/components/account/avatar-picker"
import { parseAvatarUrl, avatarConfigToUrl } from "@/lib/avatar/url"
import { CONFIG_PADRAO, ESTILOS_SIMBOLO, ESTILO_POR_ID } from "@/lib/avatar/render"

/**
 * O painel de avatar, em RENDER — de propósito.
 *
 * O que regride aqui não é fórmula, é ESCOPO: as três coisas guardadas abaixo passariam
 * verdes num teste que só chamasse `avatarConfigToUrl`.
 *
 *   1. a miniatura de estilo tem que seguir a paleta ATUAL (é a prova de que preset e
 *      montado são o mesmo renderizador — se ela fosse imagem fixa, a grade mostraria
 *      uma coisa e o chip outra);
 *   2. controle sem efeito (pele/olhos em símbolo ou máscara) tem que SUMIR, não ficar
 *      clicável sem fazer nada;
 *   3. imagem que não carrega é ESTADO — foi o `onError` calado que deixou o avatar do
 *      dono apontando pra um projeto Supabase extinto sem ninguém perceber.
 */
afterEach(cleanup)

const estiloDe = (url: string) => parseAvatarUrl(url)?.estilo

describe("painel de avatar: montar", () => {
  it("escolher um estilo emite uma URL que volta a virar config", () => {
    const onChange = vi.fn()
    render(<AvatarPicker value="" onChange={onChange} />)

    fireEvent.click(screen.getByTitle("Kaito"))

    expect(onChange).toHaveBeenCalledTimes(1)
    const url = onChange.mock.calls[0][0] as string
    expect(estiloDe(url)).toBe("kaito")
    // Ida e volta completa: o que foi emitido reabre o editor no mesmo lugar.
    expect(parseAvatarUrl(url)).toEqual({ ...CONFIG_PADRAO, estilo: "kaito" })
  })

  it("trocar a cor mantém o estilo já escolhido", () => {
    const onChange = vi.fn()
    const inicial = avatarConfigToUrl({ ...CONFIG_PADRAO, estilo: "rin" })
    render(<AvatarPicker value={inicial} onChange={onChange} />)

    fireEvent.click(screen.getByTitle("Rosa"))

    const config = parseAvatarUrl(onChange.mock.calls[0][0] as string)
    expect(config?.estilo).toBe("rin")
    expect(config?.cabelo).toBe("#c9497e")
  })

  it("a miniatura de estilo usa a paleta atual, não uma imagem fixa", () => {
    const { container: comPadrao } = render(<AvatarPicker value="" onChange={vi.fn()} />)
    const padrao = comPadrao.querySelector<HTMLImageElement>('img[alt=""]')!.src
    cleanup()

    const rosa = avatarConfigToUrl({ ...CONFIG_PADRAO, cabelo: "#c9497e" })
    const { container: comRosa } = render(<AvatarPicker value={rosa} onChange={vi.fn()} />)
    const depois = comRosa.querySelector<HTMLImageElement>('img[alt=""]')!.src

    expect(depois).not.toBe(padrao)
    expect(decodeURIComponent(depois)).toContain("#c9497e")
  })

  it("símbolo esconde pele e olhos; personagem comum mostra", () => {
    const simbolo = ESTILOS_SIMBOLO[0]
    render(
      <AvatarPicker
        value={avatarConfigToUrl({ ...CONFIG_PADRAO, estilo: simbolo.id })}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByText("Tom de pele")).toBeNull()
    expect(screen.queryByText("Olhos")).toBeNull()
    // E o rótulo da cor acompanha: num símbolo não existe "cabelo".
    expect(screen.getByText("Cor do motivo")).toBeTruthy()
    cleanup()

    render(<AvatarPicker value={avatarConfigToUrl(CONFIG_PADRAO)} onChange={vi.fn()} />)
    expect(screen.getByText("Tom de pele")).toBeTruthy()
    expect(screen.getByText("Olhos")).toBeTruthy()
    expect(screen.getByText("Cor do cabelo")).toBeTruthy()
  })

  it("máscara também esconde pele e olhos, e diz por quê", () => {
    // A Kitsune é personagem (tem busto), mas a máscara cobre o rosto — se o corte
    // fosse só "é símbolo?", os dois controles ficariam ali sem efeito nenhum.
    expect(ESTILO_POR_ID["kitsune"].substituiRosto).toBeTruthy()
    render(
      <AvatarPicker
        value={avatarConfigToUrl({ ...CONFIG_PADRAO, estilo: "kitsune" })}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByText("Tom de pele")).toBeNull()
    expect(screen.getByText(/máscara cobre o rosto/i)).toBeTruthy()
  })

  it("sortear emite uma config válida", () => {
    const onChange = vi.fn()
    render(<AvatarPicker value="" onChange={onChange} />)
    fireEvent.click(screen.getByText("Sortear"))
    expect(parseAvatarUrl(onChange.mock.calls[0][0] as string)).not.toBeNull()
  })
})

describe("painel de avatar: os outros dois estados", () => {
  it("sem avatar não há 'Remover' — e nenhum ESTILO aparece marcado", () => {
    const { container } = render(<AvatarPicker value="" onChange={vi.fn()} />)
    expect(screen.queryByText("Remover")).toBeNull()

    // Só os ESTILOS: as cores continuam com uma marcada, e isso está certo — elas são
    // a config de TRABALHO (o ponto de partida de quem ainda não escolheu nada). O
    // botão de estilo é o que tem miniatura dentro.
    const estiloMarcado = [...container.querySelectorAll('[role="radio"][aria-checked="true"]')]
      .filter((b) => b.querySelector("img"))
    expect(estiloMarcado).toHaveLength(0)
  })

  it("'Remover' zera o valor", () => {
    const onChange = vi.fn()
    render(<AvatarPicker value={avatarConfigToUrl(CONFIG_PADRAO)} onChange={onChange} />)
    fireEvent.click(screen.getByText("Remover"))
    expect(onChange).toHaveBeenCalledWith("")
  })

  it("imagem enviada que não carrega vira AVISO, não silêncio", () => {
    // Regressão direta do caso real: `avatar_url` apontava pro projeto
    // `djbreiyzwoevbmoscqiq`, que nem resolve em DNS. O `onError` caía no ícone padrão
    // e a tela afirmava "você não tem avatar" — a URL morta ficou meses invisível.
    const morta = "https://djbreiyzwoevbmoscqiq.supabase.co/storage/v1/object/public/avatars/x/y.jpg"
    const { container } = render(<AvatarPicker value={morta} onChange={vi.fn()} />)

    expect(screen.queryByText(/não carrega/i)).toBeNull()
    fireEvent.error(container.querySelector('img[alt="Seu avatar"]')!)
    expect(screen.getByText(/não carrega/i)).toBeTruthy()
  })
})
