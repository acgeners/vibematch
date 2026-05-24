"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { WorkStatusForm } from "@/components/titles/work-status-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"

export interface StatusEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workId: string
  totalChapters: number | null
  initialValues: WorkStatusValues
}

export function StatusEditDialog({
  open,
  onOpenChange,
  workId,
  totalChapters,
  initialValues,
}: StatusEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Status</DialogTitle>
          <DialogDescription>
            Atualize apenas as informações de status sem abrir o formulário completo.
          </DialogDescription>
        </DialogHeader>

        <WorkStatusForm
          workId={workId}
          totalChapters={totalChapters}
          initialValues={initialValues}
          onSaved={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
