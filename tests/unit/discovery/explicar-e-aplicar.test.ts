import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Invariantes de "Explicar" / "Aplicar ao catálogo" (`/discover`, Fase 2).
 *
 * Teste de ARQUITETURA (lê o source) porque as três coisas guardadas aqui não quebram
 * build nem runtime — elas produzem gravação errada, silenciosa, no Veredito que TODAS as
 * telas mostram.
 */

const ROOT = resolve(__dirname, "../../..")
const ACTIONS = readFileSync(resolve(ROOT, "server/actions/recommendations.ts"), "utf8")
const PANEL = readFileSync(resolve(ROOT, "components/discovery/explain-panel.tsx"), "utf8")
const MIGRATION = readFileSync(
  resolve(ROOT, "supabase/migrations/188_recommendation_runs_mode_seeds.sql"),
  "utf8",
)

/**
 * ⚠️ Comentários FORA, sempre.
 *
 * Um comentário que explica por que algo NÃO está ali contém o nome do que não está —
 * "Sem `ensureAiConsumption`: isto não gasta token" faz um `not.toContain` reprovar a
 * própria explicação. Aconteceu aqui na 1ª versão, e é a mesma armadilha registrada em
 * `abas-da-obra.test.ts`.
 */
function semComentarios(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

/** O corpo de uma função exportada, do `export async function X` até a próxima. */
function corpo(source: string, nome: string): string {
  const i = source.indexOf(`export async function ${nome}`)
  expect(i, `${nome} não existe`).toBeGreaterThan(-1)
  const resto = source.slice(i + 1)
  const j = resto.indexOf("\nexport async function ")
  return semComentarios(j === -1 ? resto : resto.slice(0, j))
}

describe("explicar: a chamada paga vira run, mas não vira Veredito", () => {
  const explain = corpo(ACTIONS, "explainSeedResultsAction")

  it("🔴 NÃO grava alignment em calculated_scores", () => {
    // É a diferença inteira em relação a `rerankClusterAction`, que persiste sempre.
    // Se alguém "simplificar" chamando persistAlignmentScores aqui, a explicação passa a
    // publicar no /ranking um julgamento feito para uma exploração descartável.
    expect(explain).not.toContain("persistAlignmentScores")
  })

  it("cria a run — senão os ~5¢ somem sem deixar rastro", () => {
    expect(explain).toContain("insertRecommendationRun")
    expect(explain, "a run tem que nascer com mode 'seeds'").toMatch(/mode:\s*"seeds"/)
  })

  it("registra as sementes em source_meta (a procedência da justificativa)", () => {
    expect(explain).toContain("seed_ids")
    expect(explain).toContain("anti_ids")
  })

  it("passa por cota e por plano antes de gastar", () => {
    expect(explain).toContain("ensureAiConsumption")
    expect(explain).toContain("MAX_RUNS_PER_DAY")
  })

  it("manda o contexto das sementes ao modelo, não um userContext vazio", () => {
    // Sem isto a prosa sai como recomendação genérica e não menciona o que foi pedido.
    expect(explain).toMatch(/userContext:\s*contextoSementes/)
  })
})

describe("aplicar: grava a partir do BANCO, nunca do cliente", () => {
  const apply = corpo(ACTIONS, "applySeedVerdictAction")

  it("🔴 recebe um runId, não notas", () => {
    // `"use server"` é endpoint HTTP público: aceitar alignment_score do cliente deixaria
    // qualquer um escrever o Veredito que quisesse em qualquer obra.
    expect(ACTIONS).toMatch(/export async function applySeedVerdictAction\(\s*runId: string/)
    expect(apply, "não pode aceitar rankings do cliente").not.toMatch(/rankings\s*:/)
  })

  it("🔴 confere o DONO da run antes de gravar", () => {
    // Sem isto, passar o id da run de outra pessoa grava o Veredito dela no catálogo desta.
    expect(apply).toMatch(/row\.user_id\s*!==\s*identity\.userId/)
  })

  it("recusa run que não seja de sementes", () => {
    expect(apply).toMatch(/row\.mode\s*!==\s*"seeds"/)
  })

  it("lê os resultados da run e só então persiste", () => {
    expect(apply).toContain("row.results")
    expect(apply).toContain("persistAlignmentScores")
  })

  it("NÃO exige cota de IA — não chama modelo nenhum", () => {
    expect(apply).not.toContain("ensureAiConsumption")
  })
})

describe("a migration 188 é pré-requisito do caminho pago", () => {
  it("amplia o CHECK de mode para aceitar 'seeds'", () => {
    expect(MIGRATION).toMatch(/add constraint recommendation_runs_mode_check/i)
    expect(MIGRATION).toContain("'seeds'")
    // Os três valores antigos têm que sobreviver — um DROP+ADD que os esqueça quebra
    // TODA recomendação existente, não só a feature nova.
    for (const modo of ["next_read", "full_analysis", "ranking"]) {
      expect(MIGRATION, `o CHECK novo perdeu '${modo}'`).toContain(`'${modo}'`)
    }
  })
})

describe("o painel é âmbar, e a promessa casa com o que acontece", () => {
  it("usa a trava request-scoped e renderiza o diálogo", () => {
    expect(PANEL).toContain("useScopedGuard({")
    expect(PANEL).toContain("<ScopedTaskStrip")
    expect(PANEL).toContain("{guardDialog}")
  })

  it("🔴 não entra no store azul", () => {
    // O azul promete "pode navegar, te aviso ao terminar" — e aqui sair PERDE o resultado.
    expect(PANEL).not.toContain("runTask")
  })

  it("manda o runId para aplicar, não as notas que estão na tela", () => {
    expect(PANEL).toMatch(/applySeedVerdictAction\(\s*result\.runId\s*\)/)
  })
})
