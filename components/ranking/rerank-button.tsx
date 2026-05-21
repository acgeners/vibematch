"use client"

import { useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { rerankTopNAction } from "@/server/actions/recommendations"
import { CRITERION_SLUGS } from "@/types/domain"
import type { RankingFilters } from "@/server/queries/ranking"

interface RerankButtonProps {
  /** Quantos top-N do ranking atual rankear. Max 50. */
  topN?: number
}

function parseFiltersFromSearchParams(sp: URLSearchParams): RankingFilters {
  const num = (key: string) => {
    const v = sp.get(key)
    if (!v) return undefined
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : undefined
  }
  const multi = (key: string) => {
    const v = sp.get(key)
    if (!v) return undefined
    return v.split(",").map((s) => s.trim()).filter(Boolean)
  }

  const criterionMin: Partial<Record<string, number>> = {}
  const criterionMax: Partial<Record<string, number>> = {}
  for (const slug of CRITERION_SLUGS) {
    const mn = num(`min_${slug}`)
    const mx = num(`max_${slug}`)
    if (mn != null) criterionMin[slug] = mn
    if (mx != null) criterionMax[slug] = mx
  }

  const perStatusParam = sp.get("per_status")
  const personalStatus =
    perStatusParam === "all"
      ? undefined
      : perStatusParam
        ? perStatusParam.split(",").map((s) => s.trim()).filter(Boolean)
        : ["To read"]

  const pubStatusParam = sp.get("pub_status")
  const publicationStatus =
    pubStatusParam === "all"
      ? undefined
      : pubStatusParam
        ? pubStatusParam.split(",").map((s) => s.trim()).filter(Boolean)
        : ["Completed"]

  return {
    criterionMin: Object.keys(criterionMin).length ? criterionMin : undefined,
    criterionMax: Object.keys(criterionMax).length ? criterionMax : undefined,
    publicationStatus,
    personalStatus: personalStatus?.length ? personalStatus : undefined,
    genreAll: multi("genres_all"),
    genreAny: multi("genres_any") ?? multi("genres"),
    genreExclude: multi("genres_exclude"),
    tagSlugsAll: multi("tags_all"),
    tagSlugsAny: multi("tags_any") ?? multi("tags"),
    tagSlugsExclude: multi("tags_exclude"),
    synopsisQualities: multi("synopsis_q"),
    minTotalChapters: num("min_chapters"),
    maxTotalChapters: num("max_chapters"),
    minCalcScore: num("min_calc"),
    maxCalcScore: num("max_calc"),
    minPredictedScore: num("min_pr"),
    maxPredictedScore: num("max_pr"),
    minFinalScore: num("min_final"),
    maxFinalScore: num("max_final"),
    minTotalVotes: num("min_votes"),
    maxTotalVotes: num("max_votes"),
    onlyWithFinalScore: sp.get("only_scored") === "1",
    onlyFavorites: sp.get("fav") === "1",
  }
}

function describeFilters(filters: RankingFilters): string {
  const parts: string[] = []
  if (filters.genreAny?.length) parts.push(`gêneros: ${filters.genreAny.join(", ")}`)
  if (filters.tagSlugsAny?.length) parts.push(`tags: ${filters.tagSlugsAny.join(", ")}`)
  if (filters.publicationStatus?.length)
    parts.push(`pub: ${filters.publicationStatus.join(", ")}`)
  if (filters.personalStatus?.length) parts.push(`status: ${filters.personalStatus.join(", ")}`)
  return parts.length > 0 ? parts.join(" | ") : "sem filtros específicos"
}

export function RerankButton({ topN = 50 }: RerankButtonProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [lastSummary, setLastSummary] = useState<string | null>(null)

  const handleClick = () => {
    const filters = parseFiltersFromSearchParams(new URLSearchParams(searchParams.toString()))
    const modeLabel = describeFilters(filters)

    startTransition(async () => {
      try {
        const result = await rerankTopNAction({
          filters,
          limit: topN,
          modeLabel,
        })
        if (result.error) {
          toast.error(result.error)
          return
        }
        if (result.data) {
          setLastSummary(result.data.modeSummary)
          toast.success(
            `${result.data.entries.length} obras rankeadas. Ordene por "IA Re-rank" pra ver.`,
          )
          router.refresh()
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao rerankear")
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleClick}
        disabled={isPending}
        className="gap-1.5"
      >
        <Sparkles className="h-3.5 w-3.5" />
        {isPending ? "Rerankeando…" : `Rerankear top ${topN} com IA`}
      </Button>
      {lastSummary && (
        <p className="text-[10px] text-muted-foreground max-w-[280px] text-right line-clamp-2">
          {lastSummary}
        </p>
      )}
    </div>
  )
}
