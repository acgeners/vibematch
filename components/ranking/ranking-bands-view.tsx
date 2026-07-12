"use client"

import Link from "next/link"

import { cn, titleToSlug } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { getScoreTextColor } from "@/components/ui/score-badge"
import type { ColumnThresholds } from "@/components/ui/score-badge"
import { buildRankingTiers } from "@/lib/ranking/build-tiers"
import type { RankingEntry } from "@/server/queries/ranking"
import { ActiveFiltersBar } from "@/components/ranking/active-filters-bar"
import type { ActiveFilterChip } from "@/components/ranking/active-filters-bar"

/**
 * View "Faixas" (Sub-etapa C) — APRESENTAÇÃO ALTERNATIVA do MESMO dataset do
 * /ranking. Não altera fórmula, score, ordenação, snapshots nem queries: recebe
 * as `entries` JÁ ORDENADAS do getRanking e só as agrupa em faixas de prioridade.
 *
 * Objetivo (AUDIT_REPORT): comunicar menos falsa precisão. A faixa/tier é o
 * elemento primário; a Nota Prevista vira informação secundária (~x,x estim.);
 * a ordem dentro da faixa é explicitamente aproximada. Reusa a MESMA banda
 * (`tier_band_width`) e a MESMA `buildRankingTiers` da view Lista.
 */

const PRIORITY_LABELS = [
  "Prioridade alta",
  "Prioridade média-alta",
  "Prioridade média",
  "Prioridade média-baixa",
  "Prioridade baixa",
] as const

function priorityLabel(tier: number): string {
  return PRIORITY_LABELS[Math.min(Math.max(tier - 1, 0), PRIORITY_LABELS.length - 1)]
}

/** personal_fit_percentile (0–100, maior = mais afinidade) → "Top X%" (menor = elite).
 *  Usado só no tooltip; o rótulo visível é a faixa qualitativa (não inverte a leitura). */
function topPct(percentile: number | null): number | null {
  if (percentile == null) return null
  return Math.min(100, Math.max(1, Math.round(100 - percentile)))
}

/** personal_fit_percentile (0–100) → faixa qualitativa. Cresce no MESMO sentido da
 *  barra (maior percentil = mais afinidade = faixa mais alta), evitando o conflito
 *  do "Top X%" (onde menor = melhor) com a barra (onde maior = mais cheia). */
const AFFINITY_TIERS = [
  { min: 80, label: "Muito alta" },
  { min: 60, label: "Alta" },
  { min: 40, label: "Média" },
  { min: 20, label: "Baixa" },
  { min: 0, label: "Muito baixa" },
] as const
function affinityTier(percentile: number | null): string | null {
  if (percentile == null) return null
  return (AFFINITY_TIERS.find((t) => percentile >= t.min) ?? AFFINITY_TIERS[AFFINITY_TIERS.length - 1]).label
}

interface BandGroup {
  tier: number
  items: Array<{ entry: RankingEntry; position: number }>
  hasScore: boolean
}

