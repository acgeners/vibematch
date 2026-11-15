import { CHAPTER_SOURCE_IDS } from "@/lib/external/chapter-sources/types"
import type { ChapterSourceId } from "@/lib/external/chapter-sources/types"
import type { StatusTone } from "@/lib/ui/status-tone"

/**
 * Por que uma obra ficou "não verificada" na checagem de capítulos (`/reading` e o lote
 * "Capítulos e status" do catálogo). PURO: o servidor monta, a tela e o log leem.
 *
 * 🔴 A tela e a linha `[reading-check]` do log saem do MESMO objeto (`describeCheckFailure`). Duas
 * montagens separadas do mesmo motivo divergiriam na primeira mudança de texto, e a pessoa leria
 * na tela um motivo que o log não confirma.
 *
 * - `sources`: o motivo CRU de cada fonte de capítulo (mensagem da falha, "sem vínculo",
 *   "respondeu sem capítulo", código 404, número descartado).
 * - `whole`: um motivo da obra inteira (Comix marcada como ausente, erro inesperado).
 */
export type ChapterCheckFailure =
  | { kind: "sources"; sources: Partial<Record<ChapterSourceId, string>> }
  | { kind: "whole"; reason: string }

/** Falha da fonte (vermelho) ou "não tem" (cinza), pela régua de `STATUS_TONE`. */
export type FailureTone = Extract<StatusTone, "failed" | "absent">

export interface FailureReason {
  /** Nome da fonte ("Comix"), ou `null` quando o motivo é da obra inteira. */
  source: string | null
  /** Rótulo legível ("tempo esgotado (25 s)"). */
  label: string
  tone: FailureTone
  /** O texto cru, igual ao do log — vai para a dica do rótulo. */
  raw: string
}

export const CHAPTER_SOURCE_NAME: Record<ChapterSourceId, string> = { comix: "Comix", mangago: "Mangago" }

/** `comix: limite de pedidos · mangago: tempo esgotado`, na ordem das fontes de capítulo. */
export function describeSourceFailures(failures: Partial<Record<ChapterSourceId, string>>): string {
  const parts = CHAPTER_SOURCE_IDS.flatMap((id) => (failures[id] ? [`${id}: ${failures[id]}`] : []))
  return parts.length > 0 ? parts.join(" · ") : "nenhuma fonte devolveu capítulo"
}

/** O texto da linha `[reading-check]` do log — o mesmo que a tela traduz. */
export function describeCheckFailure(failure: ChapterCheckFailure): string {
  return failure.kind === "whole" ? failure.reason : describeSourceFailures(failure.sources)
}

const NOT_THERE = new Set(["sem vínculo", "sem código, e a busca não achou", "respondeu sem capítulo"])

/**
 * Motivo cru → rótulo legível + tom. Os textos crus vêm de `getLatestChapter` (rejeição de cada
 * fonte), de `ComixUnavailableReason` e de `MangagoUnavailableError`. Motivo desconhecido aparece
 * CRU e vermelho: esconder ou suavizar o que não se reconhece é o oposto do que esta lista existe
 * para fazer.
 */
