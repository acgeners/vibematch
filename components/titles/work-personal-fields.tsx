"use client"

import { useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { updateWorkStatus } from "@/server/actions/works"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"

interface WorkPersonalFieldsProps {
  workId: string
  initialValues: WorkStatusValues
}

export function WorkPersonalFields({ workId, initialValues }: WorkPersonalFieldsProps) {
  const refresh = useRefresh()
  const [synopsisQuality, setSynopsisQuality] = useState<WorkStatusValues["synopsis_quality"]>(
    initialValues.synopsis_quality ?? null
  )
  const [adjustment, setAdjustment] = useState<string>(
    String(initialValues.observation_adjustment ?? 0)
  )
  const [observations, setObservations] = useState<string>(initialValues.observations ?? "")
  const [saving, setSaving] = useState(false)

  const initialAdjustment = initialValues.observation_adjustment ?? 0
  const initialObservations = initialValues.observations ?? ""
  const initialSynopsisQuality = initialValues.synopsis_quality ?? null

  const parsedAdjustment = (() => {
    if (adjustment === "" || adjustment == null) return 0
    const n = Number(adjustment)
    return Number.isFinite(n) ? n : 0
  })()

  const dirty =
    synopsisQuality !== initialSynopsisQuality ||
    parsedAdjustment !== initialAdjustment ||
    observations !== initialObservations

  const handleSave = async () => {
    setSaving(true)
    const payload: WorkStatusValues = {
      ...initialValues,
      synopsis_quality: synopsisQuality,
      observation_adjustment: parsedAdjustment,
      observations: observations.trim() === "" ? null : observations,
    }
    const result = await updateWorkStatus(workId, payload)
    setSaving(false)

    if ("error" in result && result.error) {
      const firstError = Object.values(result.error).flat()[0] ?? "Erro ao salvar"
      toast.error(typeof firstError === "string" ? firstError : "Erro ao salvar")
      return
    }
    toast.success("Atualizado.")
    refresh()
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Anotações pessoais</h2>
        <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,140px)]">
        <div className="space-y-1.5">
          <Label htmlFor="personal-synopsis-quality">Interesse sinopse</Label>
          <Select
            value={synopsisQuality ?? "none"}
            onValueChange={(v) =>
              setSynopsisQuality(
                v === "none" ? null : (v as WorkStatusValues["synopsis_quality"])
              )
            }
          >
            <SelectTrigger id="personal-synopsis-quality" className="w-full">
              <SelectValue placeholder="Não avaliada" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Não avaliada</SelectItem>
              {SYNOPSIS_QUALITIES.map((q) => (
                <SelectItem key={q} value={q}>
                  {q} — {SYNOPSIS_QUALITY_LABELS[q]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="personal-adjustment" title="negativo = penalidade · positivo = bônus · em pontos de nota">
            Ajuste
          </Label>
          <Input
            id="personal-adjustment"
            type="number"
            step={0.05}
            min={-0.30}
            max={0.30}
            value={adjustment}
            onChange={(e) => setAdjustment(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="personal-observations">Observações</Label>
        <Textarea
          id="personal-observations"
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          placeholder="Notas pessoais sobre a obra..."
          rows={3}
          className="resize-none"
        />
      </div>
    </div>
  )
}
