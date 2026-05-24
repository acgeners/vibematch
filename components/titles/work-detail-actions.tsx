"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Archive,
  BookOpen,
  Edit,
  Heart,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { archiveWork, deleteWork, toggleFavorite, unarchiveWork } from "@/server/actions/works"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"
import { RevalidateSourcesDialog } from "@/components/titles/revalidate-sources-dialog"
import { StatusEditDialog } from "@/components/titles/status-edit-dialog"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
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
  const router = useRouter()
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
      router.refresh()
    })
  }
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

export function EditLinkButton({
  workSlug,
  workId,
  iconOnly = false,
}: {
  workSlug?: string
  workId: string
  iconOnly?: boolean
}) {
  return (
    <Button asChild variant="outline" size={iconOnly ? "icon" : "sm"} aria-label="Editar">
      <Link href={`/titles/${workSlug ?? workId}/edit`}>
        <Edit className="h-4 w-4" />
        {!iconOnly && "Editar"}
      </Link>
    </Button>
  )
}

export function StatusActionButton({
  workId,
  statusInitialValues,
  totalChapters,
  label = "Alterar Status",
  variant = "outline",
  size = "sm",
  className,
}: {
  workId: string
  statusInitialValues: WorkStatusValues
  totalChapters?: number | null
  label?: string
  variant?: "outline" | "default" | "ghost"
  size?: "sm" | "default" | "lg"
  className?: string
}) {
  const [open, setOpen] = useState(false)
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
      />
    </>
  )
}

export function UpdateDataActionButton({
  workId,
  currentWork,
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
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw className="h-4 w-4" />
        Atualizar dados
      </Button>
      <UpdateDataDialog workId={workId} currentWork={currentWork} open={open} onOpenChange={setOpen} hideTrigger />
    </>
  )
}

export function RevalidateSourcesActionButton({ workId }: { workId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="h-4 w-4" />
        Revalidar fontes
      </Button>
      <RevalidateSourcesDialog workId={workId} open={open} onOpenChange={setOpen} hideTrigger />
    </>
  )
}

export function MoreActionsMenu({
  workId,
  isArchived,
  iconOnly = false,
}: {
  workId: string
  isArchived: boolean
  iconOnly?: boolean
}) {
  const router = useRouter()
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
          <DropdownMenuItem onSelect={handleArchive} disabled={isPending}>
            <Archive className="h-4 w-4" />
            {isArchived ? "Desarquivar" : "Arquivar"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
