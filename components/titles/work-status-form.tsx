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
import { cn } from "@/lib/utils"
import { BookOpen, Users, Palette, Info, FileEdit, Calendar, Bookmark, Star, X } from "lucide-react"
import {
  Tooltip,
  TooltipProvider,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

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
  { stars: 1, value: 2.0, label: "Fraco", desc: "História confusa, personagens sem graça/irritantes ou visual fraco." },
  { stars: 2, value: 4.0, label: "Mediano", desc: "Premissa aceitável, mas desenvolvimento raso, ritmo irregular ou clichês comuns." },
  { stars: 3, value: 6.5, label: "Bom", desc: "Obra funcional, boa imersão e desenvolvimento satisfatório, mesmo sem ser brilhante." },
  { stars: 4, value: 8.0, label: "Muito bom", desc: "História cativante, personagens marcantes, boa arte/visual e ritmo bem equilibrado." },
  { stars: 5, value: 10.0, label: "Excelente", desc: "Excepcional em todos os aspectos: memorável, extremamente imersivo e original." },
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
  const lastReadAt = useWatch({ control, name: "last_read_at" })
  const postScores = useWatch({
    control,
    name: POST_FIELDS,
  })

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])

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
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4.5 w-4.5 text-muted-foreground" />
          <h3 className="text-base font-bold text-foreground">Progresso de leitura</h3>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1.5 w-full sm:w-[200px]">
            <Label>Status leitura</Label>
            <div className="w-full h-9">
              <Select
                value={personalStatus}
                onValueChange={(v) =>
                  setValue("personal_status", v as WorkStatusValues["personal_status"], {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger className="w-full h-9">
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
          </div>

          <div className="space-y-1.5 w-full sm:w-auto">
            <Label htmlFor="status-chapters-read">Capítulos lidos</Label>
            <div className="flex items-center gap-2 h-9">
              <Input
                id="status-chapters-read"
                type="number"
                min={0}
                className="w-14 h-9 text-center"
                {...register("chapters_read", { setValueAs: optionalNumber })}
              />
              <span className="text-muted-foreground">/</span>
              <div className="flex h-9 w-14 items-center justify-center rounded-md border bg-muted px-2 text-sm text-muted-foreground font-medium">
                {typeof totalChapters === "number" && totalChapters > 0 ? totalChapters : "?"}
              </div>
            </div>
          </div>

          {personalStatus !== "To read" && (
            <div className="space-y-1.5 w-full sm:w-[280px]">
              <Label htmlFor="status-last-read-at">Última leitura</Label>
              <div className="flex items-center gap-1 h-9">
                <Input
                  id="status-last-read-at"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  className="h-9"
                  {...register("last_read_at", {
                    setValueAs: (v) => (v === "" || v == null ? null : v),
                  })}
                />
                {lastReadAt !== todayStr && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="px-2.5 h-8 text-xs font-medium border-dashed hover:border-solid hover:bg-primary/5 hover:text-primary transition-all duration-200"
                    onClick={() =>
                      setValue("last_read_at", todayStr, {
                        shouldDirty: true,
                      })
                    }
                  >
                    Hoje
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-2 h-8 text-xs text-muted-foreground hover:bg-red-500/10 dark:hover:bg-red-500/20 hover:text-red-500 dark:hover:text-red-400 flex items-center gap-1 transition-colors duration-200"
                  onClick={() =>
                    setValue("last_read_at", null, {
                      shouldDirty: true,
                    })
                  }
                >
                  <X className="h-3.5 w-3.5" />
                  Limpar
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {personalStatus !== "To read" && (
        <div className="space-y-4 border-t border-border/40 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Star className="h-4.5 w-4.5 text-muted-foreground fill-muted-foreground/10" />
                <h3 className="text-base font-bold text-foreground">Critérios de avaliação</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {STAR_LEGEND.map((item) => (
                  <TooltipProvider key={item.label}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-muted cursor-help">
                          <span className="text-amber-500">{"★".repeat(item.stars)}</span>
                          <span className="text-foreground">{item.label}</span>
                          <span className="text-muted-foreground/60">({item.value.toFixed(1)})</span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left p-3 shadow-md border bg-popover text-popover-foreground">
                        <p className="font-semibold text-sm text-foreground">
                          {"★".repeat(item.stars)} = {item.value.toFixed(1)} ({item.label})
                        </p>
                        <p className="mt-1 text-xs opacity-90 leading-relaxed text-muted-foreground">
                          {item.desc}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 bg-muted/40 border border-border/60 rounded-xl px-4 py-2.5 shadow-xs shrink-0 self-start sm:self-center">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-tight">
                  Nota Pessoal
                </span>
                <span className="text-[10px] text-muted-foreground/80">Calculada</span>
              </div>
              <ScoreBadge
                score={computedManualScore}
                size="lg"
                className="h-10 w-14 text-lg font-bold shadow-xs shrink-0"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {CRITERION_GROUPS.map((group) => {
              const groupMeta = {
                "Narrativa": { icon: BookOpen, color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/20" },
                "Personagens": { icon: Users, color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20" },
                "Apresentação": { icon: Palette, color: "text-purple-500", bg: "bg-purple-500/10 border-purple-500/20" },
              }[group.title] || { icon: BookOpen, color: "text-muted-foreground", bg: "bg-muted" }
              const Icon = groupMeta.icon

              return (
                <div
                  key={group.title}
                  className="rounded-xl border bg-card/45 p-4 shadow-sm space-y-4 hover:border-muted-foreground/20 transition-all duration-300"
                >
                  <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                    <div className={cn("p-1.5 rounded-lg border", groupMeta.bg)}>
                      <Icon className={cn("h-4 w-4", groupMeta.color)} />
                    </div>
                    <h4 className="text-sm font-bold uppercase tracking-wider text-card-foreground">
                      {group.title}
                    </h4>
                  </div>
                  <div className="space-y-4">
                    {group.fields.map((field) => {
                      const valueIndex = POST_FIELDS.indexOf(field)
                      const currentValue = postScores[valueIndex]
                      return (
                        <div key={field} className="min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <Label
                              htmlFor={`status-${field}`}
                              className="text-xs font-medium text-foreground cursor-pointer block truncate"
                            >
                              {POST_READING_WEIGHT_LABELS[field]}
                            </Label>
                            {currentValue != null && (
                              <span className="text-[10px] font-mono font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded leading-none">
                                {currentValue.toFixed(1)}
                              </span>
                            )}
                          </div>
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
              )
            })}
          </div>
        </div>
      )}

      <div className="space-y-4 border-t border-border/40 pt-6">
        <div className="flex items-center gap-2">
          <FileEdit className="h-4.5 w-4.5 text-muted-foreground" />
          <h3 className="text-base font-bold text-foreground">Anotações pessoais</h3>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="space-y-1.5 w-full sm:w-[220px]">
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
              <SelectTrigger id="personal-synopsis-quality" className="w-full h-9">
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

          <div className="space-y-1.5 w-full sm:w-[120px]">
            <Label
              htmlFor="personal-adjustment"
              title="negativo = penalidade · positivo = bônus · em pontos de nota"
              className="block truncate"
            >
              Ajuste
            </Label>
            <Input
              id="personal-adjustment"
              type="number"
              step={0.05}
              min={-0.30}
              max={0.30}
              className="text-center h-9"
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
