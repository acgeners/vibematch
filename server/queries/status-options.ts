import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { PERSONAL_STATUSES, PUBLICATION_STATUSES } from "@/types/domain"
import {
  PERSONAL_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
} from "@/lib/constants/criteria"

export interface StatusOption {
  id: number
  status: string
  slug: string
  color: string | null
  symbol: string | null
  comment: string | null
}

function mergeStatusOptions(fallbacks: StatusOption[], dbRows: StatusOption[] | null | undefined) {
  const rows = dbRows ?? []
  if (rows.length === 0) return fallbacks
  const byStatus = new Map<string, StatusOption>()
  for (const row of rows) byStatus.set(row.status, row)
  return [...byStatus.values()]
}

export const getStatusOptions = unstable_cache(
  async () => {
    const supabase = createAdminClient()
    const [{ data: pubData }, { data: perData }] = await Promise.all([
      supabase.from("publication_status").select("id, status, slug, color, symbol").order("id"),
      supabase.from("personal_status").select("id, status, slug, color, symbol, comment").order("id"),
    ])
    const publicationFallbacks: StatusOption[] = PUBLICATION_STATUSES.map((status, index) => ({
      id: index + 1,
      status: PUBLICATION_STATUS_LABELS[status] ?? status,
      slug: status.toLowerCase(),
      color: null,
      symbol: null,
      comment: null,
    }))
    const personalFallbacks: StatusOption[] = PERSONAL_STATUSES.map((status, index) => ({
      id: index + 1,
      status: PERSONAL_STATUS_LABELS[status] ?? status,
      slug: status.toLowerCase().replaceAll(" ", "-"),
      color: null,
      symbol: null,
      comment: null,
    }))
    return {
      publicationStatuses: mergeStatusOptions(publicationFallbacks, pubData as StatusOption[] | null),
      personalStatuses: mergeStatusOptions(personalFallbacks, perData as StatusOption[] | null),
    }
  },
  ["all-status-options-v1"],
  { revalidate: 300 }
)
