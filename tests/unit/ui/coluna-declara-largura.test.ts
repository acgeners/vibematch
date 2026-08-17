import { describe, it, expect } from "vitest"
import { WORK_TABLE_COLUMNS, DEFAULT_COLUMN_WIDTHS } from "@/components/titles/work-table-config"
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
 * ⚠️ Os 9 `crit_*` herdam o fallback de 100 e isso NÃO foi conferido: são colunas de um
 * dígito, onde 100 é plausível. Ficam listadas para que a próxima coluna adicionada sem
 * largura REPROVE em vez de entrar de carona. (`art` saiu daqui em 17/08 — ganhou 70px, a
 * largura das outras colunas numéricas, porque no modo Agrupar os 30px de fallback saíam da
 * conta do separador.)
 */
const SEM_LARGURA_DECLARADA = new Set<string>([
  ...CRITERION_SLUGS.map((slug) => `crit_${slug}`),
])

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

  it("a coluna do separador é a mais larga depois do título — é a que tem mais conteúdo", () => {
    // Barra (92px) + ícone + valor + frase + σ. Medido no browser: célula típica 292px, e o
    // container query só devolve a frase acima de 270px de conteúdo.
    const largura = DEFAULT_COLUMN_WIDTHS.separator
    expect(largura).toBeGreaterThanOrEqual(280)
    expect(largura).toBeLessThan(DEFAULT_COLUMN_WIDTHS.title)
  })
})
