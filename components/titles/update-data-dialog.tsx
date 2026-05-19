"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { ExternalSearch } from "@/components/titles/external-search"
import { updateWorkExternalData, refreshWorkExternalData } from "@/server/actions/works"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { dedupeSynopsisEntries } from "@/lib/work-derived"
import type { ExternalSourceId, ExternalWorkData } from "@/lib/external/types"

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

interface SynopsisChoice {
  source: ExternalSourceId
  text: string
  included: boolean
  isPrimary: boolean
}

interface CoverChoice {
  source: ExternalSourceId
  url: string
  included: boolean
  isPrimary: boolean
}

export function UpdateDataDialog({ workId, currentWork }: UpdateDataDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<"refreshing" | "search" | "multipick" | "conflicts" | "saving">("refreshing")
  const [pendingData, setPendingData] = useState<ExternalWorkData | null>(null)
  const [conflicts, setConflicts] = useState<FieldConflict[]>([])
  const [resolutions, setResolutions] = useState<Record<string, "current" | "external">>({})
  const [synopsisChoices, setSynopsisChoices] = useState<SynopsisChoice[]>([])
  const [coverChoices, setCoverChoices] = useState<CoverChoice[]>([])

  const handleSelect = (data: ExternalWorkData) => {
    // Quando há múltiplas sinopses/capas vindas das fontes vinculadas, mostra
    // picker antes do conflict resolver — assim user decide quais incluir e
    // qual é primária, em vez de receber uma sinopse mesclada arbitrária.
    const synopses = data.multiSynopses ?? []
    const covers = data.multiCovers ?? []
    if (synopses.length > 1 || covers.length > 1) {
      setPendingData(data)
      setSynopsisChoices(
        synopses.map((s, i) => ({
          source: s.source,
          text: s.text,
          included: i === 0,
          isPrimary: i === 0,
        }))
      )
      setCoverChoices(
        covers.map((c, i) => ({
          source: c.source,
          url: c.url,
          included: i === 0,
          isPrimary: i === 0,
        }))
      )
      setPhase("multipick")
      return
    }
    proceedToConflictsOrApply(data)
  }

  const proceedToConflictsOrApply = (
    data: ExternalWorkData,
    preResolved: Record<string, "current" | "external"> = {}
  ) => {
    const detected = getConflicts(currentWork, data).filter((c) => !(c.field in preResolved))
    setPendingData(data)
    if (detected.length > 0) {
      const defaults: Record<string, "current" | "external"> = { ...preResolved }
      for (const c of detected) defaults[c.field] = "external"
      setResolutions(defaults)
      setConflicts(detected)
      setPhase("conflicts")
    } else {
      applyUpdate(data, preResolved)
    }
  }

  const handleConfirmMultiPick = () => {
    if (!pendingData) return
    const includedSynopses = synopsisChoices.filter((s) => s.included)
    const includedCovers = coverChoices.filter((c) => c.included)
    const primaryCover = includedCovers.find((c) => c.isPrimary) ?? includedCovers[0]
    const primarySynopsis = includedSynopses.find((s) => s.isPrimary) ?? includedSynopses[0]
    const orderedSynopses = primarySynopsis
      ? [primarySynopsis, ...includedSynopses.filter((s) => s !== primarySynopsis)]
      : includedSynopses
    const selectedSynopses = dedupeSynopsisEntries(orderedSynopses)
    const next: ExternalWorkData = {
      ...pendingData,
      coverUrl: primaryCover?.url ?? pendingData.coverUrl,
      multiCovers: includedCovers.map((c) => ({ url: c.url, source: c.source })),
      synopsis: selectedSynopses.find((s) => s.isPrimary)?.text ?? selectedSynopses[0]?.text ?? pendingData.synopsis,
      multiSynopses: selectedSynopses.map((s) => ({ source: s.source as ExternalSourceId, text: s.text })),
      synopsisIsMerged: false,
    }
    // O usuário já escolheu sinopse/capa no multipick — não perguntar de novo
    // na tela de conflitos (que comparava só o campo single e dava a impressão
    // de que as outras escolhas estavam sendo descartadas).
    const preResolved: Record<string, "current" | "external"> = {}
    if (includedSynopses.length > 0) preResolved.synopsis = "external"
    if (includedCovers.length > 0) preResolved.coverUrl = "external"
    proceedToConflictsOrApply(next, preResolved)
  }

  const toggleSynopsisIncluded = (idx: number) => {
    setSynopsisChoices((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, included: !s.included } : s))
    )
  }
  const setSynopsisPrimary = (idx: number) => {
    setSynopsisChoices((prev) =>
      prev.map((s, i) => ({ ...s, isPrimary: i === idx, included: i === idx ? true : s.included }))
    )
  }
  const toggleCoverIncluded = (url: string) => {
    setCoverChoices((prev) =>
      prev.map((c) => (c.url === url ? { ...c, included: !c.included } : c))
    )
  }
  const setCoverPrimary = (url: string) => {
    setCoverChoices((prev) =>
      prev.map((c) => ({ ...c, isPrimary: c.url === url, included: c.url === url ? true : c.included }))
    )
  }

  const handleOpen = async () => {
    setOpen(true)
    setPhase("refreshing")
    try {
      const result = await refreshWorkExternalData(workId)
      if (result.ok) {
        handleSelect(result.data)
        return
      }
      if (result.reason === "ALL_404") {
        toast.warning("Fontes externas indisponíveis para esta obra. Buscando por título...")
      }
      setPhase("search")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[UpdateDataDialog] refresh failed:", message)
      toast.error(`Erro ao atualizar: ${message}`)
      setPhase("search")
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

    // Multipick: quando o usuário escolheu várias capas/sinopses, envia a lista
    // completa pro server pra todas serem persistidas (não só a primária).
    if (data.multiCovers && data.multiCovers.length > 0 && fieldResolutions["coverUrl"] !== "current") {
      const primaryUrl = coverUrl ?? data.coverUrl ?? data.multiCovers[0]?.url
      updates.covers = data.multiCovers.map((c) => ({
        url: c.url,
        source: c.source,
        isPrimary: c.url === primaryUrl,
      }))
    }
    if (data.multiSynopses && data.multiSynopses.length > 0 && fieldResolutions["synopsis"] !== "current") {
      const selectedSynopses = dedupeSynopsisEntries(data.multiSynopses.map((s, index) => ({
        text: s.text,
        source: s.source,
        isPrimary: s.text === data.synopsis || (data.synopsis == null && index === 0),
      })))
      updates.synopses = selectedSynopses.map((s) => ({
        text: s.text,
        source: s.source,
        isPrimary: s.isPrimary,
      }))
    }

    const publicationStatus = pick("publicationStatus", data.publicationStatus)
    if (publicationStatus !== undefined) updates.publicationStatus = publicationStatus

    if (fieldResolutions["totalChapters"] !== "current" && data.totalChapters != null) {
      updates.totalChapters = data.totalChapters
    }

    // genres/tags: undefined = preserve existing; array = replace that category
    if ((data.genres?.length ?? 0) > 0) updates.genres = data.genres
    if ((data.tags?.length ?? 0) > 0) updates.tags = data.tags

    // Persiste IDs externos da fonte vinculada para que o próximo "Atualizar dados"
    // pegue o fast-path (sem busca por título nem AI).
    if (data.externalIds && Object.keys(data.externalIds).length > 0) {
      const cleaned: Record<string, string> = {}
      for (const [source, id] of Object.entries(data.externalIds)) {
        if (id) cleaned[source] = String(id)
      }
      if (Object.keys(cleaned).length > 0) updates.externalIds = cleaned
    }

    let result: { data?: { id: string; slug?: string }; error?: string }
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
    setPhase("refreshing")
    // Se o título mudou, navegar pelo UUID evita depender do cache slug->id.
    // A rota /titles/{uuid} redireciona para o slug canônico lido do banco.
    const newTitle = typeof updates.title === "string" ? updates.title : null
    if (newTitle && newTitle !== currentWork.title) {
      router.push(`/titles/${workId}`)
    } else {
      router.refresh()
    }
  }

  const handleConfirm = () => {
    if (!pendingData) return
    applyUpdate(pendingData, resolutions)
  }

  const handleClose = () => {
    setOpen(false)
    setPhase("refreshing")
    setPendingData(null)
    setConflicts([])
    setSynopsisChoices([])
    setCoverChoices([])
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <RefreshCw className="h-4 w-4" />
        Atualizar dados
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Atualizar dados externos</DialogTitle>
            <DialogDescription>
              Rehidrata sinopse, capa, capítulos, avaliações e tags a partir das fontes já vinculadas.
            </DialogDescription>
          </DialogHeader>

          {phase === "refreshing" && (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p>Comparando dados externos...</p>
            </div>
          )}

          {phase === "search" && (
            <div className="pt-2">
              <ExternalSearch titleQuery={currentWork.title} onSelect={handleSelect} evaluateAi={false} checkDuplicates={false} />
            </div>
          )}

          {phase === "multipick" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Múltiplas sinopses/capas vieram das fontes. Marque o que incluir e qual é a principal.
              </p>

              {synopsisChoices.length > 1 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Sinopses</h3>
                  {synopsisChoices.map((s, idx) => (
                    <div
                      key={`${s.source}-${idx}`}
                      className={`rounded-md border p-3 space-y-2 ${
                        s.included ? "border-primary/60 bg-primary/5" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline" className="text-[10px]">{s.source}</Badge>
                        <div className="flex items-center gap-3 text-xs">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <Checkbox
                              checked={s.included}
                              onCheckedChange={() => toggleSynopsisIncluded(idx)}
                            />
                            Incluir
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="synopsis-primary"
                              checked={s.isPrimary}
                              onChange={() => setSynopsisPrimary(idx)}
                              className="accent-primary"
                            />
                            Principal
                          </label>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-6 whitespace-pre-wrap">{s.text}</p>
                    </div>
                  ))}
                </section>
              )}

              {coverChoices.length > 1 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Capas</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {coverChoices.map((c) => (
                      <div
                        key={c.url}
                        className={`rounded-md border p-2 space-y-1.5 ${
                          c.included ? "border-primary/60 bg-primary/5" : ""
                        }`}
                      >
                        <div className="relative w-full aspect-[2/3] overflow-hidden rounded bg-muted">
                          <Image src={getCoverImageSrc(c.url)} alt="" fill sizes="160px" unoptimized className="object-cover" />
                        </div>
                        <Badge variant="outline" className="text-[10px] w-full justify-center">{c.source}</Badge>
                        <div className="flex items-center justify-between text-[11px]">
                          <label className="flex items-center gap-1 cursor-pointer">
                            <Checkbox
                              checked={c.included}
                              onCheckedChange={() => toggleCoverIncluded(c.url)}
                            />
                            Incluir
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name="cover-primary"
                              checked={c.isPrimary}
                              onChange={() => setCoverPrimary(c.url)}
                              className="accent-primary"
                            />
                            Principal
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <Separator />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                <Button onClick={handleConfirmMultiPick}>Continuar</Button>
              </div>
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
