import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  AUDITABLE_CRITERIA,
  AUDIT_OUT_OF_SCOPE,
  AUTO_APPLY_MAX_DELTA,
  AUTO_APPLY_MIN_CONFIDENCE,
  isAuditableCriterion,
  shouldAutoApply,
} from "@/lib/ai-calibration/policy"
import { AUDIT_SYSTEM_PROMPT } from "@/lib/ai-calibration/prompts"
import { CRITERION_SLUGS } from "@/types/domain"

const raiz = process.cwd()

describe("escopo da auditoria", () => {
  it("é DERIVADO da tabela de critérios — critério novo entra sozinho", () => {
    const esperado = CRITERION_SLUGS.filter((slug) => !(slug in AUDIT_OUT_OF_SCOPE))
    expect([...AUDITABLE_CRITERIA]).toEqual(esperado)
    // A lista de exclusão é pequena de propósito; se ela crescer até engolir tudo, o card
    // deixou de existir e alguém precisa dizer isso em voz alta.
    expect(AUDITABLE_CRITERIA.length).toBeGreaterThan(0)
  })

  it("todo critério excluído EXISTE — slug com typo excluiria nada, em silêncio", () => {
    for (const slug of Object.keys(AUDIT_OUT_OF_SCOPE)) {
      expect(CRITERION_SLUGS).toContain(slug)
    }
  })

  it("toda exclusão traz o motivo por escrito, e o motivo vai pro prompt", () => {
    for (const [slug, motivo] of Object.entries(AUDIT_OUT_OF_SCOPE)) {
      expect(motivo.length).toBeGreaterThan(30)
      expect(AUDIT_SYSTEM_PROMPT).toContain(slug)
      expect(AUDIT_SYSTEM_PROMPT).toContain(motivo)
    }
  })

  it("critério fora do escopo não é auditável por nenhum caminho", () => {
    for (const slug of Object.keys(AUDIT_OUT_OF_SCOPE)) {
      expect(isAuditableCriterion(slug)).toBe(false)
      expect(AUDITABLE_CRITERIA).not.toContain(slug)
    }
  })

  it("o enum da tool DERIVA do escopo, não é uma segunda lista", () => {
    // Se alguém voltar a montar o enum a partir de CRITERION_SLUGS, o modelo passa a poder
    // nomear um critério que o filtro depois descarta — trabalho pago jogado fora, sem erro.
    const src = readFileSync(join(raiz, "lib/ai-calibration/service.ts"), "utf8")
    const enumDaTool = src.match(/criterion_slug:\s*\{\s*type:\s*"string",\s*enum:\s*(\w+)\s*\}/)
    expect(enumDaTool?.[1]).toBe("AUDITABLE_SLUG_ENUM")
    expect(src).toContain("const AUDITABLE_SLUG_ENUM = [...AUDITABLE_CRITERIA]")
  })

  it("o relatório de VIÉS continua cobrindo os 9 — diagnóstico não é escrita", () => {
    const src = readFileSync(join(raiz, "lib/ai-calibration/service.ts"), "utf8")
    expect(src).toContain("const CRITERION_SLUG_ENUM = [...CRITERION_SLUGS]")
    // O BIAS_TOOL é o único que pode usar o universo inteiro.
    const biasBlock = src.slice(src.indexOf("const BIAS_TOOL"), src.indexOf("export interface TokenUsage"))
    expect(biasBlock).toContain("CRITERION_SLUG_ENUM")
    expect(biasBlock).not.toContain("AUDITABLE_SLUG_ENUM")
  })
})

describe("auto-aplicação", () => {
  it("desligada: NENHUM par (confiança, Δ) escreve sozinho", () => {
    // Varre a grade inteira em vez de conferir a constante — é o comportamento que importa,
    // e é o que pega alguém religando o caminho por dentro sem mexer na política.
    for (let conf = 0; conf <= 1.0001; conf += 0.05) {
      for (let delta = -10; delta <= 10; delta += 0.5) {
        expect(shouldAutoApply(conf, delta)).toBe(false)
      }
    }
  })

  it("o gate guardado é o que valeria se fosse religada", () => {
    // Documenta o par sem afirmar que ele está em vigor: se a política voltar, é este o
    // corte que volta — e ele precisa continuar dentro da escala que o modelo emite.
    expect(AUTO_APPLY_MIN_CONFIDENCE).toBeGreaterThan(0)
    expect(AUTO_APPLY_MIN_CONFIDENCE).toBeLessThanOrEqual(1)
    expect(AUTO_APPLY_MAX_DELTA).toBeGreaterThan(0)
  })
})

describe("a versão do prompt acompanha a régua", () => {
  it("mudou o escopo ⇒ a versão gravada no run não pode ser a antiga", () => {
    // `prompt_version` é o que `loadLastRun` compara pra detectar drift e o que fica no
    // histórico. Deixá-la em v1 com o escopo novo faz o rótulo do run mentir E o run
    // seguinte rodar incremental sobre uma régua diferente da anterior.
    const src = readFileSync(join(raiz, "lib/ai-calibration/service.ts"), "utf8")
    const versao = src.match(/export const PROMPT_VERSION = "(v\d+)"/)?.[1]
    expect(versao).toBeDefined()
    expect(versao).not.toBe("v1")
  })
})
