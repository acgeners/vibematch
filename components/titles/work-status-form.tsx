"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch, type FieldErrors } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScoreBadge } from "@/components/ui/score-badge"
import { StarRating } from "@/components/ui/star-rating"
import { Textarea } from "@/components/ui/textarea"
import { workStatusSchema } from "@/lib/validations/work.schema"
import type { WorkStatusInput, WorkStatusValues } from "@/lib/validations/work.schema"
import { updateWorkStatus } from "@/server/actions/works"
import { PERSONAL_STATUSES, SYNOPSIS_QUALITIES } from "@/types/domain"
import { PERSONAL_STATUS_LABELS, SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import {
  DEFAULT_POST_READING_WEIGHTS,
  POST_READING_STAR_HINTS,
  POST_READING_WEIGHT_LABELS,
  POST_READING_WEIGHT_STORAGE_KEY,
  normalizePostReadingScore,
  scoreToPostReadingStars,
  starsToPostReadingScore,
  type PostReadingScoreField,
} from "@/lib/constants/post-reading-criteria"

const POST_FIELDS: PostReadingScoreField[] = [
  "post_story_score",
  "post_fl_score",
  "post_ml_score",
  "post_character_development_score",
  "post_pacing_score",
  "post_art_visual_score",
  "post_impact_immersion_score",
  "post_originality_score",
]

const STAR_LEGEND = [
  { stars: "★", label: "Fraco" },
  { stars: "★★", label: "Mediano" },
  { stars: "★★★", label: "Bom" },
  { stars: "★★★★", label: "Muito bom" },
  { stars: "★★★★★", label: "Excelente" },
]

const CRITERION_GROUPS: Array<{ title: string; fields: PostReadingScoreField[] }> = [
  { title: "Narrativa", fields: ["post_story_score", "post_pacing_score", "post_originality_score"] },
  { title: "Personagens", fields: ["post_fl_score", "post_ml_score", "post_character_development_score"] },
  { title: "Apresentação", fields: ["post_art_visual_score", "post_impact_immersion_score"] },
]

function readPostReadingWeights(): Record<PostReadingScoreField, number> {
  if (typeof window === "undefined") return { ...DEFAULT_POST_READING_WEIGHTS }
  const stored = window.localStorage.getItem(POST_READING_WEIGHT_STORAGE_KEY)
  if (!stored) return { ...DEFAULT_POST_READING_WEIGHTS }
  try {
    const parsed = JSON.parse(stored) as Partial<Record<PostReadingScoreField, number>>
    return {
      ...DEFAULT_POST_READING_WEIGHTS,
      ...Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "number" && Number.isFinite(v))
      ),
    }
  } catch {
    return { ...DEFAULT_POST_READING_WEIGHTS }
  }
}

