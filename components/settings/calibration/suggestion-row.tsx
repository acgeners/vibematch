"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Check, Loader2, MoreHorizontal, Pencil, X, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import {
  acceptSuggestionAction,
  editSuggestionAction,
  rejectSuggestionAction,
  revertSuggestionAction,
} from "@/server/actions/calibration"
import type { SuggestionStatus, SuggestionWithWork } from "@/lib/ai-calibration/types"

interface SuggestionRowProps {
  suggestion: SuggestionWithWork
}

function deltaColor(delta: number): string {
  const abs = Math.abs(delta)
  if (abs >= 2) return "bg-rose-500/15 text-rose-700 border-rose-500/40 dark:text-rose-300"
  if (abs >= 1) return "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
  return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
}

function statusLabel(status: SuggestionStatus): string {
  switch (status) {
    case "pending":
      return "Pendente"
    case "auto_applied":
      return "Auto-aplicada"
    case "accepted":
      return "Aceita"
    case "edited":
      return "Aceita (editada)"
    case "rejected":
      return "Rejeitada"
    case "reverted":
      return "Revertida"
  }
}

function statusColor(status: SuggestionStatus): string {
  switch (status) {
    case "pending":
      return "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
    case "auto_applied":
      return "bg-cyan-500/15 text-cyan-700 border-cyan-500/40 dark:text-cyan-300"
    case "accepted":
    case "edited":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300"
    case "rejected":
      return "bg-muted text-muted-foreground border-border"
    case "reverted":
      return "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"
  }
}

export function SuggestionRow({ suggestion }: SuggestionRowProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editValue, setEditValue] = useState(suggestion.suggested_score.toFixed(1))

  const info = CRITERIA_INFO[suggestion.criterion_slug]
  const isPending = suggestion.status === "pending"
  const isApplied = ["auto_applied", "accepted", "edited"].includes(suggestion.status)

  const handleAccept = () => {
    setError(null)
    startTransition(async () => {
      const res = await acceptSuggestionAction(suggestion.id)
      if (!res.ok && res.error) setError(res.error)
    })
  }

  const handleReject = () => {
    setError(null)
    startTransition(async () => {
      const res = await rejectSuggestionAction(suggestion.id)
      if (!res.ok && res.error) setError(res.error)
    })
  }

  const handleEdit = () => {
    setError(null)
    const score = Number(editValue.replace(",", "."))
    startTransition(async () => {
      const res = await editSuggestionAction(suggestion.id, score)
      if (!res.ok && res.error) setError(res.error)
      else setEditOpen(false)
    })
  }

  const handleRevert = () => {
    setError(null)
    startTransition(async () => {
      const res = await revertSuggestionAction(suggestion.id)
      if (!res.ok && res.error) setError(res.error)
    })
  }

  return (
    <div className="rounded-lg border bg-card/40 p-3 transition hover:bg-card/70">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/titles/${suggestion.work_id}`}
              className="line-clamp-1 text-sm font-medium hover:underline"
            >
              {suggestion.work_title}
            </Link>
            <Badge variant="outline" className={cn("text-[10px]", statusColor(suggestion.status))}>
              {statusLabel(suggestion.status)}
            </Badge>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-sm">
            <span className="font-medium text-foreground">
              {info?.emoji} {info?.name ?? suggestion.criterion_slug}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {suggestion.previous_score.toFixed(1)}
            </span>
            <span className="text-muted-foreground">→</span>
            <span className="font-semibold tabular-nums">
              {(suggestion.applied_score ?? suggestion.suggested_score).toFixed(1)}
            </span>
            <Badge variant="outline" className={cn("text-[10px] tabular-nums", deltaColor(suggestion.delta))}>
              Δ {suggestion.delta > 0 ? "+" : ""}
              {suggestion.delta.toFixed(1)}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              conf {(suggestion.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isPending && (
            <>
              <Button size="sm" variant="outline" onClick={handleAccept} disabled={pending}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                <span className="ml-1.5">Aceitar</span>
              </Button>
              <Popover open={editOpen} onOpenChange={setEditOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Aceitar com valor customizado:</p>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="10"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <Button size="sm" className="w-full" onClick={handleEdit} disabled={pending}>
                      Aplicar
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button size="sm" variant="ghost" onClick={handleReject} disabled={pending}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {isApplied && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleRevert} disabled={pending}>
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  Reverter
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {suggestion.justification && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {suggestion.justification}
        </p>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
