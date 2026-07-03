"use client"

import { useState, useTransition } from "react"
import { useForm, Controller } from "react-hook-form"
import type { Resolver, UseFormReturn } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Globe, PencilLine, Plus, Trash2, X } from "lucide-react"
import {
  externalReviewInputSchema,
  EXTERNAL_REVIEW_SOURCES,
} from "@/lib/validations/external-review.schema"
import type { ExternalReviewSource } from "@/lib/validations/external-review.schema"
import {
  createExternalManualReview,
  updateExternalManualReview,
  deleteExternalManualReview,
} from "@/server/actions/external-manual-reviews"
import type { ExternalManualReviewDisplayRow } from "@/server/queries/external-manual-reviews"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { useRefresh } from "@/lib/use-refresh"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ExpandableText } from "@/components/ui/expandable-text"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Campos do form (text-only após migration 114): só fonte + texto. */
interface FormFields {
  source: ExternalReviewSource
  text: string
}

const EMPTY: FormFields = { source: "outros", text: "" }

const resolver = zodResolver(externalReviewInputSchema) as unknown as Resolver<FormFields>

function rowToForm(r: ExternalManualReviewDisplayRow): FormFields {
  return {
    source: (EXTERNAL_REVIEW_SOURCES as readonly string[]).includes(r.source)
      ? (r.source as ExternalReviewSource)
      : "comix",
    text: r.text,
  }
}

/** Enter (fora de TEXTAREA) submete sem borbulhar para o <form> do WorkForm. */
function enterToSubmit(submit: () => void, disabled: boolean) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled) submit()
    }
  }
}

