"use client"

import { useState, type Ref } from "react"
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
import { getCoverImageSrc } from "@/lib/image-proxy"
import { dedupeSynopsisEntries } from "@/lib/work-derived"
import type {
  MergedCandidate,
  ConflictField,
  ExternalWorkData,
  ExternalSourceId,
  ExternalSourceCandidateOption,
  ExternalSearchResult,
} from "@/lib/external/types"

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
  onDuplicateUpdate?: (match: ExistingWorkMatch, data: ExternalWorkData) => void | Promise<void>
  searchButtonRef?: Ref<HTMLButtonElement>
  /** Quando false, pula a avaliação IA durante a seleção (usado pelo fallback do "Atualizar dados", onde os scores seriam descartados). Default: true. */
  evaluateAi?: boolean
  /** Quando false, pula a checagem de obra duplicada (usado pelo fallback do "Atualizar dados", onde a obra-alvo já existe). Default: true. */
  checkDuplicates?: boolean
}

type Phase = "idle" | "searching" | "results" | "sourcepick" | "duplicate" | "loading" | "evaluating" | "multipick" | "conflicts"

interface CoverChoice { url: string; source: string; included: boolean; isPrimary: boolean }
interface SynopsisChoice { source: string; text: string; included: boolean; isPrimary: boolean }
type SourceSelectionValue = string | "rejected" | "none"

const SOURCE_COLORS: Partial<Record<string, string>> = {
  anilist: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  mangaupdates: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
}

const SOURCE_ORDER: ExternalSourceId[] = [
  "anilist",
  "animeplanet",
  "comix",
  "comick",
  "kitsu",
  "mangadex",
  "mangaupdates",
  "myanimelist",
]

function getSourceLabel(source: string) {
  return PLATFORM_LABELS[source] ?? source
}

function uniqueStringList(values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function sourceResultExternalId(result: ExternalSearchResult) {
  return result.id.split(":").slice(1).join(":")
}

function getCandidateExternalId(candidate: MergedCandidate, source: ExternalSourceId): string | null {
  switch (source) {
    case "anilist":
      return candidate.anilistId != null ? String(candidate.anilistId) : null
    case "mangaupdates":
      return candidate.muId != null ? String(candidate.muId) : null
    case "kitsu":
      return candidate.kitsuId ?? null
    case "mangadex":
      return candidate.mangadexId ?? null
    case "myanimelist":
      return candidate.malId != null ? String(candidate.malId) : null
    case "comick":
      return candidate.comickHid ?? null
    case "comix":
      return candidate.comixHid ?? null
    case "animeplanet":
      return candidate.animePlanetSlug ?? null
  }
}

function fallbackSourceOption(
  candidate: MergedCandidate,
  source: ExternalSourceId
): ExternalSourceCandidateOption | null {
  const externalId = getCandidateExternalId(candidate, source)
  if (!externalId) return null
  return {
    source,
    externalId,
    title: candidate.title,
    coverUrl: candidate.coverUrl ?? null,
    matchScore: candidate.matchScore ?? 1,
    synopsis: candidate.synopsis ?? null,
    year: candidate.year ?? null,
    chapters: candidate.chapters ?? null,
    trusted: candidate.trustedSources?.includes(source),
  }
}

function getSourceMatchGroups(candidate: MergedCandidate) {
  const bySource = new Map<ExternalSourceId, ExternalSourceCandidateOption[]>()
  for (const option of candidate.sourceCandidates ?? []) {
    const current = bySource.get(option.source) ?? []
    if (!current.some((item) => item.externalId === option.externalId)) {
      current.push(option)
      bySource.set(option.source, current)
    }
  }
  for (const source of candidate.sources) {
    if (bySource.has(source)) continue
    const fallback = fallbackSourceOption(candidate, source)
    if (fallback) bySource.set(source, [fallback])
  }

  return [...bySource.entries()]
    .map(([source, options]) => ({
      source,
      options: [...options].sort((a, b) => b.matchScore - a.matchScore),
    }))
    .sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source))
}

function buildInitialSourceSelection(candidate: MergedCandidate) {
  const selection: Partial<Record<ExternalSourceId, SourceSelectionValue>> = {}
  for (const group of getSourceMatchGroups(candidate)) {
    selection[group.source] = group.options[0]?.externalId ?? "none"
  }
  return selection
}

