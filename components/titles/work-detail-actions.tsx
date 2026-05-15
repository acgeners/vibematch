"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Archive, BookOpen, Edit, Loader2, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { triggerAiEvaluation } from "@/server/actions/ai"
import { archiveWork, deleteWork, unarchiveWork } from "@/server/actions/works"
import { AiEvaluationReviewForm } from "@/components/ai-evaluation/ai-evaluation-review-form"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"
import { StatusEditDialog } from "@/components/titles/status-edit-dialog"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AiEvaluation } from "@/types/domain"

interface WorkDetailActionsProps {
  workId: string
  workSlug?: string
  workTitle: string
  isArchived: boolean
  coverUrl?: string | null
  hasCriteriaScores?: boolean
  className?: string
  currentWork?: {
    title: string
    originalTitle?: string | null
    synopsis?: string | null
    coverUrl?: string | null
    publicationStatus?: string | null
    totalChapters?: number | null
  }
  statusInitialValues?: WorkStatusValues
  totalChapters?: number | null
}

export function WorkDetailActions({
  workId,
  workSlug,
  workTitle,
  isArchived,
  coverUrl,
  hasCriteriaScores = false,
  className,
  currentWork,
  statusInitialValues,
  totalChapters,
}: WorkDetailActionsProps) {
  void workTitle
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [evaluating, setEvaluating] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [evaluation, setEvaluation] = useState<AiEvaluation | null>(null)
  const [currentScores, setCurrentScores] = useState<Record<string, number>>({})

  const handleArchive = () => {
    startTransition(async () => {
      const result = isArchived
        ? await unarchiveWork(workId)
        : await archiveWork(workId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(isArchived ? "Obra desarquivada." : "Obra arquivada.")
      router.refresh()
    })
  }

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteWork(workId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Obra excluída.")
      router.push("/titles")
    })
  }

  const handleAiEvaluation = async () => {
    setEvaluating(true)
    const result = await triggerAiEvaluation(workId)
    setEvaluating(false)

    if (result.error || !result.data?.evaluation) {
      toast.error(`Erro na avaliação IA: ${result.error ?? "resposta vazia"}`)
      return
    }

    setEvaluation(result.data.evaluation)
    setCurrentScores(result.data.currentScores ?? {})
    setReviewOpen(true)
    const reviewsUsed = result.data.reviewsUsed ?? 0
    toast.success(
      reviewsUsed === 0
        ? "Avaliação IA gerada sem reviews externas."
        : `Avaliação IA gerada usando ${reviewsUsed} review${reviewsUsed === 1 ? "" : "s"} externa${reviewsUsed === 1 ? "" : "s"}.`
    )
  }

  return (
    <>
      <div className={className ? `flex flex-wrap gap-2 ${className}` : "flex flex-wrap gap-2"}>
        <Button asChild variant="outline" size="sm">
          <Link href={`/titles/${workSlug ?? workId}/edit`}>
            <Edit className="h-4 w-4" />
            Editar
          </Link>
        </Button>
        {statusInitialValues && (
          <Button variant="outline" size="sm" onClick={() => setStatusOpen(true)}>
            <BookOpen className="h-4 w-4" />
            Status
          </Button>
        )}
        {currentWork && (
          <UpdateDataDialog workId={workId} currentWork={currentWork} />
        )}
        <Button variant="outline" size="sm" onClick={handleAiEvaluation} disabled={evaluating}>
          <Sparkles className="h-4 w-4" />
          {evaluating ? "Avaliando..." : hasCriteriaScores ? "Reavaliar IA" : "Avaliar IA"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={isPending}>
              <Trash2 className="h-4 w-4" />
              Deletar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>O que deseja fazer com esta obra?</AlertDialogTitle>
              <AlertDialogDescription>
                Arquivar mantém a obra no banco, mas remove das listas principais. Excluir remove permanentemente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:justify-between">
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <AlertDialogAction onClick={handleArchive}>
                  <Archive className="h-4 w-4" />
                  {isArchived ? "Desarquivar" : "Arquivar"}
                </AlertDialogAction>
                <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
                  <Trash2 className="h-4 w-4" />
                  Excluir permanentemente
                </AlertDialogAction>
              </div>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Dialog open={evaluating} onOpenChange={() => undefined}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <DialogTitle>{hasCriteriaScores ? "Reavaliando com IA" : "Avaliando com IA"}</DialogTitle>
            <DialogDescription>
              Buscando reviews externas e gerando {hasCriteriaScores ? "uma nova avaliação" : "a avaliação"}. Isso pode levar alguns segundos.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {statusInitialValues && (
        <StatusEditDialog
          open={statusOpen}
          onOpenChange={setStatusOpen}
          workId={workId}
          totalChapters={totalChapters ?? null}
          initialValues={statusInitialValues}
        />
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisar avaliação IA</DialogTitle>
            <DialogDescription>
              Ajuste manualmente qualquer nota antes de aplicar na obra.
            </DialogDescription>
          </DialogHeader>
          {evaluation && (
            <AiEvaluationReviewForm
              evaluation={evaluation}
              workId={workId}
              coverUrl={coverUrl}
              currentScores={currentScores}
              onSaved={() => {
                setReviewOpen(false)
                router.refresh()
              }}
              onCancel={() => setReviewOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
