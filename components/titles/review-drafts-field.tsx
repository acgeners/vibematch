"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export interface ReviewDraft {
  /** Chave estável para o React (não persistida). */
  key: string
  text: string
  /** Nota 0-10 como string (campo controlado; vazio = sem nota). */
  userRating: string
  note: string
}

export function emptyReviewDraft(): ReviewDraft {
  return { key: crypto.randomUUID(), text: "", userRating: "", note: "" }
}

interface ReviewDraftsFieldProps {
  value: ReviewDraft[]
  onChange: (next: ReviewDraft[]) => void
  disabled?: boolean
}

/**
 * Editor controlado de reviews manuais (texto + nota opcional + nota interna).
 * Sem persistência — o caller decide quando/como salvar (page de edição
 * auto-salva; diálogo Avaliar salva ao rodar a IA).
 */
export function ReviewDraftsField({ value, onChange, disabled }: ReviewDraftsFieldProps) {
  const update = (key: string, patch: Partial<ReviewDraft>) =>
    onChange(value.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => onChange(value.filter((r) => r.key !== key))
  const add = () => onChange([...value, emptyReviewDraft()])

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma review manual. Adicione comentários/impressões suas — entram no
          prompt como evidência direta (recebem IDs R1, R2… e a IA é obrigada a citá-las).
        </p>
      )}

      {value.map((draft, index) => (
        <div key={draft.key} className="rounded-lg border border-border/60 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Review {index + 1}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => remove(draft.key)}
              className="h-7 px-2 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Textarea
            value={draft.text}
            disabled={disabled}
            onChange={(e) => update(draft.key, { text: e.target.value })}
            placeholder="Ex.: O romance é o eixo central, slow burn bem construído; o humor aparece em alívios pontuais…"
            className="min-h-[80px]"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Nota (0–10, opcional)</Label>
              <Input
                type="number"
                min={0}
                max={10}
                step={0.5}
                inputMode="decimal"
                disabled={disabled}
                value={draft.userRating}
                onChange={(e) => update(draft.key, { userRating: e.target.value })}
                placeholder="—"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Nota interna (não vai pro prompt)</Label>
              <Input
                value={draft.note}
                disabled={disabled}
                onChange={(e) => update(draft.key, { note: e.target.value })}
                placeholder="Ex.: li até o cap. 50"
              />
            </div>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={add}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar review
      </Button>
    </div>
  )
}

/** Converte linhas do DB em drafts editáveis. */
export function manualReviewsToDrafts(
  reviews: Array<{ text: string; user_rating: number | null; note: string | null }>,
): ReviewDraft[] {
  return reviews.map((r) => ({
    key: crypto.randomUUID(),
    text: r.text,
    userRating: r.user_rating != null ? String(r.user_rating) : "",
    note: r.note ?? "",
  }))
}

/** Converte drafts no input do saveManualReviews (descarta vazios, parseia nota). */
export function draftsToManualReviewInput(drafts: ReviewDraft[]) {
  return drafts
    .map((d) => {
      const rating = d.userRating.trim() === "" ? null : Number(d.userRating)
      return {
        text: d.text.trim(),
        userRating: rating != null && !Number.isNaN(rating) ? rating : null,
        note: d.note.trim() || null,
      }
    })
    .filter((d) => d.text.length > 0)
}
