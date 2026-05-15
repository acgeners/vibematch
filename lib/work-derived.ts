interface WorkSynopsisRow {
  text?: string | null
  is_primary?: boolean | null
  position?: number | null
}

interface WorkCoverRow {
  url?: string | null
  is_primary?: boolean | null
  position?: number | null
}

/** Sinopse "primária" para list/detail. Prefere is_primary=true; senão menor position. */
export function pickPrimarySynopsis(rows: WorkSynopsisRow[] | null | undefined): string | null {
  if (!rows?.length) return null
  const sorted = [...rows].sort((a, b) => {
    if (a.is_primary === b.is_primary) return (a.position ?? 0) - (b.position ?? 0)
    return a.is_primary ? -1 : 1
  })
  const text = sorted[0]?.text?.trim()
  return text ? text : null
}

/** Capa "primária" para list/detail. Prefere is_primary=true; senão menor position. */
export function pickPrimaryCover(rows: WorkCoverRow[] | null | undefined): string | null {
  if (!rows?.length) return null
  const sorted = [...rows].sort((a, b) => {
    if (a.is_primary === b.is_primary) return (a.position ?? 0) - (b.position ?? 0)
    return a.is_primary ? -1 : 1
  })
  return sorted[0]?.url ?? null
}
