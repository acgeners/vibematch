"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRefresh } from "@/lib/use-refresh"
import {
  Archive,
  BookOpen,
  Edit,
  Heart,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldOff,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { archiveWork, autoRefreshWorkData, deleteWork, setAdultOverride, toggleFavorite, unarchiveWork } from "@/server/actions/works"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"
import { StatusEditDialog } from "@/components/titles/status-edit-dialog"
import { useCan, useIsAdmin, useCanWriteOwnState } from "@/components/layout/admin-context"
import type { PostAttributeAssessmentFormProps } from "@/components/titles/post-attribute-assessment-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import type { TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

export function FavoriteToggleButton({
  workId,
  isFavorite,
  iconOnly = false,
}: {
  workId: string
  isFavorite: boolean
  iconOnly?: boolean
}) {
  const canFavorite = useCanWriteOwnState()
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  const handleClick = () => {
    const next = !isFavorite
    startTransition(async () => {
      const result = await toggleFavorite(workId, next)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(next ? "Adicionado aos favoritos." : "Removido dos favoritos.")
      refresh()
    })
  }
  // Favorito é estado pessoal (Fatia 1) → qualquer usuário LOGADO. Anônimo não: sem sessão
  // não há linha própria pra escrever. Os outros botões deste arquivo seguem só do Curador —
  // eles mutam o catálogo compartilhado (editar, arquivar, apagar).
  if (!canFavorite) return null
  return (
    <Button
      variant={isFavorite ? "default" : "outline"}
      size={iconOnly ? "icon" : "sm"}
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? "Remover dos favoritos" : "Favoritar"}
      className={cn(isFavorite ? "bg-rose-500/90 hover:bg-rose-500 text-white" : undefined)}
    >
      <Heart className={isFavorite ? "h-4 w-4 fill-current" : "h-4 w-4"} />
      {!iconOnly && (isFavorite ? "Favorito" : "Favoritar")}
    </Button>
  )
}

export function StatusActionButton({
  workId,
  statusInitialValues,
  totalChapters,
  latestAiEvaluation,
  existingAssessment,
  tasteCriteria,
  tasteScores,
  label = "Alterar Status",
  variant = "outline",
  size = "sm",
  className,
}: {
  workId: string
  statusInitialValues: WorkStatusValues
  totalChapters?: number | null
  latestAiEvaluation: PostAttributeAssessmentFormProps["latestAiEvaluation"]
  existingAssessment: PostAttributeAssessmentFormProps["existingAssessment"]
  /** Critérios/notas de gosto ("Como foi pra você") — repassados ao dialog. */
  tasteCriteria?: TasteCriterion[]
  tasteScores?: Record<TasteScoreKey, number | null>
  label?: string
  variant?: "outline" | "default" | "ghost"
  size?: "sm" | "default" | "lg"
  className?: string
}) {
  // "Marcar leitura" abre o form de status/capítulos — estado PESSOAL (Fatia 1). Era o botão
  // que fazia da Leitora uma espectadora: escondido pra ela, e recusado pelo servidor se
  // chamado assim mesmo. Agora vale pra qualquer usuário logado; o form em si é que decide o
  // que ela pode editar (nota e pós-leitura seguem do Curador — Fatia 2).
  const canWriteOwnState = useCanWriteOwnState()
  const [open, setOpen] = useState(false)
  if (!canWriteOwnState) return null
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className={className}>
        <BookOpen className="h-4 w-4" />
        {label}
      </Button>
      <StatusEditDialog
        open={open}
        onOpenChange={setOpen}
        workId={workId}
        totalChapters={totalChapters ?? null}
        initialValues={statusInitialValues}
        latestAiEvaluation={latestAiEvaluation}
        existingAssessment={existingAssessment}
        tasteCriteria={tasteCriteria}
        tasteScores={tasteScores}
      />
    </>
  )
}

