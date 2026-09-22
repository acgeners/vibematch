import type { UsageTokens } from "@/lib/ai/pricing"

/**
 * Tokens estimados de UMA chamada de `consolidate_synopsis` para UMA obra.
 *
 * 🔴 **Dono ÚNICO** — o preview (`lib/cost-preview/catalog.ts`) e o GATE de custo
 * (`lib/orchestration/contracts.ts`) descrevem a MESMA chamada. Isto já viveu em duas
 * casas: até 30/07/2026 as duas diziam `1500/400`; a migração para Sonnet + prompt v3
 * remediu só o preview (`1500/330`) e deixou o gate no número velho.
 *
 * ⚠️ Mora AQUI, e não em `synopsis-consolidator.ts`, porque aquele módulo é
 * `server-only` e os dois consumidores são alcançáveis do cliente. Dado puro: **nunca
 * importe nada de servidor**. Fica ao lado do executor de propósito — quem mexer no
 * prompt vê a estimativa.
 *
 * **Proveniência:** p50 medido em `ai_api_calls`, `operation = 'synopsis_consolidator'`,
 * `claude-sonnet-5` · prompt `v3` · `status = 'success'` — **N = 228**, janela
 * 2026-07-30 → 2026-08-20. Cache: **zero** na amostra (esta operação não usa
 * `cache_control`), por isso os dois campos de cache são 0.
 *
 * 🔴 **Política: `likely` = p50; o conservadorismo mora SÓ no `COST_SAFETY_MULTIPLIER`
 * (1,5×)**, nunca inflado dentro do token. Foi assim que o `400` sobreviveu sem lastro:
 * era folgado no Haiku e virou subestimativa no Sonnet, sem nada acusar.
 *
 * ⚠️ **Baseline observada, não verdade eterna.** Estes números envelhecem por troca de
 * MODELO ou de PROMPT, exatamente como os dois anteriores — remeça o p50 ao mexer em
 * `CONSOLIDATOR_MODEL` ou `CONSOLIDATOR_PROMPT_VERSION`.
 */
export const CONSOLIDATE_SYNOPSIS_USAGE: UsageTokens = {
  inputTokens: 1612,
  outputTokens: 448,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
}