export function reasonLabel(raw: string): { label: string; tone: FailureTone } {
  const timeout = raw.match(/\[withTimeout\].*?excedeu (\d+)ms/)
  if (timeout) return { label: `tempo esgotado (${Math.round(Number(timeout[1]) / 1000)} s)`, tone: "failed" }
  if (NOT_THERE.has(raw)) return { label: raw, tone: "absent" }
  if (/ausente/.test(raw)) return { label: "marcada como ausente (checagem pulada)", tone: "absent" }
  if (/não existe \(404\)$/.test(raw)) return { label: raw, tone: "failed" }
  const discarded = raw.match(/^número descartado pela régua \((.+)\)$/)
  if (discarded) return { label: `número descartado (${discarded[1]})`, tone: "failed" }
  if (/^erro: /.test(raw)) return { label: "erro inesperado", tone: "failed" }
  if (/rate_limited/.test(raw)) return { label: "limite de pedidos", tone: "failed" }
  if (/bypass_unavailable|nenhum bypass/.test(raw)) return { label: "contorno do Cloudflare fora do ar", tone: "failed" }
  if (/\bblocked\b/.test(raw)) return { label: "bloqueado pelo site", tone: "failed" }
  if (/server_error/.test(raw)) return { label: "erro no site", tone: "failed" }
  if (/invalid_response/.test(raw)) return { label: "resposta inválida", tone: "failed" }
  if (/\btimeout\b/.test(raw)) return { label: "tempo esgotado", tone: "failed" }
  if (/fetch_failed/.test(raw)) return { label: "sem resposta", tone: "failed" }
  return { label: raw, tone: "failed" }
}

/** Os motivos de uma obra, um por fonte (ou um só, da obra inteira). */
export function failureReasons(failure: ChapterCheckFailure): FailureReason[] {
  if (failure.kind === "whole") {
    const { label, tone } = reasonLabel(failure.reason)
    // "Comix marcada como ausente" é da Comix; erro inesperado é da obra.
    const source = /^Comix /.test(failure.reason) ? CHAPTER_SOURCE_NAME.comix : null
    return [{ source, label, tone, raw: failure.reason }]
  }
  return CHAPTER_SOURCE_IDS.flatMap((id) => {
    const raw = failure.sources[id]
    if (!raw) return []
    return [{ source: CHAPTER_SOURCE_NAME[id], ...reasonLabel(raw), raw }]
  })
}

/** A chave de agrupamento: "Mangago · tempo esgotado (25 s)". */
export function reasonKey(r: Pick<FailureReason, "source" | "label">): string {
  return r.source ? `${r.source} · ${r.label}` : r.label
}

export interface ReasonGroup {
  key: string
  tone: FailureTone
  /** Quantas obras têm este motivo. */
  count: number
}

/** O resumo do topo da lista: cada motivo com quantas obras o têm, do mais comum para o menos. */
export function groupByReason(items: ReadonlyArray<{ failure: ChapterCheckFailure }>): ReasonGroup[] {
  const groups = new Map<string, ReasonGroup>()
  for (const item of items) {
    for (const r of failureReasons(item.failure)) {
      const key = reasonKey(r)
      const g = groups.get(key)
      if (g) g.count++
      else groups.set(key, { key, tone: r.tone, count: 1 })
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "pt-BR"))
}

/**
 * O título do aviso do fim da checagem. 🔴 "Nenhuma novidade" só vale para o que foi OLHADO:
 * até 15/11/2026 o aviso dizia "Nenhuma novidade encontrada" com 53 de 55 obras não verificadas
 * (a checagem rodou em produção, onde a Comix bloqueia o servidor e o Mangago não tem o contorno
 * do Cloudflare). "Não achei" e "não consegui olhar" são afirmações diferentes.
 *
 * O tom segue a régua: verde quando houve novidade ou tudo foi verificado; âmbar quando parte
 * falhou; vermelho quando nenhuma obra foi verificada.
 */
export function checkOutcomeHeadline(counts: { total: number; failed: number; news: number }): {
  title: string
  tone: "success" | "warning" | "error"
} {
  const { total, failed, news } = counts
  if (news > 0) return { title: `${news} obra${news !== 1 ? "s" : ""} com capítulo novo`, tone: "success" }
  if (failed === 0) return { title: "Nenhuma novidade encontrada", tone: "success" }
  const checked = total - failed
  if (checked <= 0) {
    return { title: total === 1 ? "A obra não foi verificada" : "Nenhuma obra foi verificada", tone: "error" }
  }
  return {
    title: `Nenhuma novidade ${checked === 1 ? "na única obra verificada" : `nas ${checked} obras verificadas`}`,
    tone: "warning",
  }
}