const optionalNumber = (value: unknown) => {
  if (value === "" || value == null) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export interface WorkStatusFormProps {
  workId: string
  totalChapters: number | null
  initialValues: WorkStatusValues
  /** Chamado após salvar com sucesso (ex: fechar dialog). */
  onSaved?: () => void
  /** Quando true, oculta a linha de Cancelar/Salvar para que o parent renderize seus próprios botões. */
  hideFooter?: boolean
  /** Chamado quando usuário clica Cancelar (só usado quando hideFooter=false). */
  onCancel?: () => void
}

export function WorkStatusForm({
  workId,
  totalChapters,
  initialValues,
  onSaved,
  hideFooter = false,
  onCancel,
}: WorkStatusFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
  } = useForm<WorkStatusInput, unknown, WorkStatusValues>({
    resolver: zodResolver(workStatusSchema),
    defaultValues: initialValues,
  })

  useEffect(() => {
    reset(initialValues)
  }, [initialValues, reset])

  const personalStatus = useWatch({ control, name: "personal_status" })
  const chaptersRead = useWatch({ control, name: "chapters_read" })
  const synopsisQuality = useWatch({ control, name: "synopsis_quality" })
  const postScores = useWatch({
    control,
    name: POST_FIELDS,
  })

  const [postWeights] = useState<Record<PostReadingScoreField, number>>(readPostReadingWeights)

  useEffect(() => {
    if (personalStatus !== "Completed") return
    if (typeof totalChapters !== "number" || totalChapters <= 0) return
    if (chaptersRead != null && chaptersRead >= totalChapters) return
    setValue("chapters_read", totalChapters, { shouldDirty: true, shouldValidate: true })
  }, [personalStatus, totalChapters, chaptersRead, setValue])

  const computedManualScore = useMemo(() => {
    let scoreSum = 0
    let weightSum = 0
    POST_FIELDS.forEach((field, index) => {
      const normalized = normalizePostReadingScore(postScores[index])
      if (normalized == null) return
      const weight = postWeights[field]
      scoreSum += normalized * weight
      weightSum += weight
    })
    return weightSum > 0 ? Math.round((scoreSum / weightSum) * 10) / 10 : null
  }, [postScores, postWeights])

  useEffect(() => {
    setValue("manual_score", computedManualScore, { shouldDirty: true })
  }, [computedManualScore, setValue])

  const onSubmit = async (raw: WorkStatusValues) => {
    setSaving(true)
    const normalized: WorkStatusValues = { ...raw }
    for (const field of POST_FIELDS) {
      normalized[field] = normalizePostReadingScore(normalized[field])
    }
    const result = await updateWorkStatus(workId, normalized)
    setSaving(false)

    if ("error" in result && result.error) {
      const firstError = Object.values(result.error).flat()[0] ?? "Erro ao salvar status"
      toast.error(typeof firstError === "string" ? firstError : "Erro ao salvar status")
      return
    }
    toast.success("Status atualizado.")
    onSaved?.()
    router.refresh()
  }

  const onInvalid = (formErrors: FieldErrors<WorkStatusInput>) => {
    const firstField = Object.keys(formErrors)[0]
    const firstMessage = firstField
      ? (formErrors[firstField as keyof typeof formErrors] as { message?: string } | undefined)?.message
      : undefined
    console.warn("[WorkStatusForm] validação falhou:", formErrors)
    toast.error(firstMessage ?? `Corrija o campo "${firstField ?? "desconhecido"}" antes de salvar.`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,180px)_minmax(0,260px)]">
        <div className="space-y-1.5">
          <Label>Status leitura</Label>
          <Select
            value={personalStatus}
            onValueChange={(v) =>
              setValue("personal_status", v as WorkStatusValues["personal_status"], {
                shouldDirty: true,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERSONAL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {PERSONAL_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="status-chapters-read">Capítulos lidos</Label>
          <div className="flex items-center gap-2">
            <Input
              id="status-chapters-read"
              type="number"
              min={0}
              {...register("chapters_read", { setValueAs: optionalNumber })}
            />
            <span className="text-muted-foreground">/</span>
            <div className="flex h-9 min-w-12 items-center justify-center rounded-md border bg-muted px-2 text-sm text-muted-foreground">
              {typeof totalChapters === "number" && totalChapters > 0 ? totalChapters : "?"}
            </div>
          </div>
        </div>

        {personalStatus !== "To read" && (
          <div className="space-y-1.5">
            <Label htmlFor="status-last-read-at">Última leitura</Label>
            <div className="flex items-center gap-1">
              <Input
                id="status-last-read-at"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                {...register("last_read_at", {
                  setValueAs: (v) => (v === "" || v == null ? null : v),
                })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() =>
                  setValue("last_read_at", new Date().toISOString().slice(0, 10), {
                    shouldDirty: true,
                  })
                }
              >
                Hoje
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() =>
                  setValue("last_read_at", null, {
                    shouldDirty: true,
                  })
                }
              >
                Limpar
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Critérios de avaliação</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {STAR_LEGEND.map((item) => (
                <span key={item.label} className="whitespace-nowrap">
                  <span className="text-amber-500">{item.stars}</span>{" "}
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Minha nota (calculada)
            </span>
            <ScoreBadge score={computedManualScore} size="md" />
          </div>
        </div>

        <div className="space-y-5">
          {CRITERION_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h4>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.fields.map((field) => {
                  const valueIndex = POST_FIELDS.indexOf(field)
                  const currentValue = postScores[valueIndex]
                  return (
                    <div key={field} className="min-w-0 space-y-1.5">
                      <Label htmlFor={`status-${field}`} className="block truncate">
                        {POST_READING_WEIGHT_LABELS[field]}
                      </Label>
                      <StarRating
                        id={`status-${field}`}
                        value={currentValue}
                        valueForStars={starsToPostReadingScore}
                        starsForValue={scoreToPostReadingStars}
                        showValue={false}
                        size="sm"
                        starDescriptions={POST_READING_STAR_HINTS[field]}
                        onChange={(value) =>
                          setValue(field, value, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t pt-5">
        <h3 className="text-sm font-semibold">Anotações pessoais</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="personal-synopsis-quality">Interesse sinopse</Label>
            <Select
              value={synopsisQuality ?? "none"}
              onValueChange={(v) =>
                setValue(
                  "synopsis_quality",
                  v === "none" ? null : (v as WorkStatusValues["synopsis_quality"]),
                  { shouldDirty: true }
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
            <Label
              htmlFor="personal-adjustment"
              title="negativo = penalidade · positivo = bônus · em pontos de nota"
            >
              Ajuste
            </Label>
            <Input
              id="personal-adjustment"
              type="number"
              step={0.05}
              min={-0.30}
              max={0.30}
              {...register("observation_adjustment", { valueAsNumber: true })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="personal-observations">Observações</Label>
          <Textarea
            id="personal-observations"
            placeholder="Notas pessoais sobre a obra..."
            rows={3}
            className="resize-none"
            {...register("observations", {
              setValueAs: (v) => (typeof v === "string" && v.trim() === "" ? null : v),
            })}
          />
        </div>
      </div>

      {!hideFooter && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      )}
    </form>
  )
}
