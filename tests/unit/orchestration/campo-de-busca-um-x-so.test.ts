import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Um campo de busca tem UM botão de limpar.
 *
 * `type="search"` faz Blink/WebKit desenharem `::-webkit-search-cancel-button`
 * DENTRO da content box — ou seja, à esquerda do botão de limpar que o app
 * desenha no padding —, e só com o campo FOCADO. Resultado medido em
 * `/preferences`: dois ✕ lado a lado, pesos diferentes, mesma ação, enquanto
 * se digita. É a família "dois donos do mesmo fato" do CLAUDE.md, na tela.
 *
 * O reset em `app/globals.css` mata o nativo em todo lugar. O preço é que o
 * botão do app passa a ser a ÚNICA forma de limpar no clique — então as duas
 * pontas precisam andar juntas, e é isso que este arquivo guarda:
 *
 *   1. o reset existe (sem ele, o ✕ duplicado volta no próximo `type="search"`);
 *   2. todo `type="search"` do source desenha o botão dele.
 *
 * ⚠️ A lista de campos é DERIVADA do filesystem, nunca fixa — campo novo entra
 * na checagem sozinho (ver [[project-testes-arquitetura-armadilhas]]).
 */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx$/.test(entry)) out.push(p)
  }
  return out
}

const GLOBALS = "app/globals.css"

/** Arquivos com um `<input type="search">` (via `Input` ou nativo). */
function searchFields(): string[] {
  return ["app", "components"]
    .flatMap((d) => walk(d))
    .filter((f) => /type=(?:"search"|\{"search"\}|'search')/.test(readFileSync(f, "utf8")))
}

describe("campo de busca: um ✕ só", () => {
  it("globals.css desliga o ✕ nativo do type=search", () => {
    const css = readFileSync(GLOBALS, "utf8")

    // O seletor e a declaração são checados juntos: só o seletor não desliga nada,
    // e um `appearance: none` solto não diz sobre qual widget.
    const reset = /::-webkit-search-cancel-button[\s\S]{0,200}?\{[\s\S]*?appearance:\s*none/
    expect(
      reset.test(css),
      `${GLOBALS} não desliga ::-webkit-search-cancel-button — o ✕ nativo volta a ` +
        `duplicar o botão de limpar do app em Chrome/Safari (invisível no Firefox, ` +
        `então passa despercebido em parte das máquinas)`
    ).toBe(true)
  })

  it("todo type=search desenha o próprio botão de limpar", () => {
    const fields = searchFields()

    // Sanidade do walk: se um dia não houver mais nenhum, o teste acima ainda
    // segura o reset — mas o walk quebrado ficaria verde em silêncio.
    expect(fields.length, "nenhum type=search encontrado — o walk quebrou?").toBeGreaterThan(0)

    for (const file of fields) {
      const source = readFileSync(file, "utf8")
      expect(
        /aria-label="Limpar/.test(source),
        `${file} tem type="search" mas nenhum botão aria-label="Limpar…" — com o ` +
          `reset do globals.css, o campo fica sem como limpar no clique`
      ).toBe(true)
    }
  })
})
