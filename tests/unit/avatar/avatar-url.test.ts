import { describe, it, expect } from "vitest"
import {
  avatarConfigToUrl,
  isBuiltAvatarUrl,
  isValidAvatarUrl,
  parseAvatarUrl,
  sanitizeAvatarConfig,
} from "@/lib/avatar/url"
import {
  CABELOS,
  CONFIG_PADRAO,
  ESTILOS,
  ESTILOS_PERSONAGEM,
  ESTILOS_SIMBOLO,
  FUNDOS,
  OLHOS_CORES,
  PELES,
  renderAvatar,
} from "@/lib/avatar/render"

/**
 * O avatar montado é DERIVADO da URL — não há coluna de configuração, e `avatar_url`
 * segue dona única. Isso põe duas coisas em jogo, e é o que este arquivo guarda:
 *
 *   1. a ida e volta config → URL → config tem que ser exata, senão reabrir o editor
 *      mostra um avatar diferente do que está salvo;
 *   2. a URL vem de FORA (banco, query string, qualquer um), e o renderizador
 *      interpola cor direto em atributo SVG numa resposta `image/svg+xml`.
 */
describe("avatar: a URL é a configuração", () => {
  it("ida e volta preserva a config, para TODO estilo", () => {
    for (const estilo of ESTILOS) {
      const config = { ...CONFIG_PADRAO, estilo: estilo.id, cabelo: "#c9497e" }
      expect(parseAvatarUrl(avatarConfigToUrl(config))).toEqual(config)
    }
  })

  it("reconhece as três formas de avatar_url", () => {
    expect(isValidAvatarUrl("")).toBe(true)
    expect(isValidAvatarUrl(avatarConfigToUrl(CONFIG_PADRAO))).toBe(true)
    expect(isValidAvatarUrl("https://x.supabase.co/storage/v1/object/public/avatars/a/b.jpg")).toBe(true)
    expect(isValidAvatarUrl("javascript:alert(1)")).toBe(false)
    expect(isValidAvatarUrl("nem url nem avatar")).toBe(false)
  })

  it("só o montado é 'built' — upload e vazio não são", () => {
    expect(isBuiltAvatarUrl(avatarConfigToUrl(CONFIG_PADRAO))).toBe(true)
    expect(isBuiltAvatarUrl("https://x/y.jpg")).toBe(false)
    expect(isBuiltAvatarUrl("")).toBe(false)
    expect(isBuiltAvatarUrl(null)).toBe(false)
    // Não pode casar a rota sem query string: sem params não há config pra reabrir.
    expect(isBuiltAvatarUrl("/avatar.svg")).toBe(false)
  })

  it("parseAvatarUrl devolve null pro que não é montado", () => {
    expect(parseAvatarUrl("https://x/y.jpg")).toBeNull()
    expect(parseAvatarUrl("")).toBeNull()
    expect(parseAvatarUrl(undefined)).toBeNull()
  })
})

describe("avatar: sanitize é a fronteira de confiança", () => {
  // 🔴 A rota devolve `image/svg+xml`, que o browser executa como DOCUMENTO se alguém
  // navegar até ela. Uma cor que feche o atributo injeta markup — por isso nada chega
  // ao renderizador sem passar por aqui. Entrada suja não é erro: vira o padrão.
  const ATAQUES = [
    '"><script>alert(1)</script>',
    "red' onload='alert(1)",
    '#fff" onload="alert(1)',
    "url(javascript:alert(1))",
    "</svg><script>alert(1)</script>",
    "&#x22;&#x3E;",
  ]

  it("cor hostil nunca sobrevive ao sanitize", () => {
    for (const ataque of ATAQUES) {
      const c = sanitizeAvatarConfig({ cabelo: ataque, pele: ataque, olhos: ataque, fundo: ataque })
      expect(c.cabelo).toBe(CONFIG_PADRAO.cabelo)
      expect(c.pele).toBe(CONFIG_PADRAO.pele)
      expect(c.olhos).toBe(CONFIG_PADRAO.olhos)
      expect(c.fundo).toBe(CONFIG_PADRAO.fundo)
    }
  })

  it("nem o SVG renderizado com entrada hostil ganha markup novo", () => {
    for (const ataque of ATAQUES) {
      const svg = renderAvatar(
        sanitizeAvatarConfig({ estilo: ataque, cabelo: ataque, pele: ataque, olhos: ataque, fundo: ataque }),
      )
      expect(svg).not.toContain("<script")
      expect(svg).not.toContain("onload")
      expect(svg).not.toContain("javascript:")
    }
  })

  it("estilo desconhecido cai no padrão em vez de quebrar", () => {
    // URL velha, de uma paleta ou elenco que não existe mais, tem que continuar
    // desenhando alguém — o chip não pode ficar vazio por causa de um rename.
    expect(sanitizeAvatarConfig({ estilo: "personagem-aposentado" }).estilo).toBe(CONFIG_PADRAO.estilo)
  })

  it("aceita hex com e sem #, e normaliza pra minúsculo", () => {
    expect(sanitizeAvatarConfig({ cabelo: "C9497E" }).cabelo).toBe("#c9497e")
    expect(sanitizeAvatarConfig({ cabelo: "#C9497E" }).cabelo).toBe("#c9497e")
    // 3 dígitos NÃO passa: o resto do código assume 6 ao fatiar o `#` fora.
    expect(sanitizeAvatarConfig({ cabelo: "fff" }).cabelo).toBe(CONFIG_PADRAO.cabelo)
  })
})

