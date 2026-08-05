import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Invariante arquitetural: os limiares por critério na URL estão SEMPRE em
 * PONTOS. A unidade σ do /ranking é uma lente de EXIBIÇÃO (`?crit_unit=sd`) e
 * nunca um formato de armazenamento.
 *
 * 🔴 Por que é invariante e não estilo: a mesma query string do /ranking é lida
 * por consumidores independentes, e nenhum deles sabe o que é σ — `getRanking`,
 * os presets salvos (`ranking_filter_presets` guarda a query CRUA), o
 * `/favorites` e o `parseFiltersFromSearchParams` do diálogo de recomendação. A
 * primeira versão desta feature guardava σ na URL, e `min_romance=-0.5` chegava
 * no diálogo de recomendação como "romance ≥ −0,5 PONTOS": filtro nenhum, sem
 * erro, com resultado plausível. Guardar pontos conserta todos de uma vez, sem
 * que nenhum precise mudar.
 *
 * Corolário de graça: trocar de unidade não reescreve valor nenhum, então NUNCA
 * muda o resultado do filtro — por isso o toggle só mexe em `crit_unit`.
 */
const PAGE = "app/ranking/page.tsx"
const FILTERS = "components/ranking/ranking-filters.tsx"

/** Remove comentários de bloco e de linha — documentação não é execução. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

describe("arquitetura: σ é lente de exibição, a URL guarda pontos", () => {
  it("a página do ranking NÃO converte os limiares da URL por unidade", () => {
    const code = stripComments(readFileSync(PAGE, "utf8"))
    // A página lê min_/max_ direto. Se voltar a chamar sigmaToScore/crit_unit
    // aqui, a URL passou a carregar σ e os outros consumidores quebram calados.
    expect(code).not.toContain("crit_unit")
    expect(code).not.toContain("sigmaToScore")
  })

  it("o seletor de unidade só mexe em crit_unit — nunca em min_/max_", () => {
    const code = stripComments(readFileSync(FILTERS, "utf8"))
    const toggle = code.slice(
      code.indexOf("function CriterionUnitToggle"),
      code.indexOf("function buildCriterionScoreDefs"),
    )
    expect(toggle.length, `${FILTERS}: não achei o CriterionUnitToggle`).toBeGreaterThan(0)
    expect(toggle).toContain('updateParams({ crit_unit: "sd" })')
    expect(toggle).toContain("updateParams({ crit_unit: null })")
    expect(
      toggle,
      "o toggle está reescrevendo limiar — trocar de unidade tem que ser inócuo",
    ).not.toMatch(/min_|max_/)
  })

  it("quem lê a URL fora do /ranking continua interpretando PONTOS, sem saber de σ", () => {
    // Guarda do vazamento real: estes montam RankingFilters a partir da mesma
    // query string e não têm acesso aos momentos do catálogo.
    for (const file of ["lib/ranking-filters-from-params.ts", "app/favorites/[listId]/page.tsx"]) {
      const code = stripComments(readFileSync(file, "utf8"))
      expect(code, `${file} passou a depender de σ — a URL tem que bastar sozinha`).not.toContain(
        "crit_unit",
      )
      expect(code).not.toContain("sigmaToScore")
    }
  })

  it("o mood preset resolve σ com os momentos de HOJE (é o que impede de apodrecer)", () => {
    const src = readFileSync(PAGE, "utf8")
    // `needsMoments` é o que põe a leitura no caminho crítico quando há mood
    // ativo. Sem ela, `moments` chega null, resolveMoodThresholds cai no
    // fallback em pontos — a foto CONGELADA de 2026-08-05 — e a
    // auto-recalibração deixa de existir, silenciosamente.
    expect(src).toMatch(/needsMoments[\s\S]{0,160}moodPreset\?\.criterionMinSd/)
    expect(src).toContain("const moments = needsMoments ? await momentsPromise : null")
    expect(src).toContain("resolveMoodThresholds(moodPreset, moments)")
  })
})
