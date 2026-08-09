import { describe, expect, it } from "vitest"

import { CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import {
  CRITERIA_COHERENCE_RULE,
  CRITERIA_SCALE_LEGEND,
  RANKING_SYSTEM_PROMPT,
} from "@/lib/ai-recommendation/prompts"
import { DEEP_DIVE_SYSTEM_PROMPT } from "@/lib/ai-recommendation/deep-dive-prompts"

/**
 * Ranking e Deep Dive recebem `category_scores: tragedy=6.0, couple_dynamics=8.0, …` como
 * números CRUS — sem a rubrica e sem as justificativas que os produziram — ao lado das tags em
 * texto e do digest inteiro. Sem saber o que 6,0 significa, o consultor escrevia a prosa a
 * partir do digest e os números viravam enfeite.
 *
 * Medido em 2026-08-09 sobre 281 itens de ranking persistidos: **21 descrevem abuso, toxicidade
 * ou violência numa obra cujo `couple_dynamics` ≥ 7** — a faixa que significa relação SAUDÁVEL.
 * Caso real (`tragedy=6.0`, `couple_dynamics=8.0`): *"o tom é predominantemente 'dark ambience'
 * com abuso físico extremo e tragédia como pano de fundo constante"* — vocabulário da faixa
 * 9-10 sobre um 6,0, com `alignment_score` 62 e a lista de atributos ao lado na mesma tela.
 */
describe("CRITERIA_SCALE_LEGEND", () => {
  it("cobre os 9 critérios", () => {
    for (const slug of CRITERION_SLUGS) {
      expect(CRITERIA_SCALE_LEGEND, `critério fora da legenda: ${slug}`).toContain(`- ${slug}:`)
    }
  })

  it("é DERIVADA de CRITERIA_RUBRICS, não escrita à mão", () => {
    // `sync-constants` reescreve as faixas a partir do banco. Uma cópia literal aqui viraria a
    // 2ª régua pro mesmo número — mesma armadilha do LOW_BALANCE_USD e do STRONG_TAG_WEIGHT.
    // Este teste falha se alguém trocar a derivação por texto fixo e a rubrica mudar depois.
    for (const slug of CRITERION_SLUGS) {
      const linha = CRITERIA_SCALE_LEGEND.split("\n").find((l) => l.startsWith(`- ${slug}:`))
      expect(linha, `linha ausente pro slug ${slug}`).toBeTruthy()
      for (const range of CRITERIA_RUBRICS[slug]?.ranges ?? []) {
        const [banda, resto = ""] = range.split("|")
        const rotulo = resto.split(":")[0].trim()
        expect(linha, `rótulo fora de sincronia em ${slug}: ${banda.trim()} ${rotulo}`).toContain(
          `${banda.trim()} ${rotulo}`,
        )
      }
    }
  })

  it("avisa que couple_dynamics é valência, não presença", () => {
    // Sem isto, a legenda ENSINA o erro: "0-3 Destrutiva" lido na chave de presença vira
    // "quase não tem dinâmica", que é o oposto.
    expect(CRITERIA_SCALE_LEGEND).toMatch(/couple_dynamics é escala de VALÊNCIA/)
    expect(CRITERIA_SCALE_LEGEND).toMatch(/NÃO significa 'pouca dinâmica'/)
  })
})

describe("CRITERIA_COHERENCE_RULE", () => {
  it("proíbe prosa que contradiz o número, com os dois casos medidos nomeados", () => {
    expect(CRITERIA_COHERENCE_RULE).toMatch(/COERÊNCIA COM OS ATRIBUTOS/)
    expect(CRITERIA_COHERENCE_RULE).toMatch(/tragédia constante/)
    expect(CRITERIA_COHERENCE_RULE).toMatch(/couple_dynamics` ≥ 7/)
  })

  it("manda DECLARAR a divergência em vez de escolher um lado calado", () => {
    // O ponto não é obrigar o consultor a obedecer o número — é impedir que ele resolva o
    // empate em silêncio. Divergência entre digest e atributos é informação sobre a obra.
    expect(CRITERIA_COHERENCE_RULE).toMatch(/registre em `risks` que há divergência/)
    expect(CRITERIA_COHERENCE_RULE).toMatch(/ABAIXE o `confidence`/)
    // E não pode virar desculpa pra ignorar as reviews — o viés oposto.
    expect(CRITERIA_COHERENCE_RULE).toMatch(/NÃO é permissão pra ignorar as reviews/)
  })
})

describe("os dois consumidores de category_scores carregam legenda e coerência", () => {
  // Deep Dive tem uma cópia PRÓPRIA de `formatCategoryScores` e por isso é fácil corrigir só o
  // ranking e achar que acabou. São dois prompts, dois lugares, uma constante só.
  it.each([
    ["RANKING_SYSTEM_PROMPT", RANKING_SYSTEM_PROMPT],
    ["DEEP_DIVE_SYSTEM_PROMPT", DEEP_DIVE_SYSTEM_PROMPT],
  ])("%s", (_nome, prompt) => {
    expect(prompt).toContain(CRITERIA_SCALE_LEGEND)
    expect(prompt).toContain(CRITERIA_COHERENCE_RULE)
  })
})
