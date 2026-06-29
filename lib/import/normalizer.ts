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
    "CMP": "Completed",
    "COMPLETED": "Completed",
    "ONG": "Ongoing",
    "ONGOING": "Ongoing",
    "HIA": "Hiatus",
    "HIATUS": "Hiatus",
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
    "want-to-read": "Want to Read",
    "want to read": "Want to Read",
    "untracked": "Untracked",
    "not_now": "Not Now",
    "not now": "Not Now",
    "reading": "Reading",
    "started": "Started",
    "stalled": "Stalled",
    "on-hold": "On-hold",
    "completed": "Completed",
    "hiatus": "Hiatus",
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