describe("avatar: o renderizador é único", () => {
  it("todo estilo desenha um SVG completo", () => {
    for (const estilo of ESTILOS) {
      const svg = renderAvatar({ ...CONFIG_PADRAO, estilo: estilo.id })
      expect(svg.startsWith("<svg"), estilo.id).toBe(true)
      expect(svg.trimEnd().endsWith("</svg>"), estilo.id).toBe(true)
      // `undefined` vazando de um campo opcional de `Estilo` sai como texto no SVG.
      expect(svg, estilo.id).not.toContain("undefined")
    }
  })

  it("os gradientes são userSpaceOnUse", () => {
    // ⚠️ Com o padrão `objectBoundingBox`, um traço VERTICAL tem bbox de largura zero
    // e a spec manda NÃO renderizar o elemento: a haste do Bambu sumia inteira, sem
    // erro nenhum. Medido no Chromium antes de virar esta linha.
    const svg = renderAvatar(CONFIG_PADRAO)
    expect(svg).not.toContain("objectBoundingBox")
    expect((svg.match(/gradientUnits="userSpaceOnUse"/g) ?? []).length).toBe(2)
  })

  it("personagem e símbolo particionam os estilos, sem sobra", () => {
    expect(ESTILOS_PERSONAGEM.length + ESTILOS_SIMBOLO.length).toBe(ESTILOS.length)
    expect(ESTILOS_PERSONAGEM.some((e) => e.substituiTudo)).toBe(false)
    expect(ESTILOS_SIMBOLO.every((e) => e.substituiTudo)).toBe(true)
  })

  it("ids de estilo são únicos", () => {
    // Id repetido faz `ESTILO_POR_ID` perder um silenciosamente, e a grade mostra
    // dois botões que levam ao mesmo desenho.
    expect(new Set(ESTILOS.map((e) => e.id)).size).toBe(ESTILOS.length)
  })

  it("símbolo ignora pele e olhos — é por isso que a UI esconde os controles", () => {
    const simbolo = ESTILOS_SIMBOLO[0]
    const a = renderAvatar({ ...CONFIG_PADRAO, estilo: simbolo.id, pele: "#000000", olhos: "#000000" })
    const b = renderAvatar({ ...CONFIG_PADRAO, estilo: simbolo.id, pele: "#ffffff", olhos: "#ffffff" })
    expect(a).toBe(b)
  })
})

describe("avatar: as paletas são o dono único das opções", () => {
  it("toda cor oferecida é hex de 6 dígitos e sobrevive ao sanitize", () => {
    for (const paleta of [CABELOS, PELES, OLHOS_CORES, FUNDOS]) {
      for (const opcao of paleta) {
        expect(opcao.cor, opcao.nome).toMatch(/^#[0-9a-fA-F]{6}$/)
        expect(sanitizeAvatarConfig({ cabelo: opcao.cor }).cabelo).toBe(opcao.cor.toLowerCase())
      }
    }
  })

  it("o padrão é montável pelos controles da tela", () => {
    // Sem isto, a config inicial poderia usar uma cor que nenhuma paleta oferece:
    // a pessoa mexeria num controle e não teria como voltar ao estado original.
    const tem = (paleta: { cor: string }[], cor: string) =>
      paleta.some((o) => o.cor.toLowerCase() === cor.toLowerCase())
    expect(tem(CABELOS, CONFIG_PADRAO.cabelo)).toBe(true)
    expect(tem(PELES, CONFIG_PADRAO.pele)).toBe(true)
    expect(tem(OLHOS_CORES, CONFIG_PADRAO.olhos)).toBe(true)
    expect(tem(FUNDOS, CONFIG_PADRAO.fundo)).toBe(true)
    expect(ESTILOS.some((e) => e.id === CONFIG_PADRAO.estilo)).toBe(true)
  })
})
