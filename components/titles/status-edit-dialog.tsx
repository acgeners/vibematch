"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { StarRating } from "@/components/ui/star-rating"
import { workStatusSchema } from "@/lib/validations/work.schema"
import type { WorkStatusInput, WorkStatusValues } from "@/lib/validations/work.schema"
import { updateWorkStatus } from "@/server/actions/works"
import { PERSONAL_STATUSES } from "@/types/domain"
import { PERSONAL_STATUS_LABELS } from "@/lib/constants/criteria"
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
  { stars: "★", label: "Fraco / prejudica a obra" },
  { stars: "★★", label: "Mediano baixo / aceitável" },
  { stars: "★★★", label: "Bom / cumpre bem" },
  { stars: "★★★★", label: "Muito bom / acima da média" },
  { stars: "★★★★★", label: "Excelente / ponto forte da obra" },
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

export interface StatusEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workId: string
  totalChapters: number | null
  initialValues: WorkStatusValues
}

export function StatusEditDialog({
  open,
  onOpenChange,
  workId,
  totalChapters,
  initialValues,
}: StatusEditDialogProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { errors },
  } = useForm<WorkStatusInput, unknown, WorkStatusValues>({
    resolver: zodResolver(workStatusSchema),
    defaultValues: initialValues,
  })

  useEffect(() => {
    reset(initialValues)
  }, [initialValues, reset])

  const personalStatus = useWatch({ control, name: "personal_status" })
  const chaptersRead = useWatch({ control, name: "chapters_read" })
  const postScores = useWatch({
    control,
    name: POST_FIELDS,
  })

  const [postWeights] = useState<Record<PostReadingScoreField, number>>(readPostReadingWeights)

  // Auto-fill chapters_read = total_chapters when status becomes Completed.
  useEffect(() => {
    if (personalStatus !== "Completed") return
    if (typeof totalChapters !== "number" || totalChapters <= 0) return
    if (chaptersRead != null && chaptersRead >= totalChapters) return
    setValue("chapters_read", totalChapters, { shouldDirty: true, shouldValidate: true })
  }, [personalStatus, totalChapters, chaptersRead, setValue])

  // Re-compute manual_score (média ponderada das estrelas) sempre que mudar.
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
    onOpenChange(false)
    router.refresh()
  }

  const onInvalid = (formErrors: typeof errors) => {
    const firstField = Object.keys(formErrors)[0]
    const firstMessage = firstField
      ? (formErrors[firstField as keyof typeof formErrors] as { message?: string } | undefined)?.message
      : undefined
    console.warn("[StatusEditDialog] validação falhou:", formErrors)
    toast.error(firstMessage ?? `Corrija o campo "${firstField ?? "desconhecido"}" antes de salvar.`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Status</DialogTitle>
          <DialogDescription>
            Atualize apenas as informações de status sem abrir o formulário completo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)_minmax(0,160px)]">
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
                <div className="flex h-9 min-w-16 items-center justify-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                  {typeof totalChapters === "number" && totalChapters > 0 ? totalChapters : "?"}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="status-manual-score">Minha nota</Label>
              <Input
                id="status-manual-score"
                type="number"
                step={0.1}
                min={0}
                max={10}
                readOnly
                placeholder="—"
                className="bg-primary/5 text-base font-semibold"
                {...register("manual_score", { setValueAs: optionalNumber })}
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Critérios de avaliação</h3>
            <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-5">
              {STAR_LEGEND.map((item) => (
                <div key={item.label} className="rounded-md bg-background/80 px-3 py-2">
                  <span className="block whitespace-nowrap text-amber-500">{item.stars}</span>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {POST_FIELDS.map((field, index) => {
                const currentValue = postScores[index]
                const selectedStars = scoreToPostReadingStars(currentValue)
                const hint =
                  selectedStars == null ? null : POST_READING_STAR_HINTS[field][selectedStars - 1]
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
                    {hint && (
                      <p className="text-xs leading-snug text-muted-foreground whitespace-pre-line">
                        {hint}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
