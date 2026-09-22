import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { computeCostUsd, priceForModel } from "@/lib/ai/pricing"
import { SONNET_MODEL, SONNET_4_6, SONNET_5 } from "@/lib/ai/models"
// Resolvedor CJS compartilhado com scripts/lib/ai-log.js — os tipos vêm dos JSDoc dele.
import { resolvePricingWindow, modelosComPrecoQueVence } from "@/lib/ai/pricing-window.js"

/**
 * A1a — o preço não pode VENCER em silêncio, e não pode ser INVENTADO.
 *
 * Dois modos de falha, medidos neste repositório em 22/08/2026:
 *
 * 1. VENCER — `pricing-data.json` carregava o Sonnet 5 a $2/$10 sob
 *    `snapshotTag: "static@2026-05-23"`, uma etiqueta de ORIGEM e não de validade.
 *    Se um preço vencesse sem sucessora, `resolvePricingWindow` devolveria null,
 *    `ai_api_calls.cost_usd` passaria a registrar ZERO com `pricing_source:
 *    "unknown@<model>"`, o saldo derivado ficaria otimista e o modal de saldo
 *    negativo — único freio de gasto do app — deixaria de disparar.
 *
 * 2. INVENTAR — a primeira correção agendou uma janela de $3/$15 para 01/09/2026,
 *    a partir de documentação em CACHE. A página viva desmente: o preço
 *    introdutório do Sonnet 5 virou PERMANENTE em 10/08/2026 e o aumento não vai
 *    acontecer. Preço futuro suposto é pior que preço velho: o velho ao menos
 *    descreveu a realidade um dia.
 */

interface Janela {
  validFrom: string | null
  validUntil: string | null
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheCreationPerMTok: number
}

// Lido do DISCO, não importado: o teste confere o arquivo que vai pro commit, e um import
// resolvido pelo bundler poderia servir uma cópia transformada.
const DATA = JSON.parse(
  readFileSync(join(process.cwd(), "lib/ai/pricing-data.json"), "utf8"),
) as { models: Record<string, Janela[]> }

const em = (dia: string) => Date.parse(`${dia}T12:00:00.000Z`)

describe("pricing: nenhuma faixa vence sem sucessora", () => {
  it("todo modelo tem uma janela ABERTA no fim (validUntil null)", () => {
    // 🔴 INDEPENDENTE DA DATA de hoje: reprova no dia em que alguém ESCREVE uma janela
    // que fecha, não no dia em que ela vence.
    expect(modelosComPrecoQueVence(DATA.models)).toEqual([])
  })

  it("as janelas de cada modelo são contíguas e não se sobrepõem", () => {
    for (const [modelo, janelas] of Object.entries(DATA.models)) {
      for (let i = 1; i < janelas.length; i++) {
        const anterior = janelas[i - 1]
        const atual = janelas[i]
        expect(anterior.validUntil, `${modelo}: janela ${i - 1} precisa fechar`).not.toBeNull()
        expect(atual.validFrom, `${modelo}: janela ${i} precisa abrir`).not.toBeNull()
        const diaSeguinte = new Date(Date.parse(`${anterior.validUntil}T00:00:00.000Z`) + 86_400_000)
          .toISOString()
          .slice(0, 10)
        expect(atual.validFrom, `${modelo}: buraco entre as janelas ${i - 1} e ${i}`).toBe(diaSeguinte)
      }
    }
  })

  it("o modelo Sonnet ATIVO tem preço hoje, e ele não é zero", () => {
    // O outro lado do mesmo defeito: modelo em uso e ausente da tabela custa ZERO.
    expect(priceForModel(SONNET_MODEL), `${SONNET_MODEL} sem preço vigente`).not.toBeNull()
    const custo = computeCostUsd(SONNET_MODEL, {
      inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    })
    expect(custo.costInputUsd).toBeGreaterThan(0)
    expect(custo.pricingSource).not.toMatch(/^unknown@/)
  })
})