export function UpdateDataActionButton({
  workId,
  currentWork,
  currentCovers,
  currentSynopses,
}: {
  workId: string
  currentWork: {
    title: string
    originalTitle?: string | null
    synopsis?: string | null
    coverUrl?: string | null
    publicationStatus?: string | null
    totalChapters?: number | null
    observations?: string | null
  }
  currentCovers?: Array<{ url: string; source?: string | null; isPrimary?: boolean }>
  currentSynopses?: Array<{ source: string; text: string; isPrimary: boolean }>
}) {
  const isAdmin = useIsAdmin()
  const canRefresh = useCan("refresh_work")
  const [open, setOpen] = useState(false)

  // Leitor não atualiza nada.
  if (!canRefresh) return null

  // ASSINANTE: atualização automática. Sem diálogo — ele não escolhe capa, sinopse
  // nem resolve conflito (isso é curadoria, e `works` é compartilhada). Um clique,
  // o servidor funde e grava. Ver autoRefreshWorkData / buildAutoRefreshPlan.
  if (!isAdmin) return <AutoRefreshButton workId={workId} />

  // CURADOR: fluxo completo, com as telas de escolha.
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw className="h-4 w-4" />
        Atualizar dados
      </Button>
      <UpdateDataDialog
        workId={workId}
        currentWork={currentWork}
        currentCovers={currentCovers}
        currentSynopses={currentSynopses}
        open={open}
        onOpenChange={setOpen}
        hideTrigger
        withSourceStep
      />
    </>
  )
}

function AutoRefreshButton({ workId }: { workId: string }) {
  const [loading, setLoading] = useState(false)
  const refresh = useRefresh()

  const run = async () => {
    setLoading(true)
    try {
      const r = await autoRefreshWorkData(workId)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      if (r.updatedFields.length === 0) {
        toast.info("Os dados já estão em dia — nada mudou nas fontes.")
        return
      }
      const skipped = r.skippedConflicts.length
      toast.success(
        `Dados atualizados a partir de ${r.sources.length} ${r.sources.length === 1 ? "fonte" : "fontes"}.` +
          // Diz o que NÃO foi tocado: senão o assinante acha que o app ignorou o campo.
          (skipped > 0
            ? ` ${skipped} ${skipped === 1 ? "campo divergente ficou" : "campos divergentes ficaram"} como está — só o Curador resolve divergência.`
            : ""),
      )
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar os dados.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={loading}>
      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
      {loading ? "Atualizando…" : "Atualizar dados"}
    </Button>
  )
}

export function MoreActionsMenu({
  workId,
  workSlug,
  isArchived,
  isAdult = false,
  adultOverride = null,
  iconOnly = false,
}: {
  workId: string
  /** Slug pra rota de edição (fallback pro id). */
  workSlug?: string
  isArchived: boolean
  /** Classificação 18+ efetiva (works.is_adult). */
  isAdult?: boolean
  /** Override humano ativo (works.adult_override): true/false força, null = automático. */
  adultOverride?: boolean | null
  iconOnly?: boolean
}) {
  const isAdmin = useIsAdmin()
  const router = useRouter()
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleArchive = () => {
    startTransition(async () => {
      const result = isArchived ? await unarchiveWork(workId) : await archiveWork(workId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(isArchived ? "Obra desarquivada." : "Obra arquivada.")
      refresh()
    })
  }

  const handleAdult = (value: boolean | null) => {
    startTransition(async () => {
      const result = await setAdultOverride(workId, value)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        value === true
          ? "Marcada como 18+."
          : value === false
            ? "Marcada como não-18+."
            : "Classificação 18+ voltou ao automático.",
      )
      refresh()
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

  // Stopgap multi-user: arquivar/deletar mutam o catálogo compartilhado → só o dono.
  if (!isAdmin) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={iconOnly ? "icon" : "sm"} aria-label="Mais ações">
            <MoreHorizontal className="h-4 w-4" />
            {!iconOnly && "Mais"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild>
            <Link href={`/titles/${workSlug ?? workId}/edit`}>
              <Edit className="h-4 w-4" />
              Editar obra
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          {isAdult ? (
            <DropdownMenuItem onSelect={() => handleAdult(false)} disabled={isPending}>
              <ShieldOff className="h-4 w-4" />
              Desmarcar 18+
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => handleAdult(true)} disabled={isPending}>
              <ShieldAlert className="h-4 w-4" />
              Marcar como 18+
            </DropdownMenuItem>
          )}
          {adultOverride !== null && (
            <DropdownMenuItem onSelect={() => handleAdult(null)} disabled={isPending}>
              <RotateCcw className="h-4 w-4" />
              18+: voltar ao automático
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleArchive} disabled={isPending}>
            <Archive className="h-4 w-4" />
            {isArchived ? "Desarquivar" : "Arquivar"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setDeleteOpen(true)}
            disabled={isPending}
            variant="destructive"
          >
            <Trash2 className="h-4 w-4" />
            Deletar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir obra permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A obra e todos os dados associados serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-between">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
