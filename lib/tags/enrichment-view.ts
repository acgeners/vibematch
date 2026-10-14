import type { StatusTone } from "@/lib/ui/status-tone"

/**
 * Os estados de `tags.enrichment_status` (migration 210) do jeito que a TELA precisa lê-los. Módulo
 * PURO — sem `server-only` — porque o painel "Tags novas" é client e o servidor usa a mesma lista
 * para montar a fila: uma 2ª cópia é como a fila mostra uma tag que o contador não conta.
 *
 * Significado de cada valor: `lib/tags/enrichment-status.ts`.
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

/**
 * A classificação automática NÃO terminou: grupo, subgrupo e 18+ desta tag não são decisão de
 * ninguém. `legacy` (anterior à 210, sem registro) e `curated` (decisão registrada em migration)
 * ficam de fora: não há o que reprocessar neles.
 */
export const ENRICHMENT_NEEDS_RECOVERY = [
  "pending",
  "partial",
  "provider_not_called",
  "provider_failed",
] as const satisfies readonly TagEnrichmentStatus[]

export function enrichmentNeedsRecovery(status: string | null | undefined): boolean {
  return (ENRICHMENT_NEEDS_RECOVERY as readonly string[]).includes(status ?? "")
}

export interface EnrichmentStatusView {
  label: string
  tone: StatusTone
  /** O que o estado quer dizer, para o `title`/texto de apoio. */
  hint: string
}

/**
 * Rótulo do estado quando a classificação NÃO terminou; `null` quando ela está registrada (`done`,
 * `curated`, `legacy`). 🔴 Nenhum destes pode aparecer como "Não é 18+": nesses estados a ausência de
 * flag quer dizer "ninguém avaliou", não "avaliado e sem sinal".
 */
export function enrichmentStatusView(status: string | null | undefined): EnrichmentStatusView | null {
  switch (status) {
    case "pending":
      return {
        label: "Não classificada",
        tone: "pending",
        hint: "A classificação automática ainda não rodou ou não terminou (o processo pode ter sido interrompido).",
      }
    case "provider_not_called":
      return {
        label: "IA não chamada",
        tone: "pending",
        hint: "Nada foi enviado ao provider (sem chave ou recusado pela guarda de código canônico).",
      }
    case "provider_failed":
      return {
        label: "Classificação falhou",
        tone: "failed",
        hint: "A chamada ao provider foi feita e falhou; nada desta tag foi decidido.",
      }
    case "partial":
      return {
        label: "Classificação incompleta",
        tone: "failed",
        hint: "O provider respondeu, mas a classificação desta tag não ficou completa (omitida, inválida, truncada ou não gravada).",
      }
    default:
      return null
  }
}

// ── Proveniência HUMANA por campo (`tags.human_decisions`, migration 219) ─────────────────────────

/** Os campos que um humano pode decidir numa tag. A migration 219 aceita só estas chaves. */
export const HUMAN_DECISION_FIELDS = ["group", "adult", "adult_score_tier", "subgroup"] as const
export type HumanDecisionField = (typeof HUMAN_DECISION_FIELDS)[number]

/** Quem decidiu e quando — o VALOR fica nas colunas canônicas, nunca aqui. */
export interface HumanDecision {
  at: string
  /** `auth.users.id` de quem decidiu, quando a sessão o fornece. */
  by?: string
}
export type HumanDecisions = Partial<Record<HumanDecisionField, HumanDecision>>

/** Lê a coluna com tolerância: forma inesperada vira `{}` (nenhuma decisão), nunca uma decisão inventada. */
export function parseHumanDecisions(raw: unknown): HumanDecisions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: HumanDecisions = {}
  for (const f of HUMAN_DECISION_FIELDS) {
    const v = (raw as Record<string, unknown>)[f]
    if (v && typeof v === "object" && typeof (v as HumanDecision).at === "string") {
      const { at, by } = v as HumanDecision
      out[f] = typeof by === "string" ? { at, by } : { at }
    }
  }
  return out
}

/**
 * Onde uma tag está na RECUPERAÇÃO de uma classificação automática que não terminou.
 *
 *   · `not_needed`        — a automação concluiu (`done`) ou a tag tem registro (`curated`, `legacy`);
 *   · `open`              — nada do que importa foi decidido;
 *   · `in_progress`       — parte decidida (ex.: o classificador deu o grupo, falta o 18+);
 *   · `resolved_manually` — o que importa está decidido, sem a IA ter concluído.
 *
 * 🔴 O que IMPORTA (a régua mínima, revisada contra o produto em 2026-10-13):
 *   · GRUPO definido — `tag_group_id` não nulo. Grupo do catálogo ou do classificador É decisão (o
 *     classificador só grava quando respondeu sobre a tag); sem grupo a tag sai do menu da inferência
 *     e das telas por grupo.
 *   · SINAL 18+ decidido por um HUMANO. Numa tag que não concluiu, flag falsa quer dizer "ninguém
 *     avaliou" — e é o sinal que liga o gate 18+ das obras. Flag verdadeira gravada por uma escrita
 *     parcial da IA também não conta: o desfecho da IA não foi confirmado.
 * Fica FORA, de propósito: subgrupo (ausência é legítima), sinônimo (só proposta) e piso. O piso não é
 * exigido aqui porque a fila "Piso adulto" já lista toda tag adulta sem piso decidido
 * (`listAdultScoreTierBacklog`) — cobrar o mesmo campo em duas filas viraria checklist, e sem piso a
 * obra fica sem piso nenhum, que é o padrão conservador.
 */
export type RecoveryState = "not_needed" | "open" | "in_progress" | "resolved_manually"

export function recoveryState(t: {
  enrichmentStatus: string | null | undefined
  hasGroup: boolean
  humanDecisions: HumanDecisions
}): RecoveryState {
  if (!enrichmentNeedsRecovery(t.enrichmentStatus)) return "not_needed"
  const decididos = [t.hasGroup, Boolean(t.humanDecisions.adult)].filter(Boolean).length
  if (decididos === 2) return "resolved_manually"
  return decididos === 0 ? "open" : "in_progress"
}

/** A tag ainda precisa de alguém: a automação não concluiu E o mínimo não foi decidido à mão. */
export function stillNeedsRecovery(state: RecoveryState): boolean {
  return state === "open" || state === "in_progress"
}
