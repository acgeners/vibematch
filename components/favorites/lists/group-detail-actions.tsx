"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ListPlus, MessageSquare, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { deleteWorkList } from "@/server/actions/lists"
import type { WorkLiteForPicker, ListComment } from "@/server/queries/lists"
import { GroupFormDialog, type GroupFormData } from "./group-form-dialog"
import { ManageWorksDialog } from "./manage-works-dialog"
import { GroupCommentsDialog } from "./group-comments-dialog"

interface GroupDetailActionsProps {
  list: GroupFormData & { name: string }
  memberIds: string[]
  catalog: WorkLiteForPicker[]
  comments: ListComment[]
}

export function GroupDetailActions({ list, memberIds, catalog, comments }: GroupDetailActionsProps) {
  const router = useRouter()
  const [manageOpen, setManageOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [, startDelete] = useTransition()

  const coverCandidates = catalog.filter((w) => memberIds.includes(w.id))

  function confirmDelete() {
    startDelete(async () => {
      const res = await deleteWorkList(list.id)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      toast.success(`Grupo “${list.name}” excluído.`)
      router.push("/favorites")
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => setManageOpen(true)}>
        <ListPlus /> Adicionar obras
      </Button>
      <Button variant="outline" size="sm" onClick={() => setCommentsOpen(true)}>
        <MessageSquare /> Comentários{comments.length > 0 ? ` (${comments.length})` : ""}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil /> Editar
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="hover:border-destructive/60 hover:text-destructive"
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 /> Excluir
      </Button>

      <ManageWorksDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        listId={list.id}
        listName={list.name}
        memberIds={memberIds}
        catalog={catalog}
      />
      <GroupCommentsDialog
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        listId={list.id}
        listName={list.name}
        comments={comments}
      />
      <GroupFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        list={list}
        coverCandidates={coverCandidates}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Excluir “${list.name}”?`}
        description="O grupo é removido, mas as obras e seus favoritos continuam intactos."
        confirmText="Excluir grupo"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
