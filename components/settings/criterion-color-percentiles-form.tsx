"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { RotateCcw } from "lucide-react"
import { updateCriterionColorPcts } from "@/server/actions/settings"
import type { FormulaConfig } from "@/types/domain"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface CriterionColorPercentilesFormProps {
  config: FormulaConfig
}

type Pcts = { top: number; high: number; mid: number; low: number }

const ROWS: Array<{ key: keyof Pcts; label: string; hint: string; swatch: string }> = [
  { key: "top", label: "Topo (verde)", hint: "Notas acima desse percentil ficam verdes.", swatch: "bg-emerald-500" },
  { key: "high", label: "Alto (verde-claro)", hint: "Entre esse percentil e o de topo.", swatch: "bg-green-500" },
  { key: "mid", label: "Médio (amarelo)", hint: "Entre esse percentil e o de alto.", swatch: "bg-yellow-500" },
  { key: "low", label: "Baixo (laranja)", hint: "Entre esse percentil e o médio. Abaixo, vermelho.", swatch: "bg-orange-500" },
]

const NEGATIVE_CRITERIA = new Set<string>(["drama", "tragedy"])

export function CriterionColorPercentilesForm({ config }: CriterionColorPercentilesFormProps) {
  const globalPcts: Pcts = {
    top: Number(config.score_color_pct_top),
    high: Number(config.score_color_pct_high),
    mid: Number(config.score_color_pct_mid),
    low: Number(config.score_color_pct_low),
  }
  const overrides = (config.criterion_color_pcts ?? {}) as Record<string, Pcts>

  const [slug, setSlug] = useState<CriterionSlug>(CRITERION_SLUGS[0] as CriterionSlug)
  const [pcts, setPcts] = useState<Pcts>(overrides[CRITERION_SLUGS[0]] ?? globalPcts)
  const [saving, setSaving] = useState(false)

  const hasOverride = useMemo(() => slug in overrides, [slug, overrides])

  const selectSlug = (next: CriterionSlug) => {
    setSlug(next)
    setPcts(overrides[next] ?? globalPcts)
  }

  const setValue = (key: keyof Pcts, v: number) => setPcts((p) => ({ ...p, [key]: v }))

  const save = async () => {
    if (!(pcts.low < pcts.mid && pcts.mid < pcts.high && pcts.high < pcts.top)) {
      toast.error("Os percentis devem ser crescentes: baixo < médio < alto < topo.")
      return
    }
    setSaving(true)
    const result = await updateCriterionColorPcts(slug, pcts)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    // O server action revalida /conta/preferencias, então `config` (e o `overrides`
    // derivado) é refrescado pelo Next — não mutar o objeto vindo das props.
    toast.success(`Percentis de "${CRITERIA_INFO[slug]?.name ?? slug}" salvos.`)
  }

  const useGlobal = async () => {
    setSaving(true)
    const result = await updateCriterionColorPcts(slug, null)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    // Revalidação do server action refresca `config`/`overrides`; só ajustamos
    // o estado local dos sliders pra refletir os percentis globais na hora.
    setPcts(globalPcts)
    toast.success("Voltou a usar os percentis globais para esse atributo.")
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Opcional. Por padrão, cada atributo é colorido pelos <strong>percentis globais</strong> acima,
        mas calculado sobre a distribuição daquele atributo no catálogo. Aqui você pode sobrescrever os
        cortes de UM atributo. Em <strong>drama</strong> e <strong>tragédia</strong> a escala é
        invertida (nota baixa = bom).
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Atributo</label>
          <Select value={slug} onValueChange={(v) => selectSlug(v as CriterionSlug)}>
            <SelectTrigger className="h-9 w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CRITERION_SLUGS.map((s) => (
                <SelectItem key={s} value={s}>
                  {CRITERIA_INFO[s]?.emoji} {CRITERIA_INFO[s]?.name ?? s}
                  {NEGATIVE_CRITERIA.has(s) ? " (invertido)" : ""}
                  {s in overrides ? " •" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="pb-2 text-xs text-muted-foreground">
          {hasOverride ? "Usando override próprio" : "Usando percentis globais"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ROWS.map((row) => (
          <div key={row.key} className="rounded-lg border border-border/65 bg-background/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`size-3.5 rounded-sm ${row.swatch}`} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{row.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{row.hint}</p>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                p{Math.round(pcts[row.key])}
              </span>
            </div>
            <Slider
              value={[pcts[row.key]]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => setValue(row.key, v[0])}
              className="px-1"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar para este atributo"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={useGlobal} disabled={saving || !hasOverride}>
          <RotateCcw className="h-3.5 w-3.5" />
          Usar percentis globais
        </Button>
      </div>
    </div>
  )
}
