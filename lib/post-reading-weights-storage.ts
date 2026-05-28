import {
  DEFAULT_POST_READING_WEIGHTS,
  POST_READING_WEIGHT_STORAGE_KEY,
  type PostReadingScoreField,
} from "@/lib/constants/post-reading-criteria"

export type PostReadingWeights = Record<PostReadingScoreField, number>

export const POST_READING_WEIGHTS_CHANGED_EVENT = "post-reading-weights-changed"

export function readStoredPostReadingWeights(): PostReadingWeights {
  if (typeof window === "undefined") return { ...DEFAULT_POST_READING_WEIGHTS }

  const stored = window.localStorage.getItem(POST_READING_WEIGHT_STORAGE_KEY)
  if (!stored) return { ...DEFAULT_POST_READING_WEIGHTS }

  try {
    const parsed = JSON.parse(stored) as Partial<PostReadingWeights>
    return {
      ...DEFAULT_POST_READING_WEIGHTS,
      ...Object.fromEntries(
        Object.entries(parsed).filter(
          ([, value]) => typeof value === "number" && Number.isFinite(value),
        ),
      ),
    } as PostReadingWeights
  } catch {
    return { ...DEFAULT_POST_READING_WEIGHTS }
  }
}

export function writeStoredPostReadingWeights(weights: PostReadingWeights): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(POST_READING_WEIGHT_STORAGE_KEY, JSON.stringify(weights))
  window.dispatchEvent(new CustomEvent(POST_READING_WEIGHTS_CHANGED_EVENT))
}
