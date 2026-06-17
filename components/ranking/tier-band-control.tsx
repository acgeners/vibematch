"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { X } from "lucide-react"

/**
 * Controle de TESTE da largura das bandas (tiers) do ranking. Aplica um override
 * temporário via `?band=<valor>` (não persiste — recarregar sem o param volta ao
 * valor salvo em formula_config.tier_band_width). Mesma mecânica de `?mood=`/`?sort=`.
 * Pra fixar o valor de forma permanente, edite `tier_band_width` no banco.
 */
const PRESETS = [0.3, 0.4, 0.5, 0.6, 0.8]

function chipClass(active: boolean): string {
  return `inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors ${
    active
      ? "border-primary/60 bg-primary/15 text-primary"
      : "border-border/70 bg-background/60 hover:border-primary/40 hover:bg-primary/5"
  }`
}

export function TierBandControl({ defaultBand }: { defaultBand: number }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const active = searchParams.get("band")

  const setBand = (band: number | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (band != null) params.set("band", String(band))
    else params.delete("band")
    params.delete("page")
    const qs = params.toString()
    router.push(qs ? `/ranking?${qs}` : "/ranking")
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/55 bg-card/60 px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Largura dos tiers
      </span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setBand(null)}
          className={chipClass(active == null)}
          title={`Usa o valor salvo no banco (tier_band_width = ${defaultBand})`}
        >
          Padrão ({defaultBand.toFixed(2).replace(".", ",")})
        </button>
        {PRESETS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBand(b)}
            className={chipClass(active === String(b))}
            title={`Agrupa no mesmo tier obras a até ${b} de distância na nota`}
          >
            {b.toFixed(1).replace(".", ",")}
          </button>
        ))}
      </div>
      {active != null && (
        <button
          type="button"
          onClick={() => setBand(null)}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Voltar ao padrão"
        >
          <X className="h-3 w-3" />
          Limpar
        </button>
      )}
    </div>
  )
}
