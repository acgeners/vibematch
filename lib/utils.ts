import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "untitled"
}

// Canonical kebab-case slug for tag names. Used by every tag ingestion path
// so we don't end up with both `abandoned_protagonist` and `abandoned-protagonist`.
// Returns "" when the input has no alphanumeric content — callers filter those out.
export function slugifyTagName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export function readingProgressPercent(
  read: number | null | undefined,
  total: number | null | undefined,
): number | null {
  if (read == null || total == null || total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((read / total) * 100)))
}
