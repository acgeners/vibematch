/**
 * Fonte ÚNICA do modelo Sonnet ativo no app + a regra de compatibilidade de
 * parâmetros por família de modelo. Centralizado aqui pra que trocar o Sonnet
 * seja UMA linha (`SONNET_MODEL`) e a compat rode no wrapper (anthropic-client.ts),
 * não espalhada por cada call site.
 */

export const SONNET_4_6 = "claude-sonnet-4-6"
export const SONNET_5 = "claude-sonnet-5"

/**
 * Sonnet ATIVO.
 *
 * ✅ **NÃO há mais reversão agendada.** O app foi pro Sonnet 5 durante a promoção
 * introdutória ($2/$10 por MTok, anunciada até 2026-08-31), e a Anthropic tornou esse
 * preço PERMANENTE em 10/08/2026 — o aumento para $3/$15 em 01/09 não vai acontecer
 * (nota `claude-sonnet-5-introductory-pricing` na página de pricing, conferida na fonte
 * viva em 2026-08-22). Este comentário dizia "⏪ REVERTER no fim de agosto/2026"; isso
 * caducou.
 *
 * 🔴 Tarifa NÃO é custo por trabalho. O tokenizer da família 4.7+ produz **~30% mais
 * tokens para o mesmo texto** (número oficial; este comentário já cravou "~34%", que era
 * inferência). Comparando com o 4.6 a $3/$15: $2 × 1,30 = $2,60 de input efetivo contra
 * $3,00, e $10 × 1,30 = $13 de output contra $15. Ou seja o S5 sai mais barato mesmo
 * absorvendo o tokenizer — **mas isso é ESTIMATIVA**. O número que decide sai de
 * `ai_api_calls`, que já tem chamadas dos dois modelos: meça antes de usar custo como
 * argumento.
 *
 * ⚠️ Trocar de modelo é trocar de RÉGUA de avaliação, não só de preço — ver a Onda B do
 * PLANO_INTEGRADO. Se um dia voltar pro 4.6, troque `SONNET_5` → `SONNET_4_6` NESTA
 * linha: todos os call sites Sonnet importam esta constante e a compat
 * (temperature/thinking) é derivada do próprio ID no wrapper (`modelRejectsSampling`).
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
