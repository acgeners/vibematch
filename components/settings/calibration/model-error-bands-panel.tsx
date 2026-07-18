import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { OofBucketBreakdown } from "@/lib/calculations/calibration"

/**
 * "Onde a Nota Prevista erra mais" — MAE OUT-OF-FOLD por faixa (tipicidade e
 * votos). Diagnóstico de saúde do MODELO de Nota Prevista; mora em "Viés &
 * atributos" (ao lado da Saúde do modelo de gosto). Consome só o breakdown OOF
 * já computado no recalc (`getOofBucketBreakdown`) — sem in-sample (otimista).
 */

// Gate de effect-size pra sinalizar uma faixa como outlier: amostra mínima (buckets
// pequenos são instáveis) + erro >= média + margem absoluta.
const OUTLIER_MIN_N = 30
const OUTLIER_DELTA = 0.15

interface FlaggedBucket {
  group: string
  label: string
  mae: number
  count: number
  delta: number
}

function findOutliers(overallMae: number | null, buckets: OofBucketBreakdown): FlaggedBucket[] {
  if (overallMae == null) return []
  const scan = (group: string, list: OofBucketBreakdown["byDistance"]) =>
    list
      .filter(
        (b): b is { label: string; count: number; mae: number } =>
          b.mae != null && b.count >= OUTLIER_MIN_N && b.mae >= overallMae + OUTLIER_DELTA,
      )
      .map((b) => ({ group, label: b.label, mae: b.mae, count: b.count, delta: b.mae - overallMae }))
  return [
    ...scan("distância ao centróide", buckets.byDistance),
    ...scan("nº de votos", buckets.byVotes),
  ]
}

function BucketBars({ title, buckets }: { title: string; buckets: OofBucketBreakdown["byDistance"] }) {
  const maxMae = Math.max(...buckets.map((b) => b.mae ?? 0), 0.1)
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{title}</p>
      <div className="space-y-1">
        {buckets.map((bucket) => {
          const pct = bucket.mae != null ? (bucket.mae / maxMae) * 100 : 0
          return (
            <div key={bucket.label} className="flex items-center gap-2 px-1 text-xs">
              <span className="w-20 font-mono text-muted-foreground">{bucket.label}</span>
              <div className="flex-1 overflow-hidden rounded-sm bg-muted/40">
                <div
                  className={cn("h-3 transition-all", bucket.mae != null ? "bg-muted-foreground/40" : "bg-muted")}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-24 text-right font-mono text-[11px]">
                MAE{" "}
                {bucket.mae != null ? (
                  bucket.mae.toFixed(2)
                ) : (
                  <span className="text-muted-foreground">sem amostra</span>
                )}{" "}
                <span className="text-muted-foreground">({bucket.count})</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ModelErrorBandsPanel({ bands }: { bands: OofBucketBreakdown | null }) {
  const outliers = bands ? findOutliers(bands.overallMae, bands) : []

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">Onde a Nota Prevista erra mais</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          MAE out-of-fold (honesto, sem leakage) por perfil de obra — mostra se o erro é parelho ou
          concentrado em alguma faixa (por tipicidade ou nº de votos). Só sinaliza faixas com ≥{" "}
          {OUTLIER_MIN_N} obras e MAE ≥ média + {OUTLIER_DELTA.toFixed(2)}.
        </p>
      </div>

      {!bands ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Sem amostra suficiente pro out-of-fold — precisa de ≥ 30 obras avaliadas.
        </p>
      ) : (
        <>
          {outliers.length === 0 ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-base font-medium text-emerald-500">Uniforme ✓</p>
              <p className="text-[11px] text-muted-foreground">
                Nenhuma faixa fora do padrão — erro parelho no catálogo.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-base font-medium text-amber-600 dark:text-amber-400">
                {outliers.length} faixa(s) fora do padrão
              </p>
              <div className="mt-0.5 space-y-0.5">
                {outliers.map((o) => (
                  <p key={`${o.group}-${o.label}`} className="text-[11px] text-amber-600 dark:text-amber-400">
                    <span className="font-mono">{o.label}</span> ({o.group}) · +{o.delta.toFixed(2)}
                  </p>
                ))}
              </div>
            </div>
          )}

          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-[11px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronDown className="mr-1 inline h-3 w-3 transition-transform group-open:rotate-180" />
              Ver MAE por faixa (out-of-fold, honesto)
            </summary>
            <div className="mt-3 space-y-3">
              <BucketBars
                title="Por quão típica é a obra (distância ao centróide do treino)"
                buckets={bands.byDistance}
              />
              <BucketBars title="Por número de votos na plataforma" buckets={bands.byVotes} />
            </div>
          </details>
        </>
      )}
    </div>
  )
}
