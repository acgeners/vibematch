"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import {
  DEFAULT_POST_READING_WEIGHTS,
  POST_READING_WEIGHT_LABELS,
  POST_READING_WEIGHT_STORAGE_KEY,
  type PostReadingScoreField,
} from "@/lib/constants/post-reading-criteria"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

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
        Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value))
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
    register,
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field} className="space-y-1.5">
            <Label htmlFor={field}>{POST_READING_WEIGHT_LABELS[field]}</Label>
            <Input
              id={field}
              type="number"
              step={0.5}
              min={0}
              max={10}
              className="max-w-32"
              {...register(field, {
                setValueAs: (value) => {
                  const parsed = Number(value)
                  return Number.isFinite(parsed) ? parsed : DEFAULT_POST_READING_WEIGHTS[field]
                },
              })}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={!isDirty}>
          Salvar pesos da avaliação
        </Button>
        <Button type="button" variant="outline" onClick={restoreDefaults}>
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
