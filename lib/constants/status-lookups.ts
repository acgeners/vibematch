import {
  PUBLICATION_STATUSES_BY_ID,
  PERSONAL_STATUSES_BY_ID,
  PUBLICATION_STATUS_LABELS,
  PERSONAL_STATUS_LABELS,
} from "./criteria"

const PUBLICATION_BY_NAME = new Map<string, number>(
  Object.values(PUBLICATION_STATUSES_BY_ID).map((info) => [info.status, info.id])
)

const PERSONAL_BY_NAME = new Map<string, number>(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info.id])
)

export function getPublicationStatusIdByName(
  name: string | null | undefined
): number | null {
  if (!name) return null
  const canonical = PUBLICATION_STATUS_LABELS[name] ?? name
  return PUBLICATION_BY_NAME.get(canonical) ?? null
}

export function getPersonalStatusIdByName(
  name: string | null | undefined
): number | null {
  if (!name) return null
  const canonical = PERSONAL_STATUS_LABELS[name] ?? name
  return PERSONAL_BY_NAME.get(canonical) ?? null
}

export function getPublicationStatusNameById(
  id: number | null | undefined
): string | null {
  if (id == null) return null
  return PUBLICATION_STATUSES_BY_ID[id]?.status ?? null
}

export function getPersonalStatusNameById(
  id: number | null | undefined
): string | null {
  if (id == null) return null
  return PERSONAL_STATUSES_BY_ID[id]?.status ?? null
}
