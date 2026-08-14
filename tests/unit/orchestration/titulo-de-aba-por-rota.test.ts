import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante: toda rota declara o PRÓPRIO nome, e o sufixo "· SatorIA" tem UM dono.
 *
 * 🔴 O que isto pega, medido em 2026-08-14: das 30 rotas do app, **18 não declaravam
 * título nenhum** — `/ranking`, `/favorites`, `/leitura`, `/titles`, `/conta/perfil`,
 * `/settings`, `/curadoria/pedidos` e mais 11. Todas herdavam o `title` do layout raiz e
 * a aba do browser dizia **"SatorIA"** nas 18. Com três abas abertas (o caso normal aqui),
 * as três eram indistinguíveis: dava pra voltar pra uma aba só clicando e vendo.
 *
 * Não quebrava nada, não aparecia em teste nenhum, e o único sintoma era o custo de achar
 * a aba certa — que é exatamente a forma de defeito que sobrevive por meses.
 *
 * 🔴 O sufixo é a segunda metade. Antes disto ele era escrito à mão em cada página, em
 * DUAS grafias: `— SatorIA` nas institucionais (9 rotas) e `· SatorIA` na página da obra.
 * Duas grafias pro mesmo fato, e nada que as fizesse concordar — a família de erro que o
 * CLAUDE.md chama de "dois critérios pro mesmo fato". Hoje o dono é o `template` do layout
 * raiz, e página que reescreva o sufixo produz "Ranking · SatorIA · SatorIA".
 *
 * ⚠️ A varredura DERIVA as rotas do filesystem, nunca de uma lista. Lista fixa não acha a
 * página que alguém adicionar amanhã — que é justamente o caso que este teste existe pra
 * pegar.
 */

/** Todo `page.tsx` sob `app/`, recursivo. */
function allPageFiles(dir = "app"): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...allPageFiles(full))
    else if (entry === "page.tsx") out.push(full)
  }
  return out.sort()
}

const PAGES = allPageFiles()
/** A home, que mora no mesmo segmento do layout raiz — ver o último caso deste arquivo. */
const HOME = join("app", "page.tsx")

describe("título de aba por rota", () => {
  it("encontra as rotas do app (a varredura não pode nascer vazia)", () => {
    // Guarda contra o modo de falha silencioso do próprio teste: se `allPageFiles`
    // parar de achar nada, todos os casos abaixo passam verdes por vacuidade.
    expect(PAGES.length).toBeGreaterThan(25)
  })

  it("toda rota declara o próprio nome — nenhuma aba fica só 'SatorIA'", () => {
    const semTitulo = PAGES.filter((f) => {
      const src = readFileSync(f, "utf8")
      return (
        !/export\s+const\s+metadata\b/.test(src) &&
        !/export\s+async\s+function\s+generateMetadata\b/.test(src)
      )
    })
    expect(semTitulo).toEqual([])
  })

  it("o sufixo tem um dono só: o layout raiz", () => {
    const raiz = readFileSync("app/layout.tsx", "utf8")
    expect(raiz).toMatch(/template:\s*"%s · SatorIA"/)
    expect(raiz).toMatch(/default:\s*"SatorIA"/)
  })

  it("nenhuma rota reescreve o sufixo à mão", () => {
    // `title: "Ranking — SatorIA"` sairia como "Ranking — SatorIA · SatorIA".
    // Só olha linhas de título; comentários explicando a régua citam a marca de propósito.
    const reincidentes = PAGES.filter((f) => f !== HOME).filter((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .some((linha) => /title:/.test(linha) && !linha.trimStart().startsWith("//") && /SatorIA/.test(linha))
    )
    expect(reincidentes).toEqual([])
  })

  /**
   * 🔴 A home é a ÚNICA exceção, e ela é EXIGIDA em vez de ignorada.
   *
   * O Next não aplica o `template` à página do MESMO segmento que o declara — só às filhas.
   * Medido no app rodando em 2026-08-14: com `title: "Início"`, a home saía
   * `<title>Início</title>` (sem a marca) enquanto `/ranking` saía "Ranking · SatorIA".
   *
   * Exemir o arquivo da checagem acima abriria um buraco silencioso; este caso o fecha,
   * cobrando a forma certa (`absolute`) e o mesmo separador do template.
   */
  it("a home usa `absolute` com o sufixo, porque o template não a alcança", () => {
    const src = readFileSync(HOME, "utf8")
    expect(src).toMatch(/title:\s*\{\s*absolute:\s*"[^"]+ · SatorIA"\s*\}/)
  })
})
