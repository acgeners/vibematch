/**
 * Deduplicação de reviews — a régua de "é a mesma review" do prompt de avaliação.
 *
 * Mora fora do `service.ts` para o apêndice de Arte (`art-appendix.ts`) usar EXATAMENTE a mesma
 * régua sem import circular: "já está nas reviews principais" tem de significar o mesmo para o
 * prompt e para o apêndice.
 */

export function reviewTextFingerprint(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 4)
  )
}

export function jaccardReviews(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const intersection = [...a].filter((w) => b.has(w)).length
  return intersection / new Set([...a, ...b]).size
}

export function deduplicateReviews<T extends { text: string }>(reviews: T[]): T[] {
  const fingerprints: Array<Set<string>> = []
  const shortKeys = new Set<string>()
  return reviews.filter((r) => {
    const fp = reviewTextFingerprint(r.text)
    if (fp.size < 4) {
      const key = r.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60)
      if (shortKeys.has(key)) return false
      shortKeys.add(key)
      fingerprints.push(fp)
      return true
    }
    const isDup = fingerprints.some((existing) => jaccardReviews(fp, existing) >= 0.75)
    if (!isDup) {
      fingerprints.push(fp)
      return true
    }
    return false
  })
}
