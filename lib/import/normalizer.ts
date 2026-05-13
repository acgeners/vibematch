import type {
  PublicationStatus,
  PersonalStatus,
  SynopsisQuality,
} from "@/types/domain"

export function parseBrazilianNumber(value: unknown): number | null {
  if (value == null) return null
  const str = String(value)
    .trim()
    .replace(",", ".")
    .replace(/[^\d.\-]/g, "")
  if (str === "" || str === "-") return null
  const n = parseFloat(str)
  return isNaN(n) ? null : n
}

export function normalizeScore(value: unknown): number | null {
  const n = parseBrazilianNumber(value)
  if (n == null) return null
  return Math.max(0, Math.min(10, n))
}

export function normalizePublicationStatus(
  value: unknown
): PublicationStatus | null {
  if (value == null) return null
  const s = String(value).trim().toUpperCase()
  const map: Record<string, PublicationStatus> = {
    "C": "Completed",
    "CMP": "Completed",
    "COMPLETED": "Completed",
    "O": "Ongoing",
    "ONG": "Ongoing",
    "ONGOING": "Ongoing",
    "H": "Hiatus",
    "HIA": "Hiatus",
    "HIATUS": "Hiatus",
    "D": "Cancelled",
    "CXL": "Cancelled",
    "CANCELLED": "Cancelled",
    "UNK": "Unknown",
    "UNKNOWN": "Unknown",
  }
  return map[s] ?? null
}

export function normalizePersonalStatus(
  value: unknown
): PersonalStatus | null {
  if (value == null) return null
  const s = String(value).trim().toLowerCase()
  const map: Record<string, PersonalStatus> = {
    "finalizado": "Completed",
    "completed": "Completed",
    "lendo": "Reading",
    "reading": "Reading",
    "pausado": "Started",
    "started": "Started",
    "retomar (tenso)": "Stalled",
    "stalled": "Stalled",
    "retomar": "Paused",
    "paused": "Paused",
    "esp. temp": "Hiatus",
    "hiatus": "Hiatus",
    "lendo (antigo)": "On-hold",
    "on-hold": "On-hold",
    "to read": "To read",
    "droppado": "Dropped",
    "dropped": "Dropped",
  }
  return map[s] ?? null
}

export function normalizeSynopsisQuality(
  value: unknown
): SynopsisQuality | null {
  if (value == null) return null
  const s = String(value).trim()
  const valid: SynopsisQuality[] = ["♥", "♥♥", "♥♥♥", "♥♥♥♥"]
  return valid.includes(s as SynopsisQuality) ? (s as SynopsisQuality) : null
}

export function parseInteger(value: unknown): number | null {
  const n = parseBrazilianNumber(value)
  if (n == null) return null
  return Math.round(n)
}
