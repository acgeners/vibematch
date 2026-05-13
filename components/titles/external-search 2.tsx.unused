"use client"

import { useState } from "react"
import { Search, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { searchExternalTitles, fetchExternalData, upsertExternalTags } from "@/server/actions/external"
import { fetchComicKClient, fetchAnimePlanetClient } from "@/lib/external/client-fetches"
import type { MergedCandidate, ConflictField, ExternalWorkData } from "@/lib/external/types"

function mergeTagArrays(...arrays: (string[] | undefined)[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const arr of arrays) {
    for (const item of arr ?? []) {
      const key = item.toLowerCase().trim()
      if (item.trim() && !seen.has(key)) {
        seen.add(key)
        result.push(item.trim())
      }
    }
  }
  return result
}

interface ExternalSearchProps {
  titleQuery: string
  onSelect: (data: ExternalWorkData) => void
}

type Phase = "idle" | "searching" | "results" | "loading" | "conflicts"

const STATUS_LABELS: Record<string, string> = {
  C: "Completo",
  O: "Em andamento",
  H: "Hiatus",
  D: "Cancelado",
  Unknown: "Desconhecido",
}

const SOURCE_COLORS: Record<string, string> = {
  anilist: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  mangaupdates: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
}

const SOURCE_LABELS_MAP: Record<string, string> = {
  anilist: "AniList",
  mangaupdates: "MU",
}

export function ExternalSearch({ titleQuery, onSelect }: ExternalSearchProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [candidates, setCandidates] = useState<MergedCandidate[]>([])
  const [pendingData, setPendingData] = useState<ExternalWorkData | null>(null)
  const [conflicts, setConflicts] = useState<ConflictField[]>([])
  const [resolutions, setResolutions] = useState<Record<string, unknown>>({})

  const handleSearch = async () => {
    if (!titleQuery.trim()) return
    setIsOpen(true)
    setPhase("searching")
    setCandidates([])
    try {
      const found = await searchExternalTitles(titleQuery)
      setCandidates(found)
    } catch {
      setCandidates([])
    } finally {
      setPhase("results")
    }
  }

  const handleSelect = async (candidate: MergedCandidate) => {
    setPhase("loading")
    try {
      const [serverResult, cmxResult, apResult] = await Promise.allSettled([
        fetchExternalData(candidate),
        fetchComicKClient(candidate.title),
        fetchAnimePlanetClient(candidate.title),
      ])

      const result = serverResult.status === "fulfilled" ? serverResult.value : null
      if (!result) {
        setPhase("results")
        return
      }

      // Merge client-side data
      const merged: ExternalWorkData = { ...result.data }

      const cmx = cmxResult.status === "fulfilled" ? cmxResult.value : null
      if (cmx) {
        if (cmx.rating != null) merged.cmxRating = cmx.rating
        if (cmx.votes != null) merged.cmxVotes = cmx.votes
        if (cmx.chapters != null) {
          merged.totalChapters = cmx.chapters
        }
        if (cmx.tags?.length) {
          merged.tags = mergeTagArrays(merged.tags, cmx.tags)
        }
      }

      const ap = apResult.status === "fulfilled" ? apResult.value : null
      if (ap) {
        if (ap.rating != null) merged.apRating = ap.rating
        if (ap.votes != null) merged.apVotes = ap.votes
      }

      // Server-side conflicts (chapters, publicationStatus between AniList and MU)
      // ComicK chapters are preferred over MU — no conflict needed
      const allConflicts = result.conflicts.filter(c => c.field !== "totalChapters" || cmx?.chapters == null)

      // Upsert all tags to DB (fire-and-forget)
      if (merged.tags.length > 0) {
        upsertExternalTags(merged.tags).catch(() => {})
      }

      if (allConflicts.length > 0) {
        const defaultResolutions: Record<string, unknown> = {}
        for (const c of allConflicts) {
          defaultResolutions[c.field] = c.options[0].value
        }
        setPendingData(merged)
        setConflicts(allConflicts)
        setResolutions(defaultResolutions)
        setPhase("conflicts")
      } else {
        onSelect(merged)
        setIsOpen(false)
        setPhase("idle")
      }
    } catch {
      setPhase("results")
    }
  }

  const handleConfirmConflicts = () => {
    if (!pendingData) return
    const finalData: ExternalWorkData = { ...pendingData }
    for (const [field, value] of Object.entries(resolutions)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(finalData as any)[field] = value
    }
    onSelect(finalData)
    setIsOpen(false)
    setPhase("idle")
  }

  const handleClose = () => {
    setIsOpen(false)
    setPhase("idle")
  }

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="lg"
        onClick={handleSearch}
        disabled={!titleQuery.trim()}
        className="h-10 w-full shrink-0 gap-2 rounded-lg bg-emerald-600 px-5 font-semibold text-white shadow-sm shadow-emerald-900/20 hover:bg-emerald-700 disabled:shadow-none sm:w-auto"
      >
        <Sparkles className="h-4 w-4" />
        Buscar dados
      </Button>

      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Buscar dados externos</SheetTitle>
            <SheetDescription>
              Resultados para <span className="font-medium">&quot;{titleQuery}&quot;</span>
            </SheetDescription>
          </SheetHeader>

          {phase === "searching" && (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-16 w-12 rounded shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {phase === "results" && (
            candidates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Search className="h-8 w-8 mb-3 opacity-40" />
                <p className="font-medium">Nenhum resultado encontrado</p>
                <p className="text-sm mt-1">Tente variações do título ou adicione manualmente</p>
              </div>
            ) : (
              <div className="space-y-2">
                {candidates.slice(0, 10).map((candidate, i) => (
                  <CandidateCard
                    key={i}
                    candidate={candidate}
                    onSelect={handleSelect}
                  />
                ))}
                <p className="text-xs text-muted-foreground text-center pt-2 pb-4">
                  Ao selecionar, dados de todas as fontes são buscados e mesclados automaticamente.
                </p>
              </div>
            )
          )}

          {phase === "loading" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <div className="text-center">
                <p className="font-medium text-sm">Buscando dados completos...</p>
                <p className="text-xs mt-1">AniList · MangaUpdates · ComicK · AnimePlanet · IA</p>
              </div>
            </div>
          )}

          {phase === "conflicts" && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Fontes retornaram valores diferentes para alguns campos. Escolha o valor correto:
              </p>
              {conflicts.map((conflict) => (
                <div key={conflict.field} className="space-y-2">
                  <p className="text-sm font-medium">{conflict.label}</p>
                  <div className="space-y-1">
                    {conflict.options.map((opt, i) => {
                      const id = `${conflict.field}-${i}`
                      const isSelected = String(resolutions[conflict.field]) === String(opt.value)
                      return (
                        <label
                          key={i}
                          htmlFor={id}
                          className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "hover:bg-accent/50"
                          }`}
                        >
                          <input
                            type="radio"
                            id={id}
                            name={conflict.field}
                            checked={isSelected}
                            onChange={() =>
                              setResolutions((prev) => ({ ...prev, [conflict.field]: opt.value }))
                            }
                            className="accent-primary"
                          />
                          <span className="flex-1 text-sm">
                            <span className="font-medium">{opt.displayValue}</span>
                            <span className="text-xs text-muted-foreground ml-2">— {opt.source}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
              <Separator />
              <div className="flex gap-2 justify-end pb-2">
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button type="button" onClick={handleConfirmConflicts}>
                  Confirmar e preencher
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

interface CandidateCardProps {
  candidate: MergedCandidate
  onSelect: (c: MergedCandidate) => void
}

function CandidateCard({ candidate, onSelect }: CandidateCardProps) {
  return (
    <div className="flex gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="h-16 w-12 rounded overflow-hidden bg-muted shrink-0">
        {candidate.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={candidate.coverUrl}
            alt={candidate.title}
            className="h-full w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-muted-foreground">
            <Search className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm line-clamp-2 leading-tight">{candidate.title}</p>
        {candidate.originalTitle && candidate.originalTitle !== candidate.title && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{candidate.originalTitle}</p>
        )}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {candidate.sources.map((src) => (
            <span key={src} className={`text-xs px-1.5 py-0.5 rounded font-medium ${SOURCE_COLORS[src] ?? ""}`}>
              {SOURCE_LABELS_MAP[src] ?? src}
            </span>
          ))}
          {candidate.publicationStatus && (
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              {STATUS_LABELS[candidate.publicationStatus] ?? candidate.publicationStatus}
            </Badge>
          )}
          {candidate.year && (
            <span className="text-xs text-muted-foreground">{candidate.year}</span>
          )}
          {candidate.chapters != null && (
            <span className="text-xs text-muted-foreground">{candidate.chapters} caps</span>
          )}
          {candidate.score != null && (
            <span className="text-xs font-mono text-muted-foreground">★ {candidate.score.toFixed(1)}</span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onSelect(candidate)}
          className="text-xs h-8"
        >
          Usar
        </Button>
      </div>
    </div>
  )
}
