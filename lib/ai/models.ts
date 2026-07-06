/**
 * Fonte ÚNICA do modelo Sonnet ativo no app + a regra de compatibilidade de
 * parâmetros por família de modelo. Centralizado aqui pra que trocar o Sonnet
 * seja UMA linha (`SONNET_MODEL`) e a compat rode no wrapper (anthropic-client.ts),
 * não espalhada por cada call site.
 */

export const SONNET_4_6 = "claude-sonnet-4-6"
export const SONNET_5 = "claude-sonnet-5"

/**
 * Sonnet ATIVO. Trocado pro Sonnet 5 durante a promo introdutória ($2/$10 por
 * MTok até 2026-08-31 — ~11% mais barato que o 4.6 nesse período; o tokenizer
 * novo conta ~34% mais tokens, então FORA da promo o S5 fica ~34% mais caro).
 *
 * ⏪ REVERTER: no fim de agosto/2026, troque `SONNET_5` → `SONNET_4_6` NESTA linha.
 * Todos os call sites Sonnet importam esta constante e a compat (temperature/thinking)
 * é derivada do próprio ID no wrapper (`modelRejectsSampling`), então reverter aqui
 * restaura 100% o comportamento do 4.6 sem tocar em mais nada.
 */
export const SONNET_MODEL: string = SONNET_5

/**
 * Famílias que REJEITAM parâmetros de sampling (`temperature`/`top_p`/`top_k` →
 * HTTP 400) e ligam thinking por default quando ele é omitido: Sonnet 5, Opus
 * 4.7/4.8, Fable 5. O wrapper usa isto pra sanitizar os params — tirar sampling
 * e fixar `thinking:{type:"disabled"}` (todas essas famílias aceitam `disabled`),
 * preservando o comportamento determinístico atual (o 4.6 rodava sem thinking).
 */
export function modelRejectsSampling(model: string): boolean {
  return /sonnet-5|opus-4-7|opus-4-8/i.test(model)
}
