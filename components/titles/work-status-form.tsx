"use client"

import { useEffect, useMemo, useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
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
import { PERSONAL_STATUS_LABELS, PERSONAL_STATUSES_BY_ID, SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import {
  DEFAULT_POST_READING_WEIGHTS,
  POST_READING_CRITERIA_DESCRIPTIONS,
  POST_READING_STAR_HINTS,
  POST_READING_STAR_LEGEND,
  POST_READING_WEIGHT_LABELS,
  POST_READING_WEIGHT_STORAGE_KEY,
  SYNOPSIS_INTEREST_LEGEND,
  normalizePostReadingScore,
  scoreToPostReadingStars,
  starsToPostReadingScore,
  type PostReadingScoreField,
} from "@/lib/constants/post-reading-criteria"
import { cn, readingProgressPercent } from "@/lib/utils"
import { BookOpen, Users, Palette, FileEdit, Bookmark, ChevronDown, Star, X } from "lucide-react"
import { isFullyReadPersonalStatus } from "@/lib/constants/status-lookups"
import {
  Tooltip,
  TooltipProvider,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const SYNOPSIS_LEGEND_BY_LABEL = new Map(
  SYNOPSIS_INTEREST_LEGEND.map((entry) => [entry.label, entry] as const),
)

// Descrição de cada status de leitura — vem da tabela `personal_status`
// (campo `comment`, sincronizado em PERSONAL_STATUSES_BY_ID via sync-constants).
const PERSONAL_STATUS_COMMENTS = new Map<string, string>(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info.comment] as const),
)

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

export const hasChanges = (initial: WorkStatusValues, current: Partial<WorkStatusValues>): boolean => {
  const fields: Array<keyof WorkStatusValues> = [
    "personal_status",
    "personal_status_id",
    "synopsis_quality",
    "observation_adjustment",
    "observations",
    "chapters_read",
    "last_read_at",
    "user_score",
    "post_story_score",
    "post_fl_score",
    "post_ml_score",
    "post_character_development_score",
    "post_pacing_score",
    "post_art_visual_score",
    "post_impact_immersion_score",
    "post_originality_score",
  ]

  for (const field of fields) {
    const rawInit = initial[field]
    const rawCurr = current[field] === undefined ? initial[field] : current[field]

    // Normalize empty strings, null, undefined to a single "empty" state
    const isInitEmpty = rawInit === null || rawInit === undefined || rawInit === ""
    const isCurrEmpty = rawCurr === null || rawCurr === undefined || rawCurr === ""

    if (isInitEmpty && isCurrEmpty) {
      continue
    }

    if (isInitEmpty !== isCurrEmpty) {
      return true
    }

    if (typeof rawInit === "number" || typeof rawCurr === "number") {
      const numInit = Number(rawInit)
      const numCurr = Number(rawCurr)
      if (numInit !== numCurr) {
        return true
      }
    } else {
      const cleanInit = String(rawInit).replace(/\r\n/g, "\n").trim()
      const cleanCurr = String(rawCurr).replace(/\r\n/g, "\n").trim()
      if (cleanInit !== cleanCurr) {
        return true
      }
    }
  }

  return false
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
  /** Chamado sempre que o status pessoal selecionado muda (mesmo antes de salvar).
   *  Permite ao parent revelar a seção de atributos pós-leitura na hora, sem reload. */
  onStatusChange?: (status: WorkStatusValues["personal_status"]) => void
  /** Chamado sempre que chapters_read muda — revela atributos pós-leitura por % lido. */
  onChaptersReadChange?: (chaptersRead: number | null) => void
  /** Salvamento adicional encadeado no mesmo submit (ex.: atributos pós-leitura).
   *  Roda após updateWorkStatus ter sucesso; se falhar, status já foi salvo (falha parcial). */
  extraSave?: () => Promise<{ ok: boolean; error?: string } | null | void>
  /** Considera o form "sujo" mesmo sem mudança nos campos de status (ex.: atributos mudaram). */
  extraDirty?: boolean
  /** Gate de exibição da seção "Critérios de avaliação". Quando omitido, usa a regra
   *  antiga (status != "Want to Read"). O PostReadingFlow passa a MESMA regra dos atributos
   *  pós-leitura (status terminal OU > 20% lido) pra alinhar as duas seções. */
  showEvaluationCriteria?: boolean
  /** Estado inicial (aberto/fechado) da seção de critérios craft. Default aberto;
   *  o PostReadingFlow passa `false` pra colapsar o craft por padrão (avaliação por
   *  gosto virou a primária). */
  criteriaDefaultOpen?: boolean
  /** Rótulo do botão de submit (default "Salvar"). */
  submitLabel?: string
  /** Quando definido, o `<form>` recebe esse id e o footer interno é omitido —
   *  o parent renderiza o botão "Salvar" com `form={formId}` onde quiser (ex.:
   *  no fim de tudo, depois dos atributos pós-leitura). Use junto de onStateChange. */
  formId?: string
  /** Recebe o estado de submit (saving + canSubmit) sempre que muda — pro parent
   *  controlar o botão externo de Salvar. */
  onStateChange?: (state: { saving: boolean; canSubmit: boolean }) => void
}

export function WorkStatusForm({
  workId,
  totalChapters,
  initialValues,
  onSaved,
  hideFooter = false,
  onCancel,
  onStatusChange,
  onChaptersReadChange,
  extraSave,
  extraDirty = false,
  showEvaluationCriteria,
  criteriaDefaultOpen,
  submitLabel,
  formId,
  onStateChange,
}: WorkStatusFormProps) {
  const refresh = useRefresh()
  const [saving, setSaving] = useState(false)
  const [notesOpen, setNotesOpen] = useState(true)
  const [criteriaOpen, setCriteriaOpen] = useState(criteriaDefaultOpen ?? true)
  const [hoveredSynopsis, setHoveredSynopsis] = useState<string | null>(null)
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null)

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
  const currentManualScore = useWatch({ control, name: "user_score" })
  const currentValues = useWatch({ control })

  const isDirty = useMemo(() => {
    if (!currentValues) return false
    return hasChanges(initialValues, currentValues as WorkStatusValues)
  }, [initialValues, currentValues])

  const canSubmit = (isDirty || extraDirty) && !saving

  // Reporta o estado do submit pro parent (que pode renderizar o botão Salvar fora
  // do form, via form={formId}). Roda só quando o estado realmente muda.
  useEffect(() => {
    onStateChange?.({ saving, canSubmit })
  }, [saving, canSubmit, onStateChange])

  // Gate da seção "Critérios de avaliação": usa a regra passada pelo parent
  // (mesma dos atributos pós-leitura) ou cai na regra antiga (status != "Want to Read").
  // Fatia 2a: a nota e a pós-leitura deixaram de ser do Curador — são de quem está logado, e
  // vão pra `user_work_state`. Voltou a valer a regra original, sem gate de papel.
  const criteriaVisible = showEvaluationCriteria ?? personalStatus !== "Want to Read"

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const [postWeights] = useState<Record<PostReadingScoreField, number>>(readPostReadingWeights)

  // Avisa o parent da mudança de status na hora (antes de salvar) pra revelar
  // a seção de atributos pós-leitura sem depender de reload.
  useEffect(() => {
    if (personalStatus) onStatusChange?.(personalStatus)
  }, [personalStatus, onStatusChange])

  useEffect(() => {
    onChaptersReadChange?.(chaptersRead ?? null)
  }, [chaptersRead, onChaptersReadChange])

  useEffect(() => {
    if (!isFullyReadPersonalStatus(personalStatus)) return
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
    return weightSum > 0
      ? Math.round((scoreSum / weightSum) * 10) / 10
      : initialValues.user_score
  }, [postScores, postWeights, initialValues.user_score])

  useEffect(() => {
    if (computedManualScore !== currentManualScore) {
      setValue("user_score", computedManualScore, { shouldDirty: true })
    }
  }, [computedManualScore, currentManualScore, setValue])

  const onSubmit = async (raw: WorkStatusValues) => {
    setSaving(true)
    const normalized: WorkStatusValues = { ...raw }
    for (const field of POST_FIELDS) {
      normalized[field] = normalizePostReadingScore(normalized[field])
    }

    const result = await updateWorkStatus(workId, normalized)

    if ("error" in result && result.error) {
      setSaving(false)
      const firstError = Object.values(result.error).flat()[0] ?? "Erro ao salvar status"
      toast.error(typeof firstError === "string" ? firstError : "Erro ao salvar status")
      return
    }

    // Salvamento encadeado (ex.: atributos pós-leitura). Status já foi salvo;
    // se o extra falhar, avisa mas não reverte (falha parcial).
    let extraOk = true
    if (extraSave) {
      const r = await extraSave()
      if (r && "ok" in r && !r.ok) {
        extraOk = false
        toast.error(r.error ?? "Falha ao salvar a avaliação de atributos.")
      }
    }
    setSaving(false)

    if (extraOk) toast.success(extraSave ? "Tudo salvo." : "Status atualizado.")
    onSaved?.()
    refresh()
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
    <form id={formId} onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">
      {/* Anotações pessoais (interesse ♥, ajuste, observações) — colapsável, acima do
          progresso. Fatia 2a: são de QUEM ESTÁ LOGADO (vão pra `user_work_state`), não mais do
          Curador. O ajuste de observação só mexe no scoring de quem tem modelo — hoje, o dono. */}
      <div className="rounded-lg border border-border/40">
        <button
          type="button"
          onClick={() => setNotesOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            <FileEdit className="h-4.5 w-4.5 text-muted-foreground" />
            <span className="text-base font-bold text-foreground">Anotações pessoais</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", notesOpen && "rotate-180")} />
        </button>
        {notesOpen && (
          <div className="space-y-4 border-t border-border/40 px-4 pb-4 pt-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
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
                  <SelectContent onMouseLeave={() => setHoveredSynopsis(null)} className="w-[300px]">
                    <SelectItem
                      value="none"
                      onMouseEnter={() => setHoveredSynopsis("none")}
                      onFocus={() => setHoveredSynopsis("none")}
                    >
                      Não avaliada
                    </SelectItem>
                    {SYNOPSIS_QUALITIES.map((q) => (
                      <SelectItem
                        key={q}
                        value={q}
                        onMouseEnter={() => setHoveredSynopsis(q)}
                        onFocus={() => setHoveredSynopsis(q)}
                      >
                        {q} — {SYNOPSIS_QUALITY_LABELS[q]}
                      </SelectItem>
                    ))}
                    {(() => {
                      // Painel de detalhe: mostra a descrição do item sob o mouse
                      // (ou, sem hover, do valor já selecionado). Fonte: tooltips/synopsis.
                      const activeQ = hoveredSynopsis ?? synopsisQuality ?? null
                      const label = activeQ ? SYNOPSIS_QUALITY_LABELS[activeQ] : undefined
                      const entry = label ? SYNOPSIS_LEGEND_BY_LABEL.get(label) : null
                      if (!entry) return null
                      return (
                        <div className="mt-1 border-t border-border/60 px-2 pb-1 pt-2">
                          <p className="text-xs font-semibold text-foreground">
                            <span className="text-rose-400">{entry.glyph}</span> {entry.label}
                          </p>
                          <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground">
                            {entry.description}
                          </p>
                        </div>
                      )
                    })()}
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
        )}
      </div>

      <div className="space-y-4 border-t border-border/40 pt-6">
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
                <SelectContent onMouseLeave={() => setHoveredStatus(null)} className="w-[300px]">
                  {PERSONAL_STATUSES.map((s) => (
                    <SelectItem
                      key={s}
                      value={s}
                      onMouseEnter={() => setHoveredStatus(s)}
                      onFocus={() => setHoveredStatus(s)}
                    >
                      {PERSONAL_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                  {(() => {
                    // Painel de detalhe: descrição do status sob o mouse (ou, sem
                    // hover, do valor selecionado). Fonte: personal_status.comment.
                    const activeStatus = hoveredStatus ?? personalStatus ?? null
                    const comment = activeStatus ? PERSONAL_STATUS_COMMENTS.get(activeStatus) : undefined
                    if (!activeStatus || !comment) return null
                    return (
                      <div className="mt-1 border-t border-border/60 px-2 pb-1 pt-2">
                        <p className="text-xs font-semibold text-foreground">
                          {PERSONAL_STATUS_LABELS[activeStatus] ?? activeStatus}
                        </p>
                        <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground">
                          {comment}
                        </p>
                      </div>
                    )
                  })()}
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
                className="w-20 h-9 text-center"
                {...register("chapters_read", { setValueAs: optionalNumber })}
              />
              <span className="text-muted-foreground">/</span>
              <div className="flex h-9 w-20 items-center justify-center rounded-md border bg-muted px-2 text-sm text-muted-foreground font-medium">
                {typeof totalChapters === "number" && totalChapters > 0 ? totalChapters : "?"}
              </div>
            </div>
          </div>

          <div className="space-y-1.5 w-full sm:w-auto">
            <Label>% lido</Label>
            <div className="flex h-9 w-20 items-center justify-center rounded-md border bg-muted px-2 text-sm text-muted-foreground font-medium">
              {(() => {
                const pct = readingProgressPercent(chaptersRead, totalChapters)
                return pct != null ? `${pct}%` : "—"
              })()}
            </div>
          </div>

          {personalStatus !== "Want to Read" && (
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

      {criteriaVisible && (
        <div className="space-y-4 border-t border-border/40 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setCriteriaOpen((v) => !v)}
              className="flex items-center gap-2 text-left"
            >
              <Star className="h-4.5 w-4.5 text-muted-foreground fill-muted-foreground/10" />
              <h3 className="text-base font-bold text-foreground">Critérios de avaliação</h3>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", criteriaOpen && "rotate-180")} />
            </button>

            <div className="flex flex-wrap items-center gap-4 bg-muted/40 border border-border/60 rounded-xl px-4 py-2.5 shadow-xs shrink-0 self-start sm:self-center">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground leading-tight">
                  Nota Pessoal
                </span>
                <span className="text-[11px] text-muted-foreground/80 leading-none">Calculada</span>
              </div>
              <ScoreBadge
                score={computedManualScore}
                size="lg"
                className="h-10 w-14 text-lg font-bold shadow-xs shrink-0"
              />
              <StarRating
                value={computedManualScore}
                valueForStars={starsToPostReadingScore}
                starsForValue={scoreToPostReadingStars}
                readOnly={true}
                showValue={false}
                size="md"
                className="gap-1 scale-110 origin-left drop-shadow-[0_0_6px_rgba(245,158,11,0.15)]"
              />
            </div>
          </div>

          {criteriaOpen && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {POST_READING_STAR_LEGEND.map((item) => (
                  <TooltipProvider key={item.label}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-muted cursor-help">
                          <span className="text-amber-500/45">{"★".repeat(item.stars)}</span>
                          <span className="text-foreground">{item.label}</span>
                          <span className="text-muted-foreground/60">({item.value.toFixed(1)})</span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left p-3 shadow-md border bg-popover text-popover-foreground">
                        <p className="font-semibold text-sm text-foreground">
                          {item.label}
                        </p>
                        <p className="mt-1 text-xs opacity-90 leading-relaxed text-muted-foreground">
                          {item.description}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
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
                            {(() => {
                              const desc = POST_READING_CRITERIA_DESCRIPTIONS[field]
                              if (!desc) {
                                return (
                                  <Label
                                    htmlFor={`status-${field}`}
                                    className="text-xs font-medium text-foreground cursor-pointer block truncate"
                                  >
                                    {POST_READING_WEIGHT_LABELS[field]}
                                  </Label>
                                )
                              }
                              return (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Label
                                        htmlFor={`status-${field}`}
                                        className="text-xs font-medium text-foreground cursor-help block truncate underline-offset-2 decoration-dotted hover:underline"
                                      >
                                        {POST_READING_WEIGHT_LABELS[field]}
                                      </Label>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left leading-relaxed">
                                      {desc}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )
                            })()}
                            {currentValue != null && (
                              <span className="text-[11px] font-mono font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded leading-none">
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
            </>
          )}
        </div>
      )}

      {/* Footer interno: omitido quando `formId` está setado (o parent renderiza
          o botão Salvar no fim de tudo, depois dos atributos pós-leitura) ou quando
          hideFooter é true (dialog usa seus próprios botões). */}
      {!hideFooter && !formId && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={saving || (!isDirty && !extraDirty)}>
            {saving ? "Salvando…" : (submitLabel ?? "Salvar")}
          </Button>
        </div>
      )}
    </form>
  )
}
