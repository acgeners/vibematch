"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { ExternalSearch } from "@/components/titles/external-search"
import { updateWorkExternalData } from "@/server/actions/works"
import type { ExternalWorkData } from "@/lib/external/types"

interface CurrentWork {
  title: string
  originalTitle?: string | null
  synopsis?: string | null
  coverUrl?: string | null
  publicationStatus?: string | null
  totalChapters?: number | null
}

interface UpdateDataDialogProps {
  workId: string
  currentWork: CurrentWork
}

interface FieldConflict {
  field: keyof CurrentWork
  label: string
  currentValue: string | null
  externalValue: string | null
}

function formatValue(value: string | number | null | undefined): string {
  if (value == null) return "—"
  return String(value)
}

function getConflicts(current: CurrentWork, external: ExternalWorkData): FieldConflict[] {
  const conflicts: FieldConflict[] = []

  const check = (
    field: keyof CurrentWork,
    label: string,
    currentVal: string | number | null | undefined,
    externalVal: string | number | null | undefined
  ) => {
    const cv = formatValue(currentVal)
    const ev = formatValue(externalVal)
    if (ev !== "—" && cv !== ev) {
      conflicts.push({ field, label, currentValue: cv === "—" ? null : cv, externalValue: ev })
    }
  }

  check("title", "Título", current.title, external.title)
  check("originalTitle", "Título original", current.originalTitle, external.originalTitle)
  check("synopsis", "Sinopse", current.synopsis, external.synopsis)
  check("coverUrl", "Capa (URL)", current.coverUrl, external.coverUrl)
  check("publicationStatus", "Status de publicação", current.publicationStatus, external.publicationStatus)
  check("totalChapters", "Capítulos totais", current.totalChapters, external.totalChapters)

  return conflicts
}

export function UpdateDataDialog({ workId, currentWork }: UpdateDataDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<"search" | "conflicts" | "saving">("search")
  const [pendingData, setPendingData] = useState<ExternalWorkData | null>(null)
  const [conflicts, setConflicts] = useState<FieldConflict[]>([])
  const [resolutions, setResolutions] = useState<Record<string, "current" | "external">>({})

  const handleSelect = (data: ExternalWorkData) => {
    const detected = getConflicts(currentWork, data)
    setPendingData(data)
    if (detected.length > 0) {
      const defaults: Record<string, "current" | "external"> = {}
      for (const c of detected) defaults[c.field] = "external"
      setResolutions(defaults)
      setConflicts(detected)
      setPhase("conflicts")
    } else {
      applyUpdate(data, {})
    }
  }

  const applyUpdate = async (
    data: ExternalWorkData,
    fieldResolutions: Record<string, "current" | "external">
  ) => {
    setPhase("saving")
    // Returns the external value only if it's non-empty and user didn't explicitly keep current.
    // Returning undefined signals the server action to skip the field entirely (preserving DB value).
    const pick = (field: keyof CurrentWork, externalVal: string | null | undefined): string | undefined => {
      if (fieldResolutions[field] === "current") return undefined
      if (externalVal != null && externalVal !== "") return externalVal
      return undefined
    }

    const updates: Record<string, unknown> = {
      // title is always required — use external if available, otherwise keep current
      title: pick("title", data.title) ?? currentWork.title,
      platformRatings: buildPlatformRatings(data),
    }

    const originalTitle = pick("originalTitle", data.originalTitle)
    if (originalTitle !== undefined) updates.originalTitle = originalTitle

    const synopsis = pick("synopsis", data.synopsis)
    if (synopsis !== undefined) updates.synopsis = synopsis

    const coverUrl = pick("coverUrl", data.coverUrl)
    if (coverUrl !== undefined) updates.coverUrl = coverUrl

    const publicationStatus = pick("publicationStatus", data.publicationStatus)
    if (publicationStatus !== undefined) updates.publicationStatus = publicationStatus

    if (fieldResolutions["totalChapters"] !== "current" && data.totalChapters != null) {
      updates.totalChapters = data.totalChapters
    }

    // genres/tags: undefined = preserve existing; array = replace that category
    if ((data.genres?.length ?? 0) > 0) updates.genres = data.genres
    if ((data.tags?.length ?? 0) > 0) updates.tags = data.tags

    let result: { data?: { id: string }; error?: string }
    try {
      result = await updateWorkExternalData(workId, updates)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Erro ao atualizar: ${message}`)
      setPhase("conflicts")
      return
    }
    if (result.error) {
      toast.error(`Erro ao atualizar: ${result.error}`)
      setPhase("conflicts")
      return
    }

    toast.success("Dados atualizados com sucesso.")
    setOpen(false)
    setPhase("search")
    router.refresh()
  }

  const handleConfirm = () => {
    if (!pendingData) return
    applyUpdate(pendingData, resolutions)
  }

  const handleClose = () => {
    setOpen(false)
    setPhase("search")
    setPendingData(null)
    setConflicts([])
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw className="h-4 w-4" />
        Atualizar dados
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Atualizar dados externos</DialogTitle>
            <DialogDescription>
              Busque a obra em fontes externas para atualizar sinopse, capa, capítulos, avaliações e tags.
            </DialogDescription>
          </DialogHeader>

          {phase === "search" && (
            <div className="pt-2">
              <ExternalSearch titleQuery={currentWork.title} onSelect={handleSelect} />
            </div>
          )}

          {phase === "conflicts" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Os campos abaixo diferem dos dados atuais. Escolha qual versão manter:
              </p>
              {conflicts.map((c) => (
                <div key={c.field} className="space-y-1.5">
                  <p className="text-sm font-medium">{c.label}</p>
                  <div className="space-y-1">
                    {([
                      { key: "external", label: "Externo", value: c.externalValue },
                      { key: "current", label: "Atual", value: c.currentValue },
                    ] as const).map(({ key, label, value }) => (
                      <label
                        key={key}
                        className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                          resolutions[c.field] === key ? "border-primary bg-primary/5" : "hover:bg-accent/50"
                        }`}
                      >
                        <input
                          type="radio"
                          name={c.field}
                          checked={resolutions[c.field] === key}
                          onChange={() => setResolutions((prev) => ({ ...prev, [c.field]: key }))}
                          className="mt-0.5 accent-primary shrink-0"
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          <Badge variant="outline" className="text-[10px] py-0 mr-1.5">{label}</Badge>
                          <span className="break-all">{value ?? "—"}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <Separator />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                <Button onClick={handleConfirm}>Confirmar e salvar</Button>
              </div>
            </div>
          )}

          {phase === "saving" && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Salvando dados...
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function buildPlatformRatings(data: ExternalWorkData) {
  const ratings: Array<{ platform: string; rating?: number | null; votes?: number | null }> = []
  const add = (platform: string, rating: number | null | undefined, votes: number | null | undefined) => {
    if (rating != null || (votes ?? 0) > 0) {
      ratings.push({ platform, rating: rating ?? null, votes: votes ?? null })
    }
  }
  if (data.externalPlatformRatings?.length) {
    for (const r of data.externalPlatformRatings) add(r.platform, r.rating, r.votes)
  }
  add("mangaupdates", data.muRating, data.muVotes)
  add("comick", data.cmxRating, data.cmxVotes)
  add("animeplanet", data.apRating, data.apVotes)
  return ratings
}
