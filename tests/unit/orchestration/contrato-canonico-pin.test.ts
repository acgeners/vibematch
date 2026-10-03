import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PROMPT_VERSION } from "@/lib/ai-evaluation/service"
import { SCORING_CONTRACT } from "@/lib/calculations/scoring-contract"
import { NON_SCORING_CRITERION_SLUGS, SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import { resolveTransitionalFantasy } from "@/lib/calculations/fantasy-scoring-transition"

/**
 * PIN do contrato canônico (migration 202): o código e o banco têm de descrever o MESMO contrato.
 *
 * 🔴 Se `PROMPT_VERSION` ou `SCORING_CONTRACT` mudarem sem uma migration atualizando
 * `canonical_contract`, o deploy passa — e no instante em que `enforce` estiver ligado o banco
 * recusa as avaliações e os recalcs LEGÍTIMOS de produção. O estado canônico esperado é DERIVADO
 * das migrations (aplicadas em ordem), nunca escrito aqui.
 *
 * 🔴 E se a SEMÂNTICA do scoring mudar sem trocar o NOME do contrato, o banco aceitaria como
 * "s9-fantasy-b-v1" um cálculo que não é ele — exatamente a classe do incidente de 02–03/10
 * (o checkout sem Strategy B tinha os mesmos 9 slugs). Por isso o nome é fixado ao que descreve.
 */

const DIR = join(process.cwd(), "supabase/migrations")

/** Tira comentários de linha: o cabeçalho da 202 cita as colunas em prosa. */
const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "")

const arrayLiteral = (s: string) => [...s.matchAll(/'([^']*)'/g)].map((m) => m[1])

interface Estado { evals: string[] | null; scorings: string[] | null }

/** Aplica, em ordem, os INSERT/UPDATE de `canonical_contract` das migrations. */
function estadoCanonicoDasMigrations(): { estado: Estado; ligamEnforce: string[]; fontes: string[] } {
  const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b))
  const estado: Estado = { evals: null, scorings: null }
  const ligamEnforce: string[] = []
  const fontes: string[] = []
  for (const f of arquivos) {
    const sql = semComentarios(readFileSync(join(DIR, f), "utf8"))
    if (!/canonical_contract/.test(sql)) continue
    const ins = sql.match(/insert\s+into\s+(?:public\.)?canonical_contract\s*\(([^)]*)\)\s*values\s*\(([\s\S]*?)\)\s*(?:on\s+conflict|;)/i)
    if (ins) {
      const cols = ins[1].split(",").map((c) => c.trim())
      const vals = ins[2].split(/,(?![^[]*\])/).map((v) => v.trim())
      cols.forEach((c, i) => {
        if (c === "eval_prompt_versions") estado.evals = arrayLiteral(vals[i])
        if (c === "scoring_contracts") estado.scorings = arrayLiteral(vals[i])
        if (c === "enforce" && /^true$/i.test(vals[i])) ligamEnforce.push(f)
      })
      fontes.push(f)
    }
    for (const m of sql.matchAll(/eval_prompt_versions\s*=\s*array\s*\[([^\]]*)\]/gi)) { estado.evals = arrayLiteral(m[1]); fontes.push(f) }
    for (const m of sql.matchAll(/scoring_contracts\s*=\s*array\s*\[([^\]]*)\]/gi)) { estado.scorings = arrayLiteral(m[1]); fontes.push(f) }
    if (/update\s+(?:public\.)?canonical_contract[\s\S]*?set[\s\S]*?enforce\s*=\s*true/i.test(sql)) ligamEnforce.push(f)
  }
  return { estado, ligamEnforce, fontes: [...new Set(fontes)] }
}

describe("contrato canônico: código × migrations", () => {
  const { estado, ligamEnforce, fontes } = estadoCanonicoDasMigrations()

  it("alguma migration declara o contrato (a 202 ou posterior)", () => {
    expect(fontes.length, "nenhuma migration popula canonical_contract").toBeGreaterThan(0)
    expect(estado.evals).not.toBeNull()
    expect(estado.scorings).not.toBeNull()
  })

  it(`PROMPT_VERSION (${PROMPT_VERSION}) está entre as versões permitidas pelas migrations`, () => {
    expect(
      estado.evals,
      `PROMPT_VERSION mudou sem migration atualizando canonical_contract.eval_prompt_versions (fontes: ${fontes.join(", ")}). ` +
        "Na MESMA mudança, crie a migration — com as duas versões na lista durante a janela entre migration e deploy.",
    ).toContain(PROMPT_VERSION)
  })

  it(`SCORING_CONTRACT (${SCORING_CONTRACT}) está entre os contratos permitidos pelas migrations`, () => {
    expect(
      estado.scorings,
      `SCORING_CONTRACT mudou sem migration atualizando canonical_contract.scoring_contracts (fontes: ${fontes.join(", ")}).`,
    ).toContain(SCORING_CONTRACT)
  })

  it("nenhuma migration LIGA o enforce — ligar é passo operacional na nuvem, depois do deploy", () => {
    // Uma migration que ligasse viraria enforcement em todo banco que a recebe, inclusive antes
    // do deploy do código que envia `scoring_contract` — o recalc de produção pararia.
    expect(ligamEnforce).toEqual([])
  })
})

/**
 * O que cada nome de contrato DESCREVE. Mudou a lista de slugs ou a regra do slot `fantasy`?
 * Então o cálculo é outro: crie um nome NOVO aqui, troque `SCORING_CONTRACT` e a migration.
 */
const DESCRITORES: Record<string, { slugs: readonly string[]; foraDoScoring: readonly string[]; fantasia: "legado-primeiro" }> = {
  "s9-fantasy-b-v1": {
    slugs: ["romance", "couple_dynamics", "fantasy", "action_adventure", "adult_content", "protagonist", "humor", "drama", "tragedy"],
    foraDoScoring: ["setting_era", "angst"],
    fantasia: "legado-primeiro",
  },
}

describe(`SCORING_CONTRACT ${SCORING_CONTRACT} descreve o scoring que o código roda`, () => {
  const d = DESCRITORES[SCORING_CONTRACT]
  const bump = "o scoring mudou de semântica — crie um contrato NOVO (descritor + SCORING_CONTRACT + migration)"

  it("o contrato tem descritor", () => {
    expect(d, `sem descritor para ${SCORING_CONTRACT}`).toBeDefined()
  })

  it("os 9 slugs do cálculo, na ordem", () => {
    expect([...SCORING_CRITERION_SLUGS], bump).toEqual(d.slugs)
  })

  it("setting_era e angst ficam FORA do cálculo", () => {
    for (const s of d.foraDoScoring) expect(NON_SCORING_CRITERION_SLUGS as readonly string[], bump).toContain(s)
  })

  it("Strategy B: o slot fantasy lê o legado quando existe e o real só como fallback", () => {
    expect(resolveTransitionalFantasy([{ criterion_slug: "fantasy_nobility", score: 8 }, { criterion_slug: "fantasy", score: 2 }]), bump)
      .toEqual({ value: 8, source: "fantasy_nobility_legacy" })
    expect(resolveTransitionalFantasy([{ criterion_slug: "fantasy", score: 2 }]), bump)
      .toEqual({ value: 2, source: "fantasy_real_fallback" })
  })
})
