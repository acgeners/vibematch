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
  temEvidenciaParaAuditar,
  temLeituraDoUsuario,
  POST_READING_FIELDS,
} from "@/lib/ai-calibration/policy"
import { AUDIT_SYSTEM_PROMPT, buildAuditUserPrompt } from "@/lib/ai-calibration/prompts"
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

describe("evidência: o auditor não julga no escuro", () => {
  const cheio = { consensus: "leitores acham leve", divergence: null, traits: [] }
  const soTraits = { consensus: null, divergence: null, traits: [{ axis: "ritmo" }] }
  const vazio = { consensus: null, divergence: null, traits: [] }

  it("obra sem nenhum sinal de review fica de fora", () => {
    expect(temEvidenciaParaAuditar(vazio)).toBe(false)
  })

  it("qualquer um dos três sinais basta", () => {
    expect(temEvidenciaParaAuditar(cheio)).toBe(true)
    expect(temEvidenciaParaAuditar({ consensus: null, divergence: "divide opiniões", traits: [] })).toBe(true)
    expect(temEvidenciaParaAuditar(soTraits)).toBe(true)
  })
})

describe("o prompt carrega a evidência e a escala", () => {
  const obra = {
    workId: "w1",
    title: "Obra de Teste",
    userScore: 8.4,
    isFavorite: false,
    synopsis: "uma sinopse",
    observation: null,
    tags: [{ name: "Royalty", group: "setting" }],
    categoryScores: { drama: { score: 5, source: "ai_accepted" as const } },
    postScores: {},
    digest: {
      consensus: "tom geral leve, evitando drama pesado",
      divergence: "o ritmo divide os leitores",
      traits: [{ axis: "ritmo", trait: "primeira metade arrastada", polarity: "negative" }],
    },
  }
  const ancoras = [
    { slug: "drama" as const, mean: 6.2, stdev: 1.4, p25: 5, p50: 6, p75: 7, n: 211 },
  ]

  it("o consenso das reviews entra — era a evidência que faltava", () => {
    const p = buildAuditUserPrompt([obra], ancoras)
    expect(p).toContain("tom geral leve, evitando drama pesado")
    expect(p).toContain("o ritmo divide os leitores")
    expect(p).toContain("ritmo: primeira metade arrastada [negative]")
  })

  it("a distribuição do catálogo entra — era a escala que faltava", () => {
    const p = buildAuditUserPrompt([obra], ancoras)
    expect(p).toContain("ÂNCORAS DO CATÁLOGO")
    // A mediana é o número que impede propor 3,0 num critério que vive em 8,0.
    expect(p).toMatch(/drama \| 6\.2 \| 1\.4 \| 5\.0 \| 6\.0 \| 7\.0 \| 211/)
  })

  it("sem âncoras o bloco não aparece — nada de tabela vazia afirmando escala", () => {
    const p = buildAuditUserPrompt([obra], [])
    expect(p).not.toContain("ÂNCORAS DO CATÁLOGO")
  })

  it("as regras que nomeiam as duas falhas de 85% estão no system prompt", () => {
    // Não é conferir grafia: cada uma corresponde a um erro medido, e sumir com elas devolve
    // o erro. 5b = contradizer o consenso sem dizer; 5c = tag sem sujeito nem valência.
    expect(AUDIT_SYSTEM_PROMPT).toContain("precedência sobre inferência a partir de tag")
    expect(AUDIT_SYSTEM_PROMPT).toContain("não atribui SUJEITO nem VALÊNCIA")
    expect(AUDIT_SYSTEM_PROMPT).toContain("ÂNCORAS DO CATÁLOGO")
  })
})

describe("a pool exige a leitura de quem avaliou", () => {
  it("nota geral não basta — sem pós-leitura a obra fica fora", () => {
    // `user_score` é GOSTO (média dos eixos de taste). Sozinho, ele não prova que alguém
    // observou o atributo — e foi ele que produziu a auto-aplicação defeituosa de 16/08.
    expect(temLeituraDoUsuario({})).toBe(false)
    expect(temLeituraDoUsuario({ user_score: 9.4 })).toBe(false)
  })

  it("qualquer dimensão de pós-leitura basta", () => {
    for (const campo of POST_READING_FIELDS) {
      expect(temLeituraDoUsuario({ [campo]: 8 }), `${campo} deveria bastar`).toBe(true)
    }
  })

  it("o SELECT da pool e a lista de campos não podem divergir", () => {
    // Duas listas dos mesmos campos: uma no literal que o PostgREST entende, outra na
    // política. Divergindo, a query traz menos colunas do que o filtro consulta e a obra
    // cai fora por dado ausente — silenciosamente.
    const src = readFileSync(join(raiz, "server/queries/calibration.ts"), "utf8")
    const bloco = src.slice(src.indexOf("const AUDIT_POOL_SELECT"), src.indexOf("const BIAS_WORK_SELECT"))
    for (const campo of POST_READING_FIELDS) {
      expect(bloco, `AUDIT_POOL_SELECT não traz ${campo}`).toContain(campo)
    }
  })
})

describe("o gosto saiu de âncora", () => {
  it("o prompt proíbe justificar por user_score e promove a pós-leitura", () => {
    expect(AUDIT_SYSTEM_PROMPT).toContain("nunca justificativa")
    expect(AUDIT_SYSTEM_PROMPT).toContain("não sustenta subir critério nenhum")
    expect(AUDIT_SYSTEM_PROMPT).toContain("são a avaliação de quem LEU a obra")
  })

  it("a versão pula a v4 — ela já existe no log com outra régua", () => {
    const src = readFileSync(join(raiz, "lib/ai-calibration/service.ts"), "utf8")
    const versao = src.match(/export const PROMPT_VERSION = "(v\d+)"/)?.[1]
    expect(["v1", "v2", "v3", "v4"]).not.toContain(versao)
  })
})