describe("pricing: as tarifas conferidas contra a página oficial (2026-08-22)", () => {
  // 🔴 O Sonnet 5 é o caso que já foi errado nas DUAS direções. Estes valores foram
  // conferidos na página viva, não em cache.
  it.each([
    [SONNET_5, 2, 10, 0.2, 2.5],
    [SONNET_4_6, 3, 15, 0.3, 3.75],
    ["claude-opus-4-7", 5, 25, 0.5, 6.25],
    ["claude-haiku-4-5-20251001", 1, 5, 0.1, 1.25],
  ])("%s = $%s/$%s (read $%s · write5m $%s)", (modelo, input, output, read, write) => {
    expect(priceForModel(modelo as string)).toEqual({
      inputPerMTok: input, outputPerMTok: output,
      cacheReadPerMTok: read, cacheCreationPerMTok: write,
    })
  })

  it("o Sonnet 5 NÃO tem aumento agendado — $2/$10 vale depois de 01/09/2026", () => {
    // Regressão direta do erro de 22/08: uma janela de $3/$15 a partir de 01/09 foi
    // escrita a partir de doc em cache. A Anthropic tornou o $2/$10 permanente em 10/08.
    for (const dia of ["2026-08-31", "2026-09-01", "2027-01-01"]) {
      expect({ dia, ...priceForModel(SONNET_5, em(dia)) }).toMatchObject({
        inputPerMTok: 2, outputPerMTok: 10,
      })
    }
  })

  it("cacheCreation é o write de 5 MINUTOS (1,25×), que é o que o app usa", () => {
    // `cache_control: {type:"ephemeral"}` sem ttl = 5 min. O write de 1h é 2× e NÃO
    // está modelado — se algum call site passar `ttl: "1h"`, esta tabela subnotifica.
    for (const [modelo, janelas] of Object.entries(DATA.models)) {
      for (const j of janelas) {
        expect(j.cacheCreationPerMTok, `${modelo}: write ≠ 1,25× input`).toBeCloseTo(j.inputPerMTok * 1.25, 6)
        expect(j.cacheReadPerMTok, `${modelo}: read ≠ 0,1× input`).toBeCloseTo(j.inputPerMTok * 0.1, 6)
      }
    }
  })
})

describe("pricing-window: a mecânica multi-janela", () => {
  // 🔴 FIXTURE SINTÉTICA de propósito. Hoje nenhum modelo real tem duas janelas — a
  // única que existia era a suposição de 01/09 que acabou de ser removida. Sem estes
  // casos, o resolvedor temporal ficaria CONSTRUÍDO E NÃO EXERCITADO, que é o estado
  // em que uma capacidade apodrece sem nada acusar.
  const FIXTURE: Record<string, Janela[]> = {
    "modelo-com-duas-faixas": [
      { validFrom: null, validUntil: "2026-06-30", inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheCreationPerMTok: 1.25 },
      { validFrom: "2026-07-01", validUntil: null, inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheCreationPerMTok: 2.5 },
    ],
    "modelo-que-vence": [
      { validFrom: null, validUntil: "2026-06-30", inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheCreationPerMTok: 1.25 },
    ],
  }

  it("resolve a janela certa dos dois lados da virada", () => {
    expect(resolvePricingWindow(FIXTURE, "modelo-com-duas-faixas", em("2026-06-15"))).toMatchObject({ inputPerMTok: 1 })
    expect(resolvePricingWindow(FIXTURE, "modelo-com-duas-faixas", em("2026-07-15"))).toMatchObject({ inputPerMTok: 2 })
  })

  it("`validUntil` é INCLUSIVO — o último instante do dia ainda é da janela antiga", () => {
    expect(resolvePricingWindow(FIXTURE, "modelo-com-duas-faixas", Date.parse("2026-06-30T23:59:59.999Z")))
      .toMatchObject({ inputPerMTok: 1 })
    expect(resolvePricingWindow(FIXTURE, "modelo-com-duas-faixas", Date.parse("2026-07-01T00:00:00.000Z")))
      .toMatchObject({ inputPerMTok: 2 })
  })

  it("preço vencido SEM sucessora devolve null (e o caller registra unknown@)", () => {
    expect(resolvePricingWindow(FIXTURE, "modelo-que-vence", em("2026-06-15"))).not.toBeNull()
    expect(resolvePricingWindow(FIXTURE, "modelo-que-vence", em("2026-07-15"))).toBeNull()
    expect(modelosComPrecoQueVence(FIXTURE)).toEqual(["modelo-que-vence"])
  })

  it("modelo ausente devolve null", () => {
    expect(resolvePricingWindow(FIXTURE, "nao-existe", em("2026-07-15"))).toBeNull()
  })
})
