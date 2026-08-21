import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"

/**
 * "Nada a fazer" precisa PROVAR que olhou.
 *
 * 🔴 O caso que originou isto: o `--heal` do `adult-content-retroactive-bounds.ts` ficou
 * INERTE e reportava "nada a gravar". O PostgREST devolve embed to-one como objeto, o código
 * fazia `?.[0]`, e o baseline não era encontrado em **373 de 392 obras**. O script saía com
 * sucesso. Quem o pegou foi um contador dar 0 onde eu esperava 89 — não um teste, não um log.
 *
 * Conferido em 21/08 com sonda contra a nuvem: com o `?.[0]` de volta, o funil imprime
 * `392 → 0 com baseline da avaliação encontrado` e marca 🔴. Sem ele, a mesma execução dizia
 * só "nada a gravar".
 */

const RAIZ = join(import.meta.dirname, "../../..")

/** Do GIT, não do disco: lixo local gitignored não é o que o repositório contém. */
const scripts = execSync("git ls-files scripts", { cwd: RAIZ, encoding: "utf8" })
  .split("\n")
  .filter((p) => /^scripts\/[^/]+\.(ts|mjs|js)$/.test(p))
  .map((p) => ({ nome: p.replace("scripts/", ""), src: readFileSync(join(RAIZ, p), "utf8") }))

