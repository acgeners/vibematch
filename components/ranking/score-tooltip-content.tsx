/**
 * Conteúdo COMPARTILHADO dos tooltips de Alinhamento e Veredito IA.
 *
 * Fonte única pra que o /ranking (cells compactas) e a aba "Notas e avaliações"
 * da obra (cards grandes) mostrem exatamente o MESMO texto ao passar o mouse.
 * Cada consumidor fornece seu próprio <TooltipContent> (side/largura variam por
 * layout); aqui vai só o corpo (os <p>). Sem "use client" de propósito: renderiza
 * tanto no server component da obra quanto nas cells client do ranking.
 */

/** Payload enriquecido do consultor (sub-fase 2.3.A — Smart Shortlist v2+). */
export interface AlignmentPayload {
  confidence?: number
  risks?: string[]
  similar_loved?: string[]
  similar_avoided?: string[]
  review_quotes?: string[]
  mood_fit?: number
}

/**
 * Corpo do tooltip do Alinhamento. Assume `value` != null (o consumidor só
 * renderiza quando há valor). Mostra o percentil como sinal principal ("Top X%")
 * e o bruto ao lado; cai num texto explicativo quando não há percentil.
 */
export function AlignmentTooltipContent({
  value,
  percentile,
}: {
  value: number
  percentile?: number | null
}) {
  const displayPct = percentile != null ? Math.round(percentile) : Math.round(value * 100)
  const rawPct = Math.round(value * 100)
  const topLabel =
    percentile == null ? null
    : percentile >= 95 ? "Top 5%"
    : percentile >= 90 ? "Top 10%"
    : percentile >= 75 ? "Top 25%"
    : percentile >= 50 ? "Acima da mediana"
    : percentile >= 25 ? "Abaixo da mediana"
    : "Bottom 25%"

  return percentile != null ? (
    <>
      <p className="text-xs font-semibold">{topLabel} da sua biblioteca</p>
      <p className="text-[11px] text-muted-foreground">
        Bruto <span className="font-mono font-semibold">{rawPct}%</span> ·
        Percentil <span className="font-mono font-semibold">{displayPct}%</span>
      </p>
    </>
  ) : (
    <>
      <p className="text-xs">Alinhamento determinístico com seu perfil de gosto.</p>
      <p className="text-[11px] text-muted-foreground">
        Combina tags amadas/evitadas (40%), faixas ideais de critério (30%) e consistência
        geral (30%). Re-rode o cálculo pra ganhar a versão percentil (Top X%).
      </p>
    </>
  )
}

/**
 * Corpo do tooltip do Veredito IA. Assume `score` != null. Mostra o veredito,
 * confiança, fit de mood, justificativa e o bloco enriquecido (riscos, reviews
 * citadas, obras similares). A desatualização NÃO entra aqui — é sinalizada
 * visualmente (ícone ↻ no ranking; borda âmbar + chip na página da obra).
 */
export function VerdictTooltipContent({
  score,
  justification,
  payload,
}: {
  score: number
  justification?: string | null
  payload?: AlignmentPayload | null
}) {
  const hasEnriched = Boolean(
    payload && (
      payload.confidence != null ||
      (payload.risks?.length ?? 0) > 0 ||
      (payload.similar_loved?.length ?? 0) > 0 ||
      (payload.similar_avoided?.length ?? 0) > 0 ||
      (payload.review_quotes?.length ?? 0) > 0 ||
      payload.mood_fit != null
    ),
  )

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-xs">Veredito IA: {Math.round(score)}/100</p>
        {payload?.confidence != null && (
          <span className="text-[11px] text-muted-foreground">
            Confiança: <span className="font-semibold">{(payload.confidence * 100).toFixed(0)}%</span>
          </span>
        )}
      </div>
      {payload?.mood_fit != null && (
        <p className="text-[11px] text-muted-foreground">
          Fit com mood: <span className="font-mono font-semibold">{(payload.mood_fit * 100).toFixed(0)}%</span>
        </p>
      )}
      {justification && <p className="text-xs leading-relaxed">{justification}</p>}
      {hasEnriched && (
        <div className="border-t border-border/40 pt-1.5 space-y-1.5">
          {payload?.risks && payload.risks.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-500">⚠ Riscos</p>
              <ul className="mt-0.5 text-xs space-y-0.5">
                {payload.risks.map((r, i) => (
                  <li key={i} className="leading-snug">• {r}</li>
                ))}
              </ul>
            </div>
          )}
          {payload?.review_quotes && payload.review_quotes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Reviews citadas</p>
              <ul className="mt-0.5 text-xs italic space-y-0.5">
                {payload.review_quotes.map((q, i) => (
                  <li key={i} className="leading-snug">&ldquo;{q}&rdquo;</li>
                ))}
              </ul>
            </div>
          )}
          {payload?.similar_loved && payload.similar_loved.length > 0 && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
              Lembra de obras que você ama ({payload.similar_loved.length} similar{payload.similar_loved.length > 1 ? "es" : ""})
            </p>
          )}
          {payload?.similar_avoided && payload.similar_avoided.length > 0 && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400">
              Lembra de obras que você não curtiu ({payload.similar_avoided.length})
            </p>
          )}
        </div>
      )}
    </>
  )
}
