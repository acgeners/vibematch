import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import {
  conferirContratoDoCalculo,
  mensagemDeContratoQuebrado,
} from "@/lib/calculations/scoring-contract"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"

/**
 * A MATRIZ DE IMPLANTAÇÃO — o recalc nunca pode rodar metade em cada contrato.
 *
 * A Nota.IA sai dos pesos do BANCO (`gpt.ts` itera `score_weights` com `is_active`); o Ridge,
 * a Bússola, os embeddings e a guarda de `expected_score` saem do CÓDIGO
 * (`SCORING_CRITERION_SLUGS`). Deploy e migration são eventos separados ⇒ existe janela em
 * que discordam, e foi medida contra a nuvem em 2026-09-22.
 */
const RAIZ = execSync("git rev-parse --show-toplevel").toString().trim()
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")

const w = (slugs: string[], ativos = true) => slugs.map((slug) => ({ slug, is_active: ativos }))

/** `score_weights` como está na nuvem HOJE (pré-198): os 9 antigos ativos, os 2 novos não. */
const BANCO_ATUAL = [
  ...w(["romance", "couple_dynamics", "fantasy_nobility", "action_adventure",
       "adult_content", "protagonist", "humor", "drama", "tragedy"]),
  ...w(["fantasy", "nobility"], false),
]

/** Depois da 198: o peso viaja de `fantasy_nobility` para `fantasy`. */
const BANCO_POS_198 = [
  ...w(["romance", "couple_dynamics", "fantasy", "action_adventure",
       "adult_content", "protagonist", "humor", "drama", "tragedy"]),
  ...w(["fantasy_nobility", "nobility", "setting_era", "angst"], false),
]

describe("a matriz A/B/C/D", () => {
  /**
   * 🔴 O estado B é o que o rollout CRIA: deploy antes da migration. A Nota.IA continuaria
   * saindo de `fantasy_nobility` (ainda ativo no banco) enquanto o Ridge já lê `fantasy`.
   */
  it("B · código novo + banco ATUAL é HÍBRIDO e a guarda reprova", () => {
    const c = conferirContratoDoCalculo(BANCO_ATUAL)
    expect(c.ok).toBe(false)
    expect(c.sobrandoNosPesos).toEqual(["fantasy_nobility"])
    expect(c.faltandoNosPesos).toEqual(["fantasy"])
  })

  it("D · código novo + banco PÓS-198 é coerente", () => {
    expect(conferirContratoDoCalculo(BANCO_POS_198).ok).toBe(true)
  })

  /**
   * C (código ANTIGO + banco pós-198) é o espelho de B e NÃO tem guarda: o bundle antigo já
   * está no ar e não conhece este módulo. Por isso a proteção de C é a ORDEM — migration
   * depois do deploy —, e este caso registra que a assimetria é conhecida, não esquecida.
   */
  it("C não é protegido por código, e sim pela ORDEM — registrado aqui", () => {
    const scoringAntigo = ["romance", "couple_dynamics", "fantasy_nobility", "action_adventure",
      "adult_content", "protagonist", "humor", "drama", "tragedy"]
    const ativosPos = BANCO_POS_198.filter((x) => x.is_active).map((x) => x.slug)
    const soNoBanco = ativosPos.filter((s) => !scoringAntigo.includes(s))
    const soNoCodigo = scoringAntigo.filter((s) => !ativosPos.includes(s))
    expect(soNoBanco).toEqual(["fantasy"])
    expect(soNoCodigo).toEqual(["fantasy_nobility"])
  })
})

describe("a guarda só reprova o que é de fato incoerente", () => {
  it("linha DESLIGADA sobrando não reprova — `gpt.ts` não a enxerga", () => {
    const c = conferirContratoDoCalculo([
      ...w([...SCORING_CRITERION_SLUGS]),
      ...w(["setting_era", "angst", "fantasy_nobility", "nobility"], false),
    ])
    expect(c.ok).toBe(true)
  })

  it("critério ATIVO a mais reprova — a Nota.IA contaria o que o Ridge não vê", () => {
    const c = conferirContratoDoCalculo([...w([...SCORING_CRITERION_SLUGS]), ...w(["setting_era"])])
    expect(c.ok).toBe(false)
    expect(c.sobrandoNosPesos).toEqual(["setting_era"])
  })

  it("critério do cálculo sem peso ativo reprova", () => {
    const c = conferirContratoDoCalculo(w([...SCORING_CRITERION_SLUGS].slice(1)))
    expect(c.ok).toBe(false)
    expect(c.faltandoNosPesos).toEqual([SCORING_CRITERION_SLUGS[0]])
  })

  /**
   * 🔴 Uma sonda me desmentiu aqui: eu checava `toContain("migration 198")`, e a frase
   * "entre o deploy e a migration 198" sobrevive mesmo depois de a INSTRUÇÃO sumir. Mensagem
   * que nomeia o estado sem dizer o que fazer é onde o operador trava — o caso tem de exigir
   * o verbo, não a menção.
   */
  it("a mensagem nomeia os dois lados, o que NÃO houve e o que FAZER", () => {
    const m = mensagemDeContratoQuebrado(conferirContratoDoCalculo(BANCO_ATUAL))
    expect(m, "não nomeia o slug que sobra").toContain("fantasy_nobility")
    expect(m, "não nomeia o slug que falta").toContain("fantasy")
    expect(m, "não diz que nada foi gravado").toContain("Nada foi gravado")
    expect(m, "não diz que recalc_pending segue de pé").toMatch(/recalc_pending/)
    expect(m, "não dá a INSTRUÇÃO de saída").toMatch(/aplique a migration/i)
  })
})

describe("a guarda está no ponto único, antes de qualquer conta", () => {
  const c = src("server/actions/calculations.ts")

  /** `computeRecalc` é por onde passam OS DOIS caminhos: o do dono e o per-usuário. */
  it("vive em computeRecalc, não só em recalculateAll", () => {
    const corpo = c.slice(c.indexOf("export function computeRecalc"))
    expect(corpo.slice(0, 900)).toContain("conferirContratoDoCalculo(input.weights)")
    expect(corpo.slice(0, 900)).toContain("throw new Error(mensagemDeContratoQuebrado")
  })

  /** Se a guarda vier depois de escrever, ela não impede nada — só avisa tarde. */
  it("roda ANTES da desestruturação que inicia o cálculo", () => {
    const i = c.indexOf("conferirContratoDoCalculo(input.weights)")
    const j = c.indexOf("const { works, weights, config", c.indexOf("export function computeRecalc"))
    expect(i).toBeGreaterThan(0)
    expect(i, "a guarda ficou DEPOIS do início do cálculo").toBeLessThan(j)
  })

  it("os dois caminhos de recalc passam por computeRecalc", () => {
    expect(src("server/recalc/user-recalc.ts")).toContain("computeRecalc({")
    expect(c).toContain("} = computeRecalc({")
  })

  /** Escape hatch vira o caminho normal no primeiro rollout apertado. */
  it("não existe flag para ignorar o contrato", () => {
    const g = src("lib/calculations/scoring-contract.ts")
    expect(g).not.toMatch(/skip|ignore|force|bypass|allowMismatch/i)
  })
})
