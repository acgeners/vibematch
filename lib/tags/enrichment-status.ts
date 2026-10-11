import "server-only"
import { PaidCallBlockedError } from "@/lib/ai/anthropic-client"

/**
 * Estado do enriquecimento automático de UMA tag (`tags.enrichment_status`, migration 210).
 *
 * Existe porque, até a 210, uma falha do provider produzia o MESMO dado que uma decisão: o
 * classificador jogava a tag em `other`, o enricher devolvia "nenhum subgrupo, nenhum sinal 18+" e
 * `enrichNewTags` gravava `adult_score_tier_reviewed_at` — a marca de "passou pelo eixo". Medido na
 * nuvem em 2026-10-10: 4 tags de 08/10 ficaram assim sem NENHUMA chamada de IA no log.
 *
 * | valor                 | quer dizer                                                            |
 * |-----------------------|-----------------------------------------------------------------------|
 * | `pending`             | criada e ainda sem resultado (o default de toda tag nova)             |
 * | `done`                | o modelo respondeu sobre ESTA tag; grupo/subgrupo/18+/piso aplicados   |
 * | `partial`             | o provider respondeu, mas não sobre esta tag (omitiu ou slug inválido) |
 * | `provider_not_called` | nada foi chamado: sem `ANTHROPIC_API_KEY` ou guard de proveniência    |
 * | `provider_failed`     | a chamada foi feita e falhou                                           |
 * | `legacy`              | anterior à 210 — sem proveniência registrada                          |
 * | `curated`             | decisão humana registrada em migration (as tags que a 210 corrigiu)    |
 *
 * 🔴 Só `done` grava a marca de revisão do piso (`adult_score_tier_reviewed_at`). Qualquer outro
 * estado deixa a tag visível como "ainda precisa de enriquecimento".
 */
export const TAG_ENRICHMENT_STATUSES = [
  "pending",
  "done",
  "partial",
  "provider_not_called",
  "provider_failed",
  "legacy",
  "curated",
] as const
export type TagEnrichmentStatus = (typeof TAG_ENRICHMENT_STATUSES)[number]

/** O que aconteceu com UMA chamada ao provider (classificador ou enricher). */
export type ProviderOutcome = "ok" | "provider_not_called" | "provider_failed"

/**
 * Traduz o erro de uma chamada em outcome. Guard de proveniência e chave ausente são "não chamado"
 * (nada saiu daqui, nada foi cobrado); o resto é falha do provider.
 */
export function providerOutcomeOf(err: unknown): Exclude<ProviderOutcome, "ok"> {
  if (err instanceof PaidCallBlockedError) return "provider_not_called"
  if (err instanceof Error && /ANTHROPIC_API_KEY/.test(err.message)) return "provider_not_called"
  return "provider_failed"
}

export function providerDetailOf(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  // Corta por code point, não por unidade UTF-16: `.slice()` parte emoji ao meio e o surrogate
  // solto faz o PostgREST recusar a escrita inteira (CLAUDE.md, "Texto vindo de FORA").
  return Array.from(msg).slice(0, 300).join("")
}