function applySelectedId(
  candidate: MergedCandidate,
  option: ExternalSourceCandidateOption
) {
  switch (option.source) {
    case "anilist": {
      const id = Number(option.externalId)
      if (Number.isFinite(id)) candidate.anilistId = id
      break
    }
    case "mangaupdates": {
      const id = Number(option.externalId)
      if (Number.isFinite(id)) candidate.muId = id
      break
    }
    case "kitsu":
      candidate.kitsuId = option.externalId
      break
    case "mangadex":
      candidate.mangadexId = option.externalId
      break
    case "myanimelist": {
      const id = Number(option.externalId)
      if (Number.isFinite(id)) candidate.malId = id
      break
    }
    case "comick":
      candidate.comickHid = option.externalId
      break
    case "comix":
      candidate.comixHid = option.externalId
      break
    case "animeplanet":
      candidate.animePlanetSlug = option.externalId
      break
  }
}

function buildCandidateFromSourceSelection(
  candidate: MergedCandidate,
  selection: Partial<Record<ExternalSourceId, SourceSelectionValue>>
): MergedCandidate | null {
  const groups = getSourceMatchGroups(candidate)
  const selectedOptions = groups.flatMap((group) => {
    const selected = selection[group.source]
    if (!selected || selected === "none" || selected === "rejected") return []
    const option = group.options.find((item) => item.externalId === selected)
    return option ? [option] : []
  })
  if (selectedOptions.length === 0) return null

  const resultBySourceId = new Map(
    (candidate.sourceResults ?? []).map((result) => [
      `${result.source}:${sourceResultExternalId(result)}`,
      result,
    ])
  )
  const selectedResults = selectedOptions
    .map((option) => resultBySourceId.get(`${option.source}:${option.externalId}`))
    .filter((result): result is ExternalSearchResult => Boolean(result))
  const selectedSources = selectedOptions.map((option) => option.source)
  const primaryOption =
    selectedOptions.find((option) => option.source === "mangaupdates") ?? selectedOptions[0]
  const primaryResult =
    selectedResults.find((result) => result.source === primaryOption.source) ?? selectedResults[0]
  const originalTitle =
    primaryResult?.originalTitle ??
    candidate.originalTitle ??
    selectedResults.find((result) => result.originalTitle)?.originalTitle

  const next: MergedCandidate = {
    title: primaryResult?.title ?? primaryOption.title,
    originalTitle,
    alternativeTitles: uniqueStringList(selectedResults.flatMap((result) => [
      candidate.originalTitle,
      ...(candidate.alternativeTitles ?? []),
      result.originalTitle,
      ...(result.alternativeTitles ?? []),
    ])),
    synopsis: primaryResult?.synopsis ?? primaryOption.synopsis ?? undefined,
    coverUrl: primaryResult?.coverUrl ?? primaryOption.coverUrl ?? undefined,
    year: primaryResult?.year ?? primaryOption.year ?? undefined,
    yearEnd: primaryResult?.yearEnd,
    publicationStatus: primaryResult?.publicationStatus,
    chapters: primaryResult?.chapters ?? primaryOption.chapters ?? undefined,
    score: primaryResult?.score,
    genres: uniqueStringList(selectedResults.flatMap((result) => result.genres ?? [])),
    sources: selectedSources,
    sourceResults: selectedResults,
    sourceCandidates: selectedOptions,
    trustedSources: selectedOptions
      .filter((option) => option.trusted)
      .map((option) => option.source),
    matchScore: Math.max(...selectedOptions.map((option) => option.matchScore)),
  }

  for (const option of selectedOptions) applySelectedId(next, option)
  return next
}