export function RankingBandsView({
  entries,
  scoreThresholds = null,
  tierBandWidth,
  activeFilters,
  clearFiltersHref,
}: {
  entries: RankingEntry[]
  scoreThresholds?: ColumnThresholds | null
  tierBandWidth: number
  activeFilters?: ActiveFilterChip[]
  clearFiltersHref?: string
}) {
  // Mesma banda + mesma Nota Prevista da view Lista. buildRankingTiers ordena
  // internamente por score desc e devolve alinhado à entrada — como as entries
  // já vêm ordenadas do getRanking, os tiers ficam contíguos. NÃO reordena.
  const tiered = buildRankingTiers(entries, (e) => e.expectedScore, tierBandWidth)
  const groups: BandGroup[] = []
  for (let i = 0; i < entries.length; i++) {
    const t = tiered[i].tier
    const last = groups[groups.length - 1]
    const item = { entry: entries[i], position: i + 1 }
    if (last && last.tier === t) last.items.push(item)
    else groups.push({ tier: t, items: [item], hasScore: entries[i].expectedScore != null })
  }

  const thr = scoreThresholds?.expected ?? null

  return (
    <div className="space-y-3">
      {activeFilters && clearFiltersHref && (
        <ActiveFiltersBar chips={activeFilters} clearHref={clearFiltersHref} />
      )}

      <div className="overflow-hidden rounded-lg border border-border/70 bg-card/40">
        {/* cabeçalho de colunas */}
        <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="min-w-0 flex-1">Obra</span>
          <span className="w-36 shrink-0 sm:w-44">Afinidade por tags</span>
          <span className="w-24 shrink-0 text-right">Prioridade</span>
        </div>

        {groups.map((g) => {
          const first = g.items[0].position
          const last = g.items[g.items.length - 1].position
          return (
            <div key={`band-${g.tier}`}>
              {/* divisor de faixa */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-primary/20 bg-gradient-to-r from-primary/[0.08] to-transparent px-4 py-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                  <span className="font-mono">≈</span>
                  {g.hasScore ? `Faixa ${g.tier} · ${priorityLabel(g.tier)}` : "Sem previsão"}
                </span>
                <span className="text-xs text-muted-foreground">
                  <b className="font-semibold text-foreground">
                    {g.items.length} {g.items.length === 1 ? "obra" : "obras"}
                  </b>{" "}
                  na mesma faixa · posições{" "}
                  <b className="font-semibold text-foreground">
                    #{first}
                    {first !== last ? `–#${last}` : ""}
                  </b>
                </span>
                {g.items.length > 1 && (
                  <span className="inline-flex items-center gap-1 text-[11px] italic text-muted-foreground/80">
                    ↕ ordem interna aproximada
                  </span>
                )}
              </div>

              {/* linhas da faixa */}
              {g.items.map(({ entry }) => {
                const tx = topPct(entry.personalFitPercentile)
                const tierLabel = affinityTier(entry.personalFitPercentile)
                const barWidth =
                  entry.personalFitPercentile != null
                    ? Math.max(3, Math.min(100, Math.round(entry.personalFitPercentile)))
                    : 0
                return (
                  <div
                    key={entry.workId}
                    className="flex items-center gap-3 border-b border-border/40 px-4 py-2 last:border-b-0 hover:bg-primary/[0.03]"
                  >
                    {/* trilho da faixa (mesmo em todas as obras da faixa) */}
                    <span className="h-9 w-1 shrink-0 rounded-full bg-primary/30" aria-hidden />

                    {/* capa + título + tags */}
                    <Link
                      href={`/titles/${titleToSlug(entry.title)}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <span className="h-11 w-8 shrink-0 overflow-hidden rounded bg-muted">
                        {entry.coverUrl && (
                          <CoverImage url={entry.coverUrl} className="h-full w-full object-cover" />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-sm font-medium">{entry.title}</span>
                        <span className="flex flex-wrap gap-1">
                          {entry.tags.slice(0, 3).map((t) => (
                            <span
                              key={t.id}
                              className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {t.name}
                            </span>
                          ))}
                        </span>
                      </span>
                    </Link>

                    {/* afinidade por tags (faixa qualitativa; percentil no tooltip) */}
                    <span className="w-36 shrink-0 sm:w-44">
                      {tierLabel != null ? (
                        <span
                          className="inline-flex items-center gap-2"
                          title={`Afinidade por tags: ${tierLabel} — percentil ${Math.round(
                            entry.personalFitPercentile ?? 0,
                          )} no acervo exibido (top ${tx}%). Relativo ao seu perfil de gosto, não é qualidade da obra.`}
                        >
                          <span className="w-20 shrink-0 text-xs font-semibold text-foreground">{tierLabel}</span>
                          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-foreground/10">
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{ width: `${barWidth}%` }}
                            />
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">sem perfil</span>
                      )}
                    </span>

                    {/* Nota Prevista — SECUNDÁRIA (dot de cor + ~x,x estim.) */}
                    <span className="w-24 shrink-0 text-right">
                      <span
                        className="inline-flex items-center justify-end gap-1.5"
                        title="Estimativa aproximada. Erro médio histórico: ~0,6 ponto."
                      >
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full bg-current",
                            getScoreTextColor(entry.expectedScore, thr),
                          )}
                          aria-hidden
                        />
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {entry.expectedScore != null ? `~${entry.expectedScore.toFixed(1)}` : "—"}
                          <span className="ml-0.5 text-[10px] opacity-70">estim.</span>
                        </span>
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <p className="px-1 text-[11px] text-muted-foreground/80">
        Obras na mesma faixa têm prioridade equivalente (diferença dentro do erro do modelo). A
        ordem dentro da faixa é aproximada; a nota é uma estimativa (~±0,6 ponto).
      </p>
    </div>
  )
}