/** Campos compartilhados pelo form de adicionar e pelo editor inline do card. */
function ReviewFields({ form }: { form: UseFormReturn<FormFields> }) {
  return (
    <>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Fonte</Label>
        <Controller
          control={form.control}
          name="source"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className="h-9 w-fit min-w-[200px]">
                <SelectValue placeholder="Selecione a fonte" />
              </SelectTrigger>
              <SelectContent>
                {EXTERNAL_REVIEW_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{PLATFORM_LABELS[s] ?? s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Texto da review (cópia fiel, ≥40 caracteres)</Label>
        <Textarea
          className="min-h-[100px]"
          placeholder="Cole o texto da review externa, sem resumir nem reescrever."
          {...form.register("text")}
        />
        {form.formState.errors.text && (
          <p className="text-xs text-destructive">{String(form.formState.errors.text.message)}</p>
        )}
      </div>
    </>
  )
}

/**
 * Card de UMA review externa manual. Lê em read-only; ao clicar no lápis, edita
 * fonte+texto INLINE no próprio card (form local), sem mexer no form de adicionar acima.
 * Exclusão é confirmada pelo pai (ConfirmDialog único).
 */
function ManualReviewCard({
  workId,
  review,
  onRequestDelete,
  deleteDisabled,
}: {
  workId: string
  review: ExternalManualReviewDisplayRow
  onRequestDelete: (id: string) => void
  deleteDisabled: boolean
}) {
  const refresh = useRefresh()
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const form = useForm<FormFields>({ resolver, defaultValues: rowToForm(review), mode: "onSubmit" })

  const beginEdit = () => {
    form.reset(rowToForm(review))
    setEditing(true)
  }
  const cancel = () => {
    form.reset(rowToForm(review))
    setEditing(false)
  }
  const submit = () =>
    form.handleSubmit((values) => {
      startTransition(async () => {
        const result = await updateExternalManualReview(review.id, workId, values)
        if (result.ok) {
          toast.success("Review externa atualizada.")
          setEditing(false)
          refresh()
        } else {
          toast.error(result.message)
        }
      })
    })()

  if (editing) {
    return (
      <li className="rounded-md border bg-card/40 p-3">
        <div onKeyDown={enterToSubmit(submit, pending)} className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Editar review externa</span>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={cancel} disabled={pending}>
              <X className="mr-1 h-3.5 w-3.5" /> Cancelar
            </Button>
          </div>
          <ReviewFields form={form} />
          <Button type="button" size="sm" disabled={pending} onClick={submit}>
            <PencilLine className="mr-1 h-3.5 w-3.5" /> Salvar alterações
          </Button>
        </div>
      </li>
    )
  }

  return (
    <li className="rounded-md border bg-card/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold">{PLATFORM_LABELS[review.source] ?? review.source}</span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={pending} onClick={beginEdit}>
            <PencilLine className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hover:text-destructive"
            disabled={deleteDisabled}
            onClick={() => onRequestDelete(review.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <ExpandableText
        text={review.text}
        maxLines={4}
        className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/90"
      />
    </li>
  )
}

interface Props {
  workId: string
  reviews: ExternalManualReviewDisplayRow[]
}

/**
 * SEÇÃO "Reviews externas" (Plano 3, text-only). Reviews EXTERNAS copiadas literalmente para o
 * corpus do digest E a avaliação IA (`work_external_reviews_manual`). SÓ `source` + `text` — sem
 * nota/opinião pessoal e sem metadados (os opcionais foram dropados na migration 114; só o texto
 * é sinal). Pipeline ISOLADO: schema/action/loader/tabela próprios.
 *
 * Form de cima = só ADICIONAR. Cada card edita inline (lápis) e exclui (lixeira → confirmação).
 */
export function ExternalManualReviewsSection({ workId, reviews }: Props) {
  const refresh = useRefresh()
  const [pending, startTransition] = useTransition()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const form = useForm<FormFields>({ resolver, defaultValues: EMPTY, mode: "onSubmit" })

  const submitAdd = () =>
    form.handleSubmit((values) => {
      startTransition(async () => {
        const result = await createExternalManualReview(workId, values)
        if (result.ok) {
          toast.success("Review externa adicionada.")
          form.reset(EMPTY)
          refresh()
        } else {
          toast.error(result.message)
        }
      })
    })()

  const onDelete = (id: string) => {
    startTransition(async () => {
      const result = await deleteExternalManualReview(id, workId)
      if (result.ok) {
        toast.success("Review externa removida.")
        refresh()
      } else {
        toast.error(result.message)
      }
      setConfirmDeleteId(null)
    })
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4 text-muted-foreground" />
          Reviews externas
          <Badge variant="outline" className="text-[11px]">local · dev</Badge>
          {reviews.length > 0 && <Badge variant="secondary" className="text-[11px]">{reviews.length}</Badge>}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Reviews escritas por outros leitores e copiadas de fontes externas. Entram no corpus do
          digest e na avaliação IA. <strong>Só o texto</strong> é sinal — não escolha por
          sentimento/concordância, não resuma nem reescreva, e <strong>não</strong> inclua opinião
          ou nota pessoal.
        </p>
      </div>

      {/* NÃO usar <form>: a seção é renderizada DENTRO do <form> do WorkForm (reviewsSlot).
          Submit via botão + onClick. Enter em campo de 1 linha não borbulha para o WorkForm. */}
      <div onKeyDown={enterToSubmit(submitAdd, pending)} className="space-y-3 rounded-md border bg-card/40 p-3">
        <span className="text-xs font-semibold text-muted-foreground">Adicionar review externa</span>
        <ReviewFields form={form} />
        <Button type="button" size="sm" disabled={pending} onClick={submitAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar review externa
        </Button>
      </div>

      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma review externa adicionada manualmente ainda.</p>
      ) : (
        <ul className="space-y-2">
          {reviews.map((r) => (
            <ManualReviewCard
              key={r.id}
              workId={workId}
              review={r}
              onRequestDelete={setConfirmDeleteId}
              deleteDisabled={pending}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmDeleteId != null}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
        title="Remover review externa?"
        description="A review externa cadastrada manualmente será excluída."
        confirmText="Remover"
        onConfirm={() => {
          if (confirmDeleteId) onDelete(confirmDeleteId)
        }}
      />
    </section>
  )
}
