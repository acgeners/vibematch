"use client"

import { Coins, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatEta, shortModelName } from "@/lib/cost-preview/catalog"
import { makeUsdScale } from "@/lib/format/money"
import type { UsdScale } from "@/lib/format/money"
import type { CostPreview } from "@/lib/cost-preview/catalog"

/** Um passo de cascata itemizado (ex.: as sub-ações de "Salvar obra"). */
export interface CostStep {
  label: string
  model: string
  likelyUsd: number
  etaSeconds: number
}

/**
 * Bloco presentacional de custo + tempo. Reusado no popup de confirmação
 * (`CostConfirmDialog`) e injetável em diálogos que já existem (recomendação,
 * deep dive) pra mostrar a estimativa sem um segundo modal.
 */
export function CostSummary({
  preview,
  steps,
  scale,
  className,
}: {
  preview: CostPreview
  steps?: CostStep[]
  /**
   * Régua de USD da tela que embute este bloco. Obrigatória quando essa tela
   * mostra outro valor (o botão do `CostConfirmDialog`) — ver o comentário no
   * corpo. Omitida, o bloco deriva a própria a partir do que ele mesmo exibe.
   */
  scale?: UsdScale
  className?: string
}) {
  // "N × por-obra" só é honesto quando NÃO há passos itemizados. Com `steps` (ex.:
  // perfil + previsões), a divisão ingênua amortizaria o custo ÚNICO do perfil em
  // cada obra — então cai pro "teto $X" e deixa o detalhe pros passos abaixo.
  const hasSteps = (steps?.length ?? 0) > 0
  const isBatch = preview.scale > 1 && !hasSteps
  const perItem = isBatch ? preview.likelyUsd / preview.scale : null
  // Régua do bloco: o número grande, o teto logo abaixo e os passos da cascata são
  // lidos juntos. Formatados um a um, "~8,15¢" aparecia ao lado de "teto $0,12".
  //
  // ⚠️ Quem embute este bloco numa tela que TAMBÉM mostra dinheiro (o botão do
  // `CostConfirmDialog`) precisa passar a régua de lá — derivar duas do mesmo
  // `preview` não basta, porque cada lado conhece valores que o outro não vê.
  const usd = scale ?? makeUsdScale(
    preview.likelyUsd,
    preview.upperBoundUsd,
    perItem,
    ...(steps ?? []).map((s) => s.likelyUsd),
  )

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-0.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            <Coins className="h-3 w-3" /> Custo estimado
          </span>
          <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
            {usd.approx(preview.likelyUsd)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {isBatch
              ? `${preview.scale} × ${usd.approx(perItem ?? 0)}`
              : `teto ${usd.format(preview.upperBoundUsd)}`}
          </span>
        </div>

        <div className="flex flex-col gap-0.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            <Clock className="h-3 w-3" /> Tempo estimado
          </span>
          <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
            {formatEta(preview.etaSeconds)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {preview.background ? "roda em 2º plano" : "aguarde na tela"}
          </span>
        </div>
      </div>

      {steps && steps.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Detalhe da cascata
          </p>
          <ul className="space-y-1">
            {steps.map((s, i) => (
              <li
                key={`${s.label}-${i}`}
                className="flex items-center gap-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
                <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] font-semibold uppercase text-muted-foreground">
                  {shortModelName(s.model)}
                </span>
                <span className="w-14 shrink-0 text-right font-mono tabular-nums text-amber-700 dark:text-amber-300">
                  {usd.approx(s.likelyUsd)}
                </span>
                <span className="w-10 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                  {formatEta(s.etaSeconds)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.note && (
        <p className="text-[11px] leading-snug text-muted-foreground">{preview.note}</p>
      )}
    </div>
  )
}
