"use client"

import { useEffect, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { toast } from "sonner"
import { RotateCcw } from "lucide-react"
import {
  DEFAULT_POST_READING_WEIGHTS,
  POST_READING_WEIGHT_LABELS,
  POST_READING_WEIGHT_STORAGE_KEY,
  type PostReadingScoreField,
} from "@/lib/constants/post-reading-criteria"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"

type FormValues = Record<PostReadingScoreField, number>

const FIELDS = Object.keys(DEFAULT_POST_READING_WEIGHTS) as PostReadingScoreField[]

function readStoredWeights(): FormValues {
  if (typeof window === "undefined") return { ...DEFAULT_POST_READING_WEIGHTS }

  const stored = window.localStorage.getItem(POST_READING_WEIGHT_STORAGE_KEY)
  if (!stored) return { ...DEFAULT_POST_READING_WEIGHTS }

  try {
    const parsed = JSON.parse(stored) as Partial<FormValues>
    return {
      ...DEFAULT_POST_READING_WEIGHTS,
      ...Object.fromEntries(
        Object.entries(parsed).filter(
          ([, value]) => typeof value === "number" && Number.isFinite(value)
        )
      ),
    } as FormValues
  } catch {
    return { ...DEFAULT_POST_READING_WEIGHTS }
  }
}

export function PostReadingWeightsForm() {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<FormValues | null>(null)

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<FormValues>({
    defaultValues: { ...DEFAULT_POST_READING_WEIGHTS },
  })

  useEffect(() => {
    reset(readStoredWeights())
  }, [reset])

  const askConfirm = (values: FormValues) => {
    setPending(values)
    setConfirmOpen(true)
  }

  const onConfirm = () => {
    if (!pending) return
    setConfirmOpen(false)
    window.localStorage.setItem(POST_READING_WEIGHT_STORAGE_KEY, JSON.stringify(pending))
    reset(pending)
    toast.success("Pesos da avaliação salvos.")
    setPending(null)
  }

  const restoreDefaults = () => {
    window.localStorage.removeItem(POST_READING_WEIGHT_STORAGE_KEY)
    reset({ ...DEFAULT_POST_READING_WEIGHTS })
    toast.success("Pesos padrão restaurados.")
  }

  return (
    <form onSubmit={handleSubmit(askConfirm)} className="space-y-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {FIELDS.map((field) => (
          <PostReadingWeightCard key={field} field={field} control={control} />
        ))}
      </div>

      <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Esses pesos são salvos localmente neste navegador — não afetam outros dispositivos.
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={!isDirty}>
          Salvar pesos da avaliação
        </Button>
        <Button type="button" variant="outline" onClick={restoreDefaults}>
          <RotateCcw className="h-3.5 w-3.5" />
          Restaurar padrão
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Salvar pesos da avaliação?"
        description="Os pesos serão armazenados localmente no seu navegador (não afetam outros dispositivos)."
        confirmText="Salvar"
        onConfirm={onConfirm}
      />
    </form>
  )
}

function PostReadingWeightCard({
  field,
  control,
}: {
  field: PostReadingScoreField
  control: ReturnType<typeof useForm<FormValues>>["control"]
}) {
  return (
    <Controller
      control={control}
      name={field}
      render={({ field: ctrl }) => {
        const value = Number.isFinite(ctrl.value) ? ctrl.value : 0
        const isDefault = value === DEFAULT_POST_READING_WEIGHTS[field]
        return (
          <div
            className={cn(
              "rounded-lg border p-3 transition-colors",
              value > 0
                ? "border-primary/30 bg-primary/[0.03]"
                : "border-border/65 bg-background/40"
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {POST_READING_WEIGHT_LABELS[field]}
              </p>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                  value > 0
                    ? "bg-primary/15 text-primary"
                    : "bg-muted/60 text-muted-foreground"
                )}
              >
                {value.toFixed(1).replace(".0", "")}×
              </span>
            </div>
            <Slider
              value={[value]}
              min={0}
              max={10}
              step={0.5}
              onValueChange={(v) => ctrl.onChange(v[0])}
              className="px-1"
            />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {isDefault ? (
                <>Padrão</>
              ) : (
                <>
                  Padrão: <span className="font-mono">{DEFAULT_POST_READING_WEIGHTS[field]}</span>
                </>
              )}
            </p>
          </div>
        )
      }}
    />
  )
}
