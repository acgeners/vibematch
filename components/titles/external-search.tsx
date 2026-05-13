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
import { searchExternalTitles, fetchExternalData, upsertExternalTags, checkExistingWorkInDb, evaluateCandidateForCreate, type ExistingWorkMatch } from "@/server/actions/external"
import { fetchComicKClient, fetchAnimePlanetClient } from "@/lib/external/client-fetches"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import type { MergedCandidate, ConflictField, ExternalWorkData, ExternalSourceId } from "@/lib/external/types"

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

type Phase = "idle" | "searching" | "results" | "duplicate" | "loading" | "multipick" | "conflicts"

interface CoverChoice { url: string; source: string; included: boolean; isPrimary: boolean }
interface SynopsisChoice { source: string; text: string; included: boolean; isPrimary: boolean }

const STATUS_LABELS: Record<string, string> = {
  C: "Completo",
  O: "Em andamento",
  H: "Hiatus",
  D: "Cancelado",
  Unknown: "Desconhecido",
}

const SOURCE_COLORS: Partial<Record<string, string>> = {
  anilist: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  mangaupdates: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
}

function getSourceLabel(source: string) {
  return PLATFORM_LABELS[source] ?? source
}

export function ExternalSearch({ titleQuery, onSelect }: ExternalSearchProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [candidates, setCandidates] = useState<MergedCandidate[]>([])
  const [pendingData, setPendingData] = useState<ExternalWorkData | null>(null)
  const [conflicts, setConflicts] = useState<ConflictField[]>([])
  const [resolutions, setResolutions] = useState<Record<string, unknown>>({})
  const [duplicates, setDuplicates] = useState<ExistingWorkMatch[]>([])
  const [pendingCandidate, setPendingCandidate] = useState<MergedCandidate | null>(null)
  const [coverChoices, setCoverChoices] = useState<CoverChoice[]>([])
  const [synopsisChoices, setSynopsisChoices] = useState<SynopsisChoice[]>([])

  const handleSearch = async () => {
    if (!titleQuery.trim()) return
    setIsOpen(true)
    setPhase("searching")
    setCandidates([])
    try {
      const found = await searchExternalTitles(titleQuery)
      setCandidates(found)
    } catch (error) {
      console.error("[ExternalSearch] searchExternalTitles failed", error)
      setCandidates([])
    } finally {
      setPhase("results")
    }
  }

  const handleSelect = async (candidate: MergedCandidate) => {
    setPendingCandidate(candidate)
    setPhase("loading")
    try {
      const matches = await checkExistingWorkInDb({
        title: candidate.title,
        originalTitle: candidate.originalTitle,
        alternativeTitles: candidate.alternativeTitles,
      })
      if (matches.length > 0) {
        setDuplicates(matches)
        setPhase("duplicate")
        return
      }
    } catch (error) {
      console.error("[ExternalSearch] checkExistingWorkInDb failed", error)
      // fall through and proceed normally — better to import than to block on a check failure
    }
    await proceedWithCandidate(candidate)
  }

  const handleProceedDespiteDuplicate = async () => {
    if (!pendingCandidate) {
      handleClose()
      return
    }
    setDuplicates([])
    setPhase("loading")
    await proceedWithCandidate(pendingCandidate)
  }

  const proceedWithCandidate = async (candidate: MergedCandidate) => {
    try {
      const [serverResult, cmxResult, apResult] = await Promise.allSettled([
        fetchExternalData(candidate),
        fetchComicKClient(candidate.title),
        fetchAnimePlanetClient(candidate.title),
      ])

      if (serverResult.status === "rejected") {
        console.error("[ExternalSearch] fetchExternalData failed", serverResult.reason)
      }
      if (cmxResult.status === "rejected") {
        console.error("[ExternalSearch] fetchComicKClient failed", cmxResult.reason)
      }
      if (apResult.status === "rejected") {
        console.error("[ExternalSearch] fetchAnimePlanetClient failed", apResult.reason)
      }

      const result = serverResult.status === "fulfilled" ? serverResult.value : null
      if (!result) {
        setPhase("results")
        return
      }

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

      const allConflicts = result.conflicts.filter(c => c.field !== "totalChapters" || cmx?.chapters == null)

      if (merged.tags.length > 0) {
        upsertExternalTags(merged.tags).catch(() => {})
      }

      // Pre-compute AI evaluation using the merged metadata + reviews from all
      // accepted sources. The form picks these up and persists them via
      // createWork's ai_justifications path (creating an ai_evaluations row
      // marked as model_name "claude-haiku-4-5-...", and category_scores with
      // source "ai_accepted"). Failure is non-blocking — user can re-run via
      // /ai-evaluation later.
      const aiResult = await evaluateCandidateForCreate({
        title: merged.title,
        originalTitle: merged.originalTitle ?? null,
        alternativeTitles: merged.alternativeTitles ?? null,
        synopsis: merged.synopsis ?? null,
        genres: merged.genres,
        tags: merged.tags,
      })
      if (aiResult) {
        merged.criteriaScores = aiResult.scores
        merged.criteriaJustifications = aiResult.justifications
      }

      const covers = merged.multiCovers ?? []
      const synopses = merged.multiSynopses ?? []
      const hasMultiCover = covers.length > 1
      const hasMultiSynopsis = synopses.length > 1

      if (hasMultiCover || hasMultiSynopsis) {
        setCoverChoices(
          covers.map((c, i) => ({ url: c.url, source: c.source, included: i === 0, isPrimary: i === 0 }))
        )
        setSynopsisChoices(
          synopses.map((s, i) => ({ source: s.source, text: s.text, included: i === 0, isPrimary: i === 0 }))
        )
        const defaultResolutions: Record<string, unknown> = {}
        for (const c of allConflicts) defaultResolutions[c.field] = c.options[0].value
        setPendingData(merged)
        setConflicts(allConflicts)
        setResolutions(defaultResolutions)
        setPhase("multipick")
        return
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
    } catch (error) {
      console.error("[ExternalSearch] proceedWithCandidate failed", error)
      setPhase("results")
    }
  }

  const handleConfirmMultiPick = () => {
    if (!pendingData) return
    const includedCovers = coverChoices.filter((c) => c.included)
    const primaryCover = includedCovers.find((c) => c.isPrimary) ?? includedCovers[0]
    const includedSynopses = synopsisChoices.filter((s) => s.included)
    const primarySynopsis = includedSynopses.find((s) => s.isPrimary) ?? includedSynopses[0]

    const next: ExternalWorkData = {
      ...pendingData,
      coverUrl: primaryCover?.url ?? pendingData.coverUrl,
      multiCovers: includedCovers.map((c) => ({ url: c.url, source: c.source as ExternalSourceId })),
      synopsis: includedSynopses.length > 0
        ? includedSynopses.map((s) => s.text).join("\n\n---\n\n")
        : pendingData.synopsis,
      multiSynopses: includedSynopses.map((s) => ({ source: s.source as ExternalSourceId, text: s.text })),
      synopsisIsMerged: includedSynopses.length > 1,
    }
    void primarySynopsis

    if (conflicts.length > 0) {
      setPendingData(next)
      setPhase("conflicts")
    } else {
      onSelect(next)
      setIsOpen(false)
      setPhase("idle")
    }
  }

  const toggleCoverIncluded = (url: string) => {
    setCoverChoices((prev) => prev.map((c) => c.url === url ? { ...c, included: !c.included } : c))
  }
  const setCoverPrimary = (url: string) => {
    setCoverChoices((prev) => prev.map((c) => ({ ...c, isPrimary: c.url === url, included: c.url === url ? true : c.included })))
  }
  const toggleSynopsisIncluded = (idx: number) => {
    setSynopsisChoices((prev) => prev.map((s, i) => i === idx ? { ...s, included: !s.included } : s))
  }
  const setSynopsisPrimary = (idx: number) => {
    setSynopsisChoices((prev) => prev.map((s, i) => ({ ...s, isPrimary: i === idx, included: i === idx ? true : s.included })))
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
    setDuplicates([])
    setPendingCandidate(null)
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
                <p className="font-medium text-sm">Buscando dados e avaliando com IA...</p>
                <p className="text-xs mt-1">AniList · MangaUpdates · ComicK · AnimePlanet · Comix · Kitsu · MangaDex · MAL</p>
                <p className="text-xs mt-1 text-muted-foreground">A IA pode levar ~10s — você não precisará reavaliar depois.</p>
              </div>
            </div>
          )}

          {phase === "duplicate" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-4">
                <p className="font-medium text-sm text-amber-900 dark:text-amber-200">
                  Já existe uma obra parecida no banco
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                  Confirme se é a mesma obra antes de continuar — importar duplicado pode bagunçar suas avaliações.
                </p>
              </div>
              <div className="space-y-2">
                {duplicates.map((dup) => (
                  <a
                    key={dup.id}
                    href={`/titles/${dup.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start justify-between gap-3 rounded-md border bg-card p-3 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{dup.title}</p>
                      {dup.originalTitle && dup.originalTitle !== dup.title && (
                        <p className="text-xs text-muted-foreground truncate">
                          original: {dup.originalTitle}
                        </p>
                      )}
                      {dup.alternativeTitles.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate">
                          alt: {dup.alternativeTitles.slice(0, 3).join(" · ")}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {dup.matchType === "exact_title" && "título exato"}
                      {dup.matchType === "original_title" && "título original"}
                      {dup.matchType === "exact_alt" && "alt exato"}
                      {dup.matchType === "fuzzy" && `fuzzy ${Math.round(dup.similarity * 100)}%`}
                    </Badge>
                  </a>
                ))}
              </div>
              <Separator />
              <div className="flex gap-2 justify-end pb-2">
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button type="button" variant="secondary" onClick={handleProceedDespiteDuplicate}>
                  Continuar mesmo assim
                </Button>
              </div>
            </div>
          )}

          {phase === "multipick" && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Múltiplas fontes retornaram dados visuais e textuais. Marque o que quer manter e qual é a principal.
              </p>

              {coverChoices.length > 1 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Capas</p>
                  <div className="grid grid-cols-3 gap-3">
                    {coverChoices.map((cover) => (
                      <div
                        key={cover.url}
                        className={`relative rounded-md border overflow-hidden ${
                          cover.included ? "border-primary/60" : "border-muted opacity-50"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cover.url}
                          alt={cover.source}
                          className="w-full h-40 object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                        />
                        <div className="p-2 space-y-1 bg-card">
                          <span className="text-[10px] font-medium uppercase text-muted-foreground">
                            {getSourceLabel(cover.source)}
                          </span>
                          <div className="flex items-center gap-2 text-xs">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={cover.included}
                                onChange={() => toggleCoverIncluded(cover.url)}
                              />
                              Incluir
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="cover-primary"
                                checked={cover.isPrimary}
                                onChange={() => setCoverPrimary(cover.url)}
                              />
                              Principal
                            </label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {synopsisChoices.length > 1 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Sinopses</p>
                  <div className="space-y-2">
                    {synopsisChoices.map((syn, idx) => (
                      <div
                        key={`${syn.source}-${idx}`}
                        className={`rounded-md border p-3 space-y-2 ${
                          syn.included ? "border-primary/60" : "border-muted opacity-60"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[10px]">
                            {getSourceLabel(syn.source)}
                          </Badge>
                          <div className="flex items-center gap-3 text-xs">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={syn.included}
                                onChange={() => toggleSynopsisIncluded(idx)}
                              />
                              Incluir
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="radio"
                                name="syn-primary"
                                checked={syn.isPrimary}
                                onChange={() => setSynopsisPrimary(idx)}
                              />
                              Principal
                            </label>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">
                          {syn.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />
              <div className="flex gap-2 justify-end pb-2">
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button type="button" onClick={handleConfirmMultiPick}>
                  Continuar
                </Button>
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
            <span
              key={src}
              className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                SOURCE_COLORS[src] ?? "bg-muted text-muted-foreground"
              }`}
            >
              {getSourceLabel(src)}
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
