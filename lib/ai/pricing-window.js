// Resolvedor ÚNICO da janela de preço vigente. CJS de propósito: precisa ser lido
// pelos DOIS consumidores do `pricing-data.json` — o `lib/ai/pricing.ts` (app, TS/ESM)
// e o `scripts/lib/ai-log.js` (scripts admin, Node puro/CJS, que não consegue importar
// TS com alias `@/`).
//
// 🔴 Duas implementações da MESMA seleção seriam "dois critérios pro mesmo fato" no lugar
// mais caro: o app e os scripts gravariam custos diferentes na MESMA tabela `ai_api_calls`,
// e a divergência só apareceria no saldo — sem erro e sem log.
//
// Semântica das janelas (em `pricing-data.json`, `models[<id>]` é um ARRAY):
//   validFrom: null  → vale desde sempre
//   validUntil: null → vale indefinidamente (janela ABERTA)
//   validUntil: "YYYY-MM-DD" → INCLUSIVO: o preço vale até o fim daquele dia (UTC)
//
// ⚠️ Toda linha de `ai_api_calls` grava o custo NO INSERT, então trocar a janela não
// reescreve histórico — a resolução é sempre "o preço na hora da chamada".

/**
 * @typedef {{inputPerMTok:number,outputPerMTok:number,cacheReadPerMTok:number,cacheCreationPerMTok:number}} ModelPricing
 * @typedef {ModelPricing & {validFrom:string|null,validUntil:string|null,nota?:string}} PricingWindow
 */

/** Fim do dia (UTC) de uma data `YYYY-MM-DD` — `validUntil` é inclusivo. */
function fimDoDiaUtc(yyyymmdd) {
  return Date.parse(`${yyyymmdd}T23:59:59.999Z`)
}

/** Início do dia (UTC) de uma data `YYYY-MM-DD`. */
function inicioDoDiaUtc(yyyymmdd) {
  return Date.parse(`${yyyymmdd}T00:00:00.000Z`)
}

/**
 * Janela vigente de um modelo no instante `at`. Devolve `null` quando o modelo não
 * existe OU quando existe mas nenhuma janela cobre `at` — os dois casos são
 * "não sei o preço", e o caller já trata isso como `unknown@<model>`.
 *
 * @param {Record<string, PricingWindow[]>} models
 * @param {string} model
 * @param {Date|number} [at]
 * @returns {ModelPricing|null}
 */
function resolvePricingWindow(models, model, at) {
  const janelas = models[model]
  if (!Array.isArray(janelas) || janelas.length === 0) return null
  const t = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.now()

  for (const j of janelas) {
    const depoisDoInicio = j.validFrom == null || t >= inicioDoDiaUtc(j.validFrom)
    const antesDoFim = j.validUntil == null || t <= fimDoDiaUtc(j.validUntil)
    if (depoisDoInicio && antesDoFim) {
      return {
        inputPerMTok: j.inputPerMTok,
        outputPerMTok: j.outputPerMTok,
        cacheReadPerMTok: j.cacheReadPerMTok,
        cacheCreationPerMTok: j.cacheCreationPerMTok,
      }
    }
  }
  return null
}

/**
 * Modelos cuja ÚLTIMA janela tem `validUntil` — ou seja, o preço vence e não há
 * sucessora. É o que o teste-guarda reprova: sem sucessora, passada a data o app
 * volta a não saber o preço e passa a registrar custo ZERO, em silêncio.
 *
 * @param {Record<string, PricingWindow[]>} models
 * @returns {string[]}
 */
function modelosComPrecoQueVence(models) {
  const out = []
  for (const [id, janelas] of Object.entries(models)) {
    if (!Array.isArray(janelas) || janelas.length === 0) { out.push(id); continue }
    const ultima = janelas[janelas.length - 1]
    if (ultima.validUntil != null) out.push(id)
  }
  return out
}

module.exports = { resolvePricingWindow, modelosComPrecoQueVence }
