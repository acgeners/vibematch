import { describe, it, expect } from "vitest"
import {
  WORK_TABLE_COLUMNS,
  DEFAULT_COLUMN_WIDTHS,
  TIER_MODE_COLUMN_WIDTHS,
} from "@/components/titles/work-table-config"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * `naturalWidthOf` cai em `?? 100` para coluna sem largura declarada, e o 100 é INVISÍVEL:
 * a tabela é `table-layout: fixed` com larguras proporcionais e sem scroll horizontal, então
 * a coluna simplesmente nasce estreita, o conteúdo é cortado e nada acusa.
 *
 * Foi o que aconteceu com "O que a separa" (17/08/2026): a coluna mais LARGA da tabela — barra
 * de 92px + ícone + valor + frase — era a única sem entrada aqui, e recebia menos que qualquer
 * outra. Medido: a trilha + o ícone sozinhos pedem 144px, então sobravam −44px para a frase,
 * que é o conteúdo da coluna e nunca foi desenhada. O título também truncava ("O QU…").
 */

/**
 * As exceções são DECLARADAS, com o motivo — e não uma allowlist que absorve o próximo
 * esquecimento em silêncio.
 *
 * 🔴 **Hoje a lista está VAZIA, e os 9 `crit_*` saíram dela em 19/08/2026.** A ressalva que
 * estava escrita aqui — *"herdam o fallback de 100 e isso NÃO foi conferido: são colunas de um
 * dígito, onde 100 é plausível"* — era a hipótese certa de duvidar e a conclusão errada.
 * Conferido na tela: cada um pede **24,4px** e recebia **69,5**. O dano do `?? 100` não é só
 * deixar UMA coluna estreita; quando ele cai em NOVE colunas de uma tabela proporcional sem
 * piso, ele deixa todas as OUTRAS estreitas — 900px de um orçamento de 2.076px (43%).
 *
 * (`art` saiu daqui em 17/08 — ganhou 70px, a largura das outras colunas numéricas, porque no
 * modo Agrupar os 30px de fallback saíam da conta do separador.)
 */
const SEM_LARGURA_DECLARADA = new Set<string>([])

describe("toda coluna da tabela declara a própria largura", () => {
  it("nenhuma coluna nova entra caindo no fallback de 100", () => {
    const semLargura = WORK_TABLE_COLUMNS.map((c) => c.key).filter(
      (key) => DEFAULT_COLUMN_WIDTHS[key] == null && !SEM_LARGURA_DECLARADA.has(key),
    )
    expect(
      semLargura,
      `sem entrada em DEFAULT_COLUMN_WIDTHS: ${semLargura.join(", ")} — declare a largura ou ` +
        "acrescente à lista de exceções COM o motivo",
    ).toEqual([])
  })

  it("a lista de exceções não guarda coluna que já foi resolvida", () => {
    // Exceção que virou largura declarada e ficou na lista faz o teste parar de cobrir a
    // coluna sem que ninguém perceba.
    const orfas = [...SEM_LARGURA_DECLARADA].filter((key) => DEFAULT_COLUMN_WIDTHS[key] != null)
    expect(orfas, `já têm largura e podem sair da lista: ${orfas.join(", ")}`).toEqual([])
  })

  it("nota de critério não pede mais largura que uma coluna numérica de 2 dígitos", () => {
    // O `?? 100` não é pego pelo caso acima se alguém DECLARAR 100. O que o impede de voltar
    // é a conta: a nota de critério é o menor conteúdo da tabela (um dígito, 24,4px medidos —
    // 32,8 no 🔥), então ela não pode pedir mais que `art`, que é um percentil de 2 dígitos.
    // Com os nove a 100, eles sozinhos reivindicavam 43% do orçamento do /ranking.
    const criterio = CRITERION_SLUGS.map((slug) => DEFAULT_COLUMN_WIDTHS[`crit_${slug}`])
    for (const largura of criterio) {
      expect(largura).toBeGreaterThan(0)
      expect(largura).toBeLessThanOrEqual(DEFAULT_COLUMN_WIDTHS.art)
    }
  })

  it("o Veredito cabe no botão Rankear, não só na pílula", () => {
    // Medido em 19/08/2026, logada: a célula pede 99,9px — quem manda é o botão "Rankear" das
    // obras SEM Veredito (a maioria da lista), não a pílula (83). Com 70 ela saía cortada em
    // 40/40 linhas do /ranking e 50/50 do /catalog. `TIER_MODE_COLUMN_WIDTHS` já declarava 100.
    expect(DEFAULT_COLUMN_WIDTHS.alignment_score).toBeGreaterThanOrEqual(100)
    expect(TIER_MODE_COLUMN_WIDTHS.alignment_score).toBeGreaterThanOrEqual(100)
  })

  it("a coluna do separador é a mais larga depois do título — é a que tem mais conteúdo", () => {
    // Barra (92px) + ícone + valor + frase + σ. Medido no browser: célula típica 292px, e o
    // container query só devolve a frase acima de 270px de conteúdo.
    const largura = DEFAULT_COLUMN_WIDTHS.separator
    expect(largura).toBeGreaterThanOrEqual(280)
    expect(largura).toBeLessThan(DEFAULT_COLUMN_WIDTHS.title)
  })
})