/** Script de CORREÇÃO: tem modo de execução e toca o banco. */
const correcao = scripts.filter(
  ({ src }) =>
    /--execute\b|--heal\b|--executar\b/.test(src) &&
    /createAdminClient|createClient\(|SUPABASE_SERVICE_ROLE_KEY|rest</.test(src),
)

/**
 * A frase de plano vazio. Deliberadamente estreita: só o que ANUNCIA que não há trabalho.
 * "nada gravado" (do dry-run) fica de fora — ali houve plano, ele só não foi aplicado.
 */
const FRASE_VAZIO = /console\.log\(\s*[`"'][^`"']*\b(nada a (fazer|gravar|corrigir|reverter|reescrever|subir|semear)|Nada a fazer)/i

/** A válvula de escape, declarada em código com motivo — nunca uma allowlist no teste. */
const DISPENSA = /funil-dispensado:\s*(.+)/
const temDispensa = (src: string) => {
  const m = src.match(DISPENSA)
  if (!m) return false
  // Carimbo não vale: o motivo precisa ser uma frase que explique por que ali não há funil.
  if (m[1].trim().split(/\s+/).length < 5) return false
  return true
}

describe("o funil dos scripts de correção", () => {
  it("🔴 exceção declarada carrega MOTIVO de verdade (hoje 1)", () => {
    const dispensados = correcao.filter(({ src }) => DISPENSA.test(src))
    for (const { nome, src } of dispensados) {
      expect(
        temDispensa(src),
        `"${nome}" traz "funil-dispensado:" sem motivo escrito. Carimbo não vale — escreva ` +
          `por que ali "nada a fazer" já vem com a evidência ao lado.`,
      ).toBe(true)
    }
    // A contagem vai no TÍTULO do caso, que aparece em toda execução da suíte: é assim que a
    // lista de exceções não cresce calada.
    expect(dispensados.length).toBe(1)
  })

  it("existem scripts de correção (senão a varredura não prova nada)", () => {
    expect(correcao.length).toBeGreaterThan(5)
  })

  it("🔴 'nada a fazer' nunca é impresso SOZINHO — sai pelo funil", () => {
    for (const { nome, src } of correcao) {
      // ⚠️ Sem comentários: eles CITAM a frase para explicar o defeito, e a 1ª versão de um
      // teste irmão reprovou acusando a própria explicação da mudança.
      const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      // ⚠️ A válvula é DECLARADA no arquivo, encostada na linha — nunca uma lista de nomes
      // aqui. Ela existe porque há um caso legítimo: frase por ITEM de uma lista fixa de
      // correções nomeadas, onde não há varredura e o rótulo do item é a evidência.
      if (temDispensa(src)) continue
      const solto = codigo.match(FRASE_VAZIO)
      expect(
        solto?.[0],
        `"${nome}" imprime "${solto?.[0]?.slice(20, 70) ?? ""}…" num console.log solto. ` +
          `Sozinha, essa frase não distingue "está tudo certo" de "a leitura veio vazia" — ` +
          `foi assim que o --heal ficou inerte por dias. Use \`funil.nadaAFazer("…")\`, que ` +
          `imprime a cadeia de estágios junto (ver scripts/lib/funil.mjs).`,
      ).toBeUndefined()
    }
  })

  it("🔴 quem usa o funil o RELATA — registrar passos sem imprimir não serve de nada", () => {
    for (const { nome, src } of correcao) {
      if (!src.includes("criarFunil")) continue
      expect(
        /funil\.(relatar|nadaAFazer)\(/.test(src),
        `"${nome}" monta o funil e nunca o imprime: capacidade construída e DESLIGADA, que é ` +
          `pior que ausente — quem lê o código acha que está coberto.`,
      ).toBe(true)
    }
  })

  it("🔴 funil com um passo só não é funil", () => {
    for (const { nome, src } of correcao) {
      if (!src.includes("criarFunil")) continue
      const passos = (src.match(/funil\.passo\(/g) ?? []).length
      expect(
        passos,
        `"${nome}" registra ${passos} passo(s). Com um só, a cadeia não mostra ONDE os ` +
          `candidatos se perderam — que é a única coisa que o funil existe para mostrar.`,
      ).toBeGreaterThanOrEqual(2)
    }
  })
})

describe("o funil em si", () => {
  it("imprime a cadeia inteira, na ordem", async () => {
    const { criarFunil } = await import("../../../scripts/lib/funil.mjs")
    const f = criarFunil("x")
    f.passo("lidas", 100)
    f.passo("com limite", 40)
    f.passo("a mover", 3)
    expect(f.passos().map((p: { n: number }) => p.n)).toEqual([100, 40, 3])
  })

  it("🔴 aponta o dreno INTERMEDIÁRIO, não a queda final", async () => {
    const { criarFunil } = await import("../../../scripts/lib/funil.mjs")

    // O caso do --heal: a queda suspeita é a do meio.
    const heal = criarFunil()
    heal.passo("com limite", 392)
    heal.passo("com baseline", 19)
    heal.passo("a mover", 0)
    expect(heal.maiorDreno()?.nome).toBe("com baseline")

    // 🔴 E os casos legítimos NÃO podem ser marcados. Os dois vieram de execuções reais contra
    // a nuvem em 21/08, e cada um derrubou uma versão da régua:
    //  · `normalizar-titulos` (1020 → 0): o passivo foi fechado em 18/08.
    //  · `seed-art-signal` (1010 → 0 → 0): idem, com um passo redundante DEPOIS — que é o que
    //    furava a régua "ignore o último passo".
    const limpo = criarFunil()
    limpo.passo("obras lidas", 1020)
    limpo.passo("fora da régua", 0)
    expect(limpo.maiorDreno(), "queda para o resultado final não é dreno suspeito").toBeNull()

    const platô = criarFunil()
    platô.passo("ativas", 1010)
    platô.passo("pendentes", 0)
    platô.passo("a gravar", 0)
    expect(platô.maiorDreno(), "o platô final é resultado, não dreno").toBeNull()

    // ⚠️ A contraprova: se o valor depois da queda NÃO é o final, ela volta a ser dreno.
    const meio = criarFunil()
    meio.passo("ativas", 1010)
    meio.passo("pendentes", 5)
    meio.passo("a gravar", 0)
    expect(meio.maiorDreno()?.nome).toBe("pendentes")
  })

  it("🔴 `reterAoMenos` é a expectativa DECLARADA e reprova quando fura", async () => {
    const { criarFunil } = await import("../../../scripts/lib/funil.mjs")
    const f = criarFunil()
    f.passo("com limite", 392)
    f.passo("com baseline", 19, { reterAoMenos: 0.5 }) // 4,8% — o número real do --heal inerte
    f.passo("a mover", 0)
    expect(f.relatar(), "o passo furou a expectativa e relatar() devolveu ok").toBe(false)

    const bom = criarFunil()
    bom.passo("com limite", 392)
    bom.passo("com baseline", 373, { reterAoMenos: 0.5 }) // o número de HOJE, medido
    expect(bom.relatar()).toBe(true)
  })

  it("🔴 `nadaAFazer` imprime a cadeia JUNTO da frase", async () => {
    const { criarFunil } = await import("../../../scripts/lib/funil.mjs")
    const linhas: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => void linhas.push(a.join(" "))
    try {
      const f = criarFunil("t")
      f.passo("lidas", 500)
      f.passo("a corrigir", 0)
      f.nadaAFazer("nada a corrigir.")
    } finally {
      console.log = orig
    }
    // A invariante inteira do módulo: a conclusão nunca sai sem a evidência.
    expect(linhas.join("\n")).toMatch(/500 lidas → 0 a corrigir/)
    expect(linhas.join("\n")).toMatch(/nada a corrigir\./)
  })
})