export function ExternalSearch({
  titleQuery,
  onSelect,
  onDuplicateUpdate,
  searchButtonRef,
  evaluateAi = true,
  checkDuplicates = true,
}: ExternalSearchProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [candidates, setCandidates] = useState<MergedCandidate[]>([])
  const [pendingData, setPendingData] = useState<ExternalWorkData | null>(null)
  const [conflicts, setConflicts] = useState<ConflictField[]>([])
  const [resolutions, setResolutions] = useState<Record<string, unknown>>({})
  const [duplicates, setDuplicates] = useState<ExistingWorkMatch[]>([])
  const [pendingCandidate, setPendingCandidate] = useState<MergedCandidate | null>(null)
  const [duplicateUpdateTarget, setDuplicateUpdateTarget] = useState<ExistingWorkMatch | null>(null)
  const [sourceSelection, setSourceSelection] = useState<Partial<Record<ExternalSourceId, SourceSelectionValue>>>({})
  const [coverChoices, setCoverChoices] = useState<CoverChoice[]>([])
  const [synopsisChoices, setSynopsisChoices] = useState<SynopsisChoice[]>([])

  const handleSearch = async () => {
    if (!titleQuery.trim()) return
    setIsOpen(true)
    setPhase("searching")
    setCandidates([])
    setDuplicateUpdateTarget(null)
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
    const groups = getSourceMatchGroups(candidate)
    if (groups.length > 0) {
      setSourceSelection(buildInitialSourceSelection(candidate))
      setPhase("sourcepick")
      return
    }
    await startCandidateImport(candidate)
  }

  const startCandidateImport = async (candidate: MergedCandidate) => {
    setPendingCandidate(candidate)
    setPhase("loading")
    if (checkDuplicates) {
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
    }
    await proceedWithCandidate(candidate)
  }

  const handleConfirmSourceSelection = async () => {
    if (!pendingCandidate) return
    const selectedCandidate = buildCandidateFromSourceSelection(pendingCandidate, sourceSelection)
    if (!selectedCandidate) return
    await startCandidateImport(selectedCandidate)
  }

  const handleProceedDespiteDuplicate = async () => {
    if (!pendingCandidate) {
      handleClose()
      return
    }
    setDuplicates([])
    setDuplicateUpdateTarget(null)
    setPhase("loading")
    await proceedWithCandidate(pendingCandidate)
  }

  const handleUseDuplicateForUpdate = async (match: ExistingWorkMatch) => {
    if (!pendingCandidate) {
      handleClose()
      return
    }
    setDuplicateUpdateTarget(match)
    setDuplicates([])
    setPhase("loading")
    await proceedWithCandidate(pendingCandidate, match)
  }

  const finalizeSelection = async (data: ExternalWorkData, updateTarget = duplicateUpdateTarget) => {
    const merged: ExternalWorkData = { ...data }
    if (evaluateAi) {
      setPhase("evaluating")
      try {
        const aiResult = await evaluateCandidateForCreate({
          title: merged.title,
          originalTitle: merged.originalTitle ?? null,
          alternativeTitles: merged.alternativeTitles ?? null,
          synopsis: merged.synopsis ?? null,
          genres: merged.genres,
          tags: merged.tags,
          coverUrl: merged.coverUrl ?? merged.multiCovers?.[0]?.url ?? null,
          externalIds: merged.externalIds,
          externalContext: merged.synopsis?.trim() ? [] : undefined,
        })
        if (aiResult) {
          merged.criteriaScores = aiResult.scores
          merged.criteriaJustifications = aiResult.justifications
          merged.aiMeta = {
            inputHash: aiResult.inputHash,
            modelName: aiResult.modelName,
            promptVersion: aiResult.promptVersion,
          }
        }
      } catch (error) {
        console.error("[ExternalSearch] evaluateCandidateForCreate failed", error)
      }
    }

    if (updateTarget && onDuplicateUpdate) {
      await onDuplicateUpdate(updateTarget, merged)
    } else {
      onSelect(merged)
    }
    setIsOpen(false)
    setPhase("idle")
    setPendingCandidate(null)
    setDuplicateUpdateTarget(null)
    setSourceSelection({})
    setPendingData(null)
    setConflicts([])
    setCoverChoices([])
    setSynopsisChoices([])
  }

  const proceedWithCandidate = async (candidate: MergedCandidate, updateTarget?: ExistingWorkMatch | null) => {
    try {
      const wantsComicK = candidate.sources.includes("comick") || Boolean(candidate.comickHid)
      const wantsAnimePlanet = candidate.sources.includes("animeplanet") || Boolean(candidate.animePlanetSlug)
      const [serverResult, cmxResult, apResult] = await Promise.allSettled([
        fetchExternalData(candidate),
        wantsComicK ? fetchComicKClient(candidate.title, candidate.comickHid) : Promise.resolve(null),
        wantsAnimePlanet ? fetchAnimePlanetClient(candidate.title, candidate.animePlanetSlug) : Promise.resolve(null),
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
        if (candidate.comickHid) {
          merged.externalIds = { ...merged.externalIds, comick: candidate.comickHid }
        }
      }

      const ap = apResult.status === "fulfilled" ? apResult.value : null
      if (ap) {
        if (ap.rating != null) merged.apRating = ap.rating
        if (ap.votes != null) merged.apVotes = ap.votes
      }
      if (candidate.animePlanetSlug) {
        merged.externalIds = { ...merged.externalIds, animeplanet: candidate.animePlanetSlug }
      }

      const allConflicts = result.conflicts.filter(c => c.field !== "totalChapters" || cmx?.chapters == null)

      if (merged.tags.length > 0) {
        upsertExternalTags(merged.tags).catch(() => {})
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
        await finalizeSelection(merged, updateTarget)
      }
    } catch (error) {
      console.error("[ExternalSearch] proceedWithCandidate failed", error)
      setPhase("results")
    }
  }

  const handleConfirmMultiPick = async () => {
    if (!pendingData) return
    const includedCovers = coverChoices.filter((c) => c.included)
    const primaryCover = includedCovers.find((c) => c.isPrimary) ?? includedCovers[0]
    const includedSynopses = synopsisChoices.filter((s) => s.included)
    const primarySynopsis = includedSynopses.find((s) => s.isPrimary) ?? includedSynopses[0]
    const orderedSynopses = primarySynopsis
      ? [primarySynopsis, ...includedSynopses.filter((s) => s !== primarySynopsis)]
      : includedSynopses
    const selectedSynopses = dedupeSynopsisEntries(orderedSynopses)

    const next: ExternalWorkData = {
      ...pendingData,
      coverUrl: primaryCover?.url ?? pendingData.coverUrl,
      multiCovers: includedCovers.map((c) => ({ url: c.url, source: c.source as ExternalSourceId })),
      synopsis: selectedSynopses.find((s) => s.isPrimary)?.text ?? selectedSynopses[0]?.text ?? pendingData.synopsis,
      multiSynopses: selectedSynopses.map((s) => ({ source: s.source as ExternalSourceId, text: s.text })),
      synopsisIsMerged: false,
    }

    if (conflicts.length > 0) {
      setPendingData(next)
      setPhase("conflicts")
    } else {
      await finalizeSelection(next)
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

  const handleConfirmConflicts = async () => {
    if (!pendingData) return
    const finalData: ExternalWorkData = { ...pendingData }
    for (const [field, value] of Object.entries(resolutions)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(finalData as any)[field] = value
    }
    await finalizeSelection(finalData)
  }

  const handleClose = () => {
    setIsOpen(false)
    setPhase("idle")
    setDuplicates([])
    setPendingCandidate(null)
    setDuplicateUpdateTarget(null)
    setSourceSelection({})
    setPendingData(null)
    setConflicts([])
    setCoverChoices([])
    setSynopsisChoices([])
  }

  const sourceMatchGroups = pendingCandidate ? getSourceMatchGroups(pendingCandidate) : []
  const hasSelectedSource = sourceMatchGroups.some((group) => {
    const value = sourceSelection[group.source]
    return Boolean(value && value !== "rejected" && value !== "none")
  })
  const setSourceMatchSelection = (source: ExternalSourceId, value: SourceSelectionValue) => {
    setSourceSelection((prev) => ({ ...prev, [source]: value }))
  }

  return (
    <>
      <Button
        ref={searchButtonRef}
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
                  Ao selecionar, você confere quais fontes entram na busca antes de mesclar os dados.
                </p>
              </div>
            )
          )}

          {phase === "sourcepick" && pendingCandidate && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Confirme ou troque os matches por fonte antes de buscar e mesclar os dados.
              </p>

              {sourceMatchGroups.map((group) => {
                const value = sourceSelection[group.source] ?? "none"
                return (
                  <div key={group.source} className="rounded-md border p-3 space-y-2">
                    <p className="text-sm font-medium">{getSourceLabel(group.source)}</p>
                    {group.options.map((option) => {
                      const checked = value === option.externalId
                      return (
                        <label
                          key={`${group.source}-${option.externalId}`}
                          className={`flex items-start gap-3 rounded-md border p-2 cursor-pointer transition-colors ${
                            checked ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                          }`}
                        >
                          <input
                            type="radio"
                            name={`source-${group.source}`}
                            checked={checked}
                            onChange={() => setSourceMatchSelection(group.source, option.externalId)}
                            className="mt-1.5 accent-primary"
                          />
                          <div className="h-16 w-12 shrink-0 overflow-hidden rounded border bg-muted">
                            {option.coverUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={getCoverImageSrc(option.coverUrl)}
                                alt=""
                                className="h-full w-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                <Search className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium">{option.title}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              match {Math.round(option.matchScore * 100)}%
                              {option.year ? ` · ${option.year}` : ""}
                              {option.chapters ? ` · ${option.chapters} cap.` : ""}
                            </p>
                          </div>
                        </label>
                      )
                    })}
                    <label
                      className={`flex items-center gap-3 rounded-md border p-2 cursor-pointer transition-colors ${
                        value === "rejected" ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30" : "hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`source-${group.source}`}
                        checked={value === "rejected"}
                        onChange={() => setSourceMatchSelection(group.source, "rejected")}
                        className="accent-primary"
                      />
                      <span className="text-xs">Nenhum match válido — ignorar esta fonte</span>
                    </label>
                    <label
                      className={`flex items-center gap-3 rounded-md border p-2 cursor-pointer transition-colors ${
                        value === "none" ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : "hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`source-${group.source}`}
                        checked={value === "none"}
                        onChange={() => setSourceMatchSelection(group.source, "none")}
                        className="accent-primary"
                      />
                      <span className="text-xs">Não decidir agora (refazer busca depois)</span>
                    </label>
                  </div>
                )
              })}

              <Separator />
              <div className="flex gap-2 justify-end pb-2">
                <Button type="button" variant="outline" onClick={() => setPhase("results")}>
                  Voltar
                </Button>
                <Button type="button" onClick={handleConfirmSourceSelection} disabled={!hasSelectedSource}>
                  Buscar dados dessas fontes
                </Button>
              </div>
            </div>
          )}

          {(phase === "loading" || phase === "evaluating") && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <div className="text-center">
                <p className="font-medium text-sm">
                  {phase === "evaluating"
                    ? "Avaliando critérios com IA..."
                    : duplicateUpdateTarget
                      ? "Buscando dados para atualizar..."
                      : "Buscando dados externos..."}
                </p>
                {phase === "loading" ? (
                  <p className="text-xs mt-1">
                    {pendingCandidate?.sources.length
                      ? pendingCandidate.sources.map(getSourceLabel).join(" · ")
                      : "AniList · MangaUpdates · ComicK · AnimePlanet · Comix · Kitsu · MangaDex · MAL"}
                  </p>
                ) : (
                  <p className="text-xs mt-1 text-muted-foreground">
                    Usando os dados que você confirmou para preencher as notas iniciais.
                  </p>
                )}
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
                  <div
                    key={dup.id}
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
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {dup.matchType === "exact_title" && "título exato"}
                        {dup.matchType === "original_title" && "título original"}
                        {dup.matchType === "exact_alt" && "alt exato"}
                        {dup.matchType === "fuzzy" && `fuzzy ${Math.round(dup.similarity * 100)}%`}
                      </Badge>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" asChild>
                          <a href={`/titles/${dup.id}`} target="_blank" rel="noreferrer">
                            Ver
                          </a>
                        </Button>
                        {onDuplicateUpdate && (
                          <Button type="button" size="sm" onClick={() => handleUseDuplicateForUpdate(dup)}>
                            Atualizar esta obra
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
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
                          src={getCoverImageSrc(cover.url)}
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
      <div className="h-28 w-20 rounded overflow-hidden bg-muted shrink-0">
        {candidate.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getCoverImageSrc(candidate.coverUrl)}
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
