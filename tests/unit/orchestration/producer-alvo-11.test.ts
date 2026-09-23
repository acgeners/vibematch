import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { CRITERION_SLUGS } from "@/types/domain"
import {
  SCORING_CRITERION_SLUGS,
  NON_SCORING_CRITERION_SLUGS,
} from "@/lib/calculations/scoring-features"
import { VISIBLE_CRITERION_SLUGS, LEGACY_HIDDEN_SLUGS } from "@/lib/criteria/visible"
import { CRITERIA_INFO, CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { SYSTEM_PROMPT, PROMPT_VERSION } from "@/lib/ai-evaluation/service"

/**
 * O CONTRATO DO PRODUCER ALVO DOS 11 (`v29+alvo11-c1`), migration 198.
 *
 * 🔴 Por que um arquivo só para isto: as peças moram em lugares diferentes de propósito —
 * `CRITERION_SLUGS` (gerado do banco), `SCORING_CRITERION_SLUGS` (congelado no código),
 * `VISIBLE_CRITERION_SLUGS` (derivado) e o `SYSTEM_PROMPT`. Cada um tem teste próprio de
 * FORMA; o que não existia é a conferência de que os quatro descrevem o MESMO producer.
 *
 * ⚠️ Nada aqui lê `Auditoria/`: aquela pasta está em `.git/info/exclude` e não existe num
 * clone. Os casos casam o FATO (a rubrica traz os dois testes ordenados, a âncora de stress,
 * os NÃO FAÇA) — nunca um arquivo que só existe na máquina de quem escreveu.
 */

const OS_ONZE = [
  "romance", "couple_dynamics", "fantasy", "setting_era", "action_adventure",
  "adult_content", "protagonist", "humor", "drama", "tragedy", "angst",
] as const

const OS_NOVE_DO_CALCULO = [
  "romance", "couple_dynamics", "fantasy", "action_adventure",
  "adult_content", "protagonist", "humor", "drama", "tragedy",
] as const

const LEGADOS = ["fantasy_nobility", "nobility"] as const
const RAIZ = execSync("git rev-parse --show-toplevel").toString().trim()
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")

describe("o producer avalia EXATAMENTE os 11 finais", () => {
  it("CRITERION_SLUGS são os 11, na ordem do c1", () => {
    expect([...CRITERION_SLUGS]).toEqual([...OS_ONZE])
  })

  it.each(LEGADOS)("%s NÃO é critério de IA — saiu na migration 198", (slug) => {
    expect(CRITERION_SLUGS as readonly string[]).not.toContain(slug)
    expect(CRITERIA_INFO[slug], `${slug} ainda tem verbete gerado`).toBeUndefined()
    expect(CRITERIA_RUBRICS[slug], `${slug} ainda tem rubrica gerada`).toBeUndefined()
  })

  it("a tool é fixada em CRITERION_SLUGS — nem mais, nem menos", () => {
    const s = src("lib/ai-evaluation/service.ts")
    // 🔴 minItems/maxItems atrelados ao COMPRIMENTO da lista, nunca a um literal: um número
    // escrito ali aceitaria 11 respostas depois de a lista virar 12, sem erro.
    expect(s).toContain("minItems: CRITERION_SLUGS.length")
    expect(s).toContain("maxItems: CRITERION_SLUGS.length")
    expect(s).toContain("const CRITERION_SLUG_ENUM = [...CRITERION_SLUGS]")
    expect(s).toContain("enum: CRITERION_SLUG_ENUM")
  })

  it("o leitor vê os 11 — nenhum legado sobra para filtrar", () => {
    expect([...VISIBLE_CRITERION_SLUGS]).toEqual([...OS_ONZE])
    for (const slug of LEGACY_HIDDEN_SLUGS) {
      expect(VISIBLE_CRITERION_SLUGS as readonly string[]).not.toContain(slug)
    }
  })
})

describe("o CÁLCULO fica nos 9, com fantasy no slot do legado", () => {
  it("SCORING_CRITERION_SLUGS são os 9 finais", () => {
    expect([...SCORING_CRITERION_SLUGS]).toEqual([...OS_NOVE_DO_CALCULO])
  })

  it("setting_era e angst são avaliados e NÃO entram no cálculo", () => {
    expect([...NON_SCORING_CRITERION_SLUGS].sort()).toEqual(["angst", "setting_era"])
  })

  it.each(LEGADOS)("%s não entra no vetor de cálculo", (slug) => {
    expect(SCORING_CRITERION_SLUGS as readonly string[]).not.toContain(slug)
  })

  /**
   * 🔴 A guarda de completude (`calculations.ts`) exige TODO slug do vetor preenchido. Se ela
   * derivasse de `CRITERION_SLUGS`, obra sem `setting_era`/`angst` perderia a Nota Prevista —
   * e é justamente o estado de toda obra até uma reavaliação. Tem de ser o vetor de 9.
   */
  it("a guarda de expected_score pede o vetor de 9, não a lista do banco", () => {
    const s = src("server/actions/calculations.ts")
    expect(s).toContain("SCORING_CRITERION_SLUGS.every((slug) => w.categoryScores[slug] != null)")
    // ⚠️ `not.toContain` aqui é inútil: a string do vetor de 9 CONTÉM a da lista do banco.
    // A fronteira `(?<!SCORING_)` é o que separa as duas — sem ela o caso passa sempre.
    expect(
      s,
      "a guarda voltou a derivar de CRITERION_SLUGS — obra sem setting_era/angst perderia a Nota Prevista",
    ).not.toMatch(/(?<!SCORING_)CRITERION_SLUGS\.every\(\(slug\) => w\.categoryScores/)
  })

  it.each([
    "lib/calculations/expected.ts",
    "lib/calculations/chance.ts",
    "lib/ml/embedding-input.ts",
    "lib/ml/weight-inference.ts",
  ])("%s monta o vetor pelo SCORING_CRITERION_SLUGS", (arquivo) => {
    expect(src(arquivo)).toContain("SCORING_CRITERION_SLUGS")
  })
})

describe("nenhum caminho de avaliação NOVA escreve os legados", () => {
  /**
   * 🔴 Derivado do disco, nunca de uma lista de nomes: quem GRAVA nota é quem chama
   * insert/upsert em `category_scores` ou `ai_evaluation_scores`. Se amanhã nascer um terceiro
   * escritor, ele entra nesta varredura sozinho — é o que uma allowlist não faria.
   */
  const escritores = execSync(
    `git grep -l -E 'from\\("(category_scores|ai_evaluation_scores)"\\)' -- 'server/**/*.ts' 'lib/**/*.ts' 'app/**/*.ts'`,
    { cwd: RAIZ },
  ).toString().trim().split("\n").filter((f) => {
    const c = src(f)
    return /\.(insert|upsert)\(/.test(c) && /from\("(category_scores|ai_evaluation_scores)"\)/.test(c)
  })

  it("há escritor para achar — senão a varredura não prova nada", () => {
    expect(escritores.length).toBeGreaterThan(0)
  })

  it.each(escritores)("%s não nomeia slug legado", (arquivo) => {
    const c = src(arquivo)
    for (const slug of LEGADOS) {
      expect(c, `${arquivo} nomeia ${slug}`).not.toMatch(new RegExp(`["'\`]${slug}["'\`]`))
    }
  })
})

describe("as rubricas são as do c1 — não a paráfrase reduzida da 197", () => {
  it("action_adventure é DINAMISMO NARRATIVO, mantendo o slug", () => {
    expect(CRITERION_SLUGS as readonly string[]).toContain("action_adventure")
    expect(CRITERIA_RUBRICS.action_adventure.title).toBe("Dinamismo Narrativo")
    expect(CRITERIA_INFO.action_adventure.name).toBe("Dinamismo Narrativo")
    // o construto: bipolar e descritivo, não "quanto combate"
    expect(CRITERIA_INFO.action_adventure.description).toContain("Bipolar")
    expect(CRITERIA_INFO.action_adventure.description).toContain("DESCRITIVO")
    // e a REGRA LONGITUDINAL (§5-bis) tem de viajar junto: é ela que proíbe o pico automático
    const g = (CRITERIA_RUBRICS.action_adventure.guidance ?? []).join("\n")
    expect(g).toContain("REGRA LONGITUDINAL")
    expect(g).toContain("PROIBIDO")
    expect(g).toContain("O QUE MOVE A HISTÓRIA")
  })

  /**
   * 🔴 O caso que distingue as DUAS versões de fantasy. A migration 197 gravou uma paráfrase:
   * tem os cortes, e perdeu os dois testes ordenados, as 7 âncoras e os 5 NÃO FAÇA. O c1 tem
   * os três. Casar o FATO (o conteúdo que só existe numa delas), nunca o arquivo do artefato.
   */
  it("fantasy traz os dois testes ordenados, as âncoras e os NÃO FAÇA do c1", () => {
    const g = (CRITERIA_RUBRICS.fantasy.guidance ?? []).join("\n")
    expect(g).toContain("dois testes, NESTA ORDEM")
    expect(g).toContain("Teste ontológico")
    expect(g).toContain("ÂNCORAS")
    expect(g).toContain("Cyberpunk Edgerunners") // o caso de stress
    expect(g).toContain("NÃO FAÇA")
    // a marca da paráfrase de 197: as faixas vinham rotuladas "Ausente:/Pontual:/…"
    const faixas = CRITERIA_RUBRICS.fantasy.ranges.join("\n")
    expect(faixas, "a rubrica reduzida da 197 voltou").not.toContain("Ausente: nenhum elemento")
  })

  it.each(["setting_era", "angst"])("%s existe, com nome e rubrica de 4 faixas", (slug) => {
    expect(CRITERIA_INFO[slug]?.name.length ?? 0).toBeGreaterThan(0)
    expect(CRITERIA_RUBRICS[slug]?.ranges).toHaveLength(4)
    expect((CRITERIA_RUBRICS[slug]?.guidance ?? []).length).toBeGreaterThan(0)
  })

  it("os nomes desta leva são os decididos — sem o rename conceitual", () => {
    expect(CRITERIA_RUBRICS.couple_dynamics.title).toBe("Dinâmica entre Protagonistas")
    expect(CRITERIA_RUBRICS.protagonist.title).toBe("Protagonista Marcante")
    expect(CRITERIA_RUBRICS.setting_era.title).toBe("Ambientação Temporal")
    expect(CRITERIA_RUBRICS.angst.title).toBe("Angústia")
  })
})

describe("o SYSTEM_PROMPT descreve o producer alvo", () => {
  it("enumera os 11 na ordem, e só eles", () => {
    const heads = [...SYSTEM_PROMPT.matchAll(/^(\d+)\. ([a-z_]+) \(/gm)].map((m) => m[2])
    expect(heads).toEqual([...OS_ONZE])
  })

  it.each(LEGADOS)("não menciona %s em lugar nenhum", (slug) => {
    expect(SYSTEM_PROMPT).not.toContain(slug)
  })

  it("traz o bloco de COMPATIBILIZAÇÃO e a REGRA PARA HUMOR (v29)", () => {
    expect(SYSTEM_PROMPT).toContain("COMPATIBILIZAÇÃO DAS REGRAS GERAIS COM AS RUBRICAS ACIMA")
    expect(SYSTEM_PROMPT).toContain("REGRA PARA HUMOR — RUBRICA SUBSTITUÍDA")
    // a isenção da meta-regra de presença, sem a qual setting_era/action_adventure/angst
    // teriam piso 5 e o polo baixo das três viraria inalcançável
    expect(SYSTEM_PROMPT).toContain("NÃO se aplica a setting_era, action_adventure e angst")
  })

  it("o guia TAGS POR GRUPO acompanhou a troca", () => {
    expect(SYSTEM_PROMPT).toContain('- fantasy: grupo "fantasy" (alto)')
    expect(SYSTEM_PROMPT).toContain('- setting_era: grupo "setting" (alto)')
    expect(SYSTEM_PROMPT).toContain("O QUE MOVE A HISTÓRIA, não presença de combate")
  })

  it("a versão é v30 — v29 já nomeia outro prompt na história do projeto", () => {
    expect(PROMPT_VERSION).toBe("v30")
  })
})

describe("a migration 198 preserva o histórico POR DESENHO", () => {
  const sql = src("supabase/migrations/198_producer_alvo_11_atributos.sql")

  it("não apaga nada", () => {
    const destrutivo = sql
      .split("\n")
      .filter((l) => /^\s*(delete|drop\s+table|truncate)\b/i.test(l))
    expect(destrutivo, `comandos destrutivos: ${destrutivo.join(" | ")}`).toHaveLength(0)
  })

  it("é transacional", () => {
    expect(sql.match(/^begin;$/gm) ?? []).toHaveLength(1)
    expect(sql.match(/^commit;$/gm) ?? []).toHaveLength(1)
  })

  it("aposenta os legados por eval_type, sem tocar na linha", () => {
    expect(sql).toContain("update criteria set eval_type = 'Legado' where slug in ('fantasy_nobility', 'nobility')")
  })

  /**
   * 🔴 `fantasy` começa a calibração humana do zero (decisão de produto). Copiar o viés de um
   * construto MISTO para um construto NOVO afirmaria uma medição que não houve.
   */
  it.each(["attribute_bias", "user_attribute_assessment", "ai_evaluation_scores"])(
    "não escreve em %s", (tabela) => {
      expect(sql, `a 198 mexe em ${tabela}`).not.toMatch(
        new RegExp(`(insert\\s+into|update)\\s+${tabela}\\b`, "i"),
      )
    },
  )

  it("não reescreve category_scores histórico", () => {
    expect(sql).not.toMatch(/update\s+category_scores\b/i)
    expect(sql).not.toMatch(/insert\s+into\s+category_scores\b/i)
  })

  /** O peso viaja do ESTADO do banco, nunca de um número escrito na migration. */
  it("transfere o peso lendo score_weights, sem hardcode", () => {
    expect(sql).toContain("from score_weights velho")
    expect(sql).toContain("velho.slug = 'fantasy_nobility'")
    expect(sql).not.toMatch(/weight\s*=\s*56[.,]8/)
  })
})
