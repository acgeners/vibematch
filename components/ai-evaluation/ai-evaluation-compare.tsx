"use client"

import { Button } from "@/components/ui/button"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * Forma mínima necessária pra comparar — subconjunto estrutural de `AiEvaluation`.
 * Mantida frouxa de propósito pra aceitar tanto o `AiEvaluation` completo (painel
 * da fila) quanto o `latestAiEval` mais enxuto carregado na página da obra.
 */
export interface CompareEval {
  model_name: string | null
  confidence: number | null
  summary: string | null
  ai_evaluation_scores?: Array<{
    criterion_slug: string
    suggested_score: number | null
    justification: string | null
  }>
}

// Acima deste |Δ| o critério é destacado como divergência relevante entre os
// dois modelos — o que importa pra julgar se vale trocar de modelo.
const DIVERGENCE_THRESHOLD = 1.5

function modelLabel(modelName: string | null): string {
  if (!modelName) return "Modelo"
  if (/haiku/i.test(modelName)) return "Haiku 4.5"
  if (/opus/i.test(modelName)) return "Opus 4.7"
  if (/sonnet/i.test(modelName)) return "Sonnet 4.6"
  return modelName
}

function confidenceBadgeClass(confidence: number | null): string {
  if (confidence == null) return "border-border bg-muted text-muted-foreground"
  if (confidence >= 0.75) return "border-emerald-300 bg-emerald-50 text-emerald-700"
  if (confidence >= 0.5) return "border-amber-300 bg-amber-50 text-amber-700"
  return "border-rose-300 bg-rose-50 text-rose-700"
}

interface ScoreCell {
  score: number | null
  justification: string | null
}

function scoreMap(ev: CompareEval): Map<string, ScoreCell> {
  const map = new Map<string, ScoreCell>()
  for (const s of ev.ai_evaluation_scores ?? []) {
    map.set(s.criterion_slug, { score: s.suggested_score, justification: s.justification })
  }
  return map
}

function fmt(score: number | null): string {
  return score == null ? "—" : score.toFixed(1)
}

interface AiEvaluationCompareProps {
  /** Avaliação A (coluna esquerda — tipicamente a atual/Sonnet). */
  a: CompareEval
  /** Avaliação B (coluna direita — tipicamente a reavaliação/Haiku). */
  b: CompareEval
  /** Carrega a avaliação escolhida no form editável de revisão. */
  onPick: (which: "a" | "b") => void
  onClose: () => void
}

export function AiEvaluationCompare({ a, b, onPick, onClose }: AiEvaluationCompareProps) {
  const mapA = scoreMap(a)
  const mapB = scoreMap(b)

  const rows = CRITERION_SLUGS.map((slug) => {
    const sa = mapA.get(slug)?.score ?? null
    const sb = mapB.get(slug)?.score ?? null
    const delta = sa != null && sb != null ? sb - sa : null
    return {
      slug,
      label: CRITERIA_INFO[slug]?.name ?? slug,
      a: mapA.get(slug) ?? { score: null, justification: null },
      b: mapB.get(slug) ?? { score: null, justification: null },
      delta,
      diverges: delta != null && Math.abs(delta) >= DIVERGENCE_THRESHOLD,
    }
  })

  const divergences = rows.filter((r) => r.diverges).length
  const deltas = rows.map((r) => r.delta).filter((d): d is number => d != null)
  const meanAbsDelta =
    deltas.length > 0 ? deltas.reduce((acc, d) => acc + Math.abs(d), 0) / deltas.length : 0

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {divergences > 0 ? (
          <>
            <strong className="text-foreground">{divergences}</strong> de {rows.length} critérios
            divergem ≥ {DIVERGENCE_THRESHOLD} · diferença média{" "}
            <strong className="text-foreground">{meanAbsDelta.toFixed(2)}</strong>
          </>
        ) : (
          <>Os dois modelos concordam (nenhum critério diverge ≥ {DIVERGENCE_THRESHOLD}).</>
        )}
      </p>

      {/* Cabeçalho das colunas */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 gap-y-2 text-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Critério
        </div>
        <div className="w-14 text-center text-xs font-semibold">{modelLabel(a.model_name)}</div>
        <div className="w-14 text-center text-xs font-semibold">{modelLabel(b.model_name)}</div>
        <div className="w-12 text-center text-xs font-medium text-muted-foreground">Δ</div>

        {rows.map((row) => (
          <div key={row.slug} className="contents">
            <div className="truncate text-sm" title={row.label}>
              {row.label}
            </div>
            <div className="w-14 text-center tabular-nums">{fmt(row.a.score)}</div>
            <div
              className={`w-14 text-center tabular-nums ${row.diverges ? "font-semibold" : ""}`}
            >
              {fmt(row.b.score)}
            </div>
            <div
              className={`w-12 text-center text-xs tabular-nums ${
                row.delta == null
                  ? "text-muted-foreground"
                  : row.diverges
                    ? row.delta > 0
                      ? "font-semibold text-emerald-600"
                      : "font-semibold text-rose-600"
                    : "text-muted-foreground"
              }`}
            >
              {row.delta == null ? "—" : `${row.delta > 0 ? "+" : ""}${row.delta.toFixed(1)}`}
            </div>
          </div>
        ))}
      </div>

      {/* Confiança + resumos + justificativas (colapsadas) */}
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          { key: "a" as const, ev: a, map: mapA },
          { key: "b" as const, ev: b, map: mapB },
        ]).map(({ key, ev, map }) => (
          <div key={key} className="space-y-2 rounded-md border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{modelLabel(ev.model_name)}</span>
              {ev.confidence != null && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(ev.confidence)}`}
                >
                  Confiança: {Math.round(ev.confidence * 100)}%
                </span>
              )}
            </div>
            {ev.summary && <p className="text-xs text-muted-foreground">{ev.summary}</p>}
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Ver justificativas por critério
              </summary>
              <div className="mt-2 space-y-2">
                {CRITERION_SLUGS.map((slug) => (
                  <div key={slug}>
                    <span className="font-medium">{CRITERIA_INFO[slug]?.name ?? slug}:</span>{" "}
                    <span className="text-muted-foreground">
                      {map.get(slug)?.justification ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
            <Button size="sm" className="w-full" onClick={() => onPick(key)}>
              Usar {modelLabel(ev.model_name)}
            </Button>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar sem escolher
        </Button>
      </div>
    </div>
  )
}
