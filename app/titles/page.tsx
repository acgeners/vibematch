import Link from "next/link"
import { Plus } from "lucide-react"
import { getWorks } from "@/server/queries/works"
import { Header } from "@/components/layout/header"
import { WorkFilters } from "@/components/titles/work-filters"
import { WorkTable } from "@/components/titles/work-table"
import { Button } from "@/components/ui/button"
import type { WorkFilters as WorkFiltersType, PublicationStatus, PersonalStatus, AiEvalStatus } from "@/types/domain"
import { createAdminClient } from "@/lib/supabase/admin"
import { GENRE_TAG_GROUP_ID } from "@/lib/constants/tag-groups"
import { unstable_cache } from "next/cache"

interface TitlesPageProps {
  searchParams: Promise<{
    search?: string
    pub?: string | string[]
    personal?: string | string[]
    ai?: string | string[]
    archived?: string
    page?: string
    sort?: string
    min_score?: string
    max_score?: string
    min_chapters?: string
    max_chapters?: string
    genre?: string
    tag?: string | string[]
  }>
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function parseSort(raw: string | undefined): import("@/types/domain").WorkSort {
  const [field, dir] = (raw ?? "final_score:desc").split(":")
  const validFields = [
    "final_score",
    "calc_score",
    "predicted_score",
    "title",
    "publication_status",
    "personal_status",
    "total_chapters",
    "ai_eval_status",
    "updated_at",
    "created_at",
  ]
  return {
    field: (validFields.includes(field) ? field : "final_score") as import("@/types/domain").WorkSortField,
    direction: dir === "asc" ? "asc" : "desc",
  }
}

const getGenreOptions = unstable_cache(async (): Promise<string[]> => {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("tags")
    .select("name")
    .eq("tag_group_id", GENRE_TAG_GROUP_ID)
    .order("name")
    .limit(1000)

  return (data ?? []).map((row) => row.name).filter(Boolean)
}, ["titles-genre-tags-v1"], { revalidate: 300 })

export default async function TitlesPage({ searchParams }: TitlesPageProps) {
  const params = await searchParams

  const page = Math.max(1, parseInt(params.page ?? "1", 10))
  const pageSize = 50

  const filters: WorkFiltersType = {
    search: params.search,
    publicationStatus: toArray(params.pub) as PublicationStatus[],
    personalStatus: toArray(params.personal) as PersonalStatus[],
    aiEvalStatus: toArray(params.ai) as AiEvalStatus[],
    isArchived: params.archived === "1" ? undefined : false,
    minFinalScore: params.min_score ? parseFloat(params.min_score) : undefined,
    maxFinalScore: params.max_score ? parseFloat(params.max_score) : undefined,
    minChapters: params.min_chapters ? parseInt(params.min_chapters, 10) : undefined,
    maxChapters: params.max_chapters ? parseInt(params.max_chapters, 10) : undefined,
    genres: params.genre ? [params.genre] : undefined,
    tagSlugs: toArray(params.tag).length ? toArray(params.tag) : undefined,
  }

  const [result, genreOptions] = await Promise.all([
    getWorks(filters, parseSort(params.sort), page, pageSize),
    getGenreOptions(),
  ])

  return (
    <div className="space-y-4">
      <Header
        title="Títulos"
        description={`${result.total} obra${result.total !== 1 ? "s" : ""} no catálogo`}
        actions={
          <Button asChild size="sm">
            <Link href="/titles/new">
              <Plus className="h-4 w-4 mr-1" />
              Novo título
            </Link>
          </Button>
        }
      />

      <WorkFilters availableGenres={genreOptions} />

      <WorkTable
        works={result.data}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
      />
    </div>
  )
}
