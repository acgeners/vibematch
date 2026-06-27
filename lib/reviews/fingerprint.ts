import { createHash } from "node:crypto"

/**
 * Fingerprint determinístico do CONTEÚDO de um pool de reviews. Estável à ordem
 * (ordena) e independente de timestamps — muda só quando texto/fonte/nota mudam.
 * Usado pra detectar mudança real do pool (e marcar a avaliação IA desatualizada)
 * sem falso positivo em re-fetch idêntico.
 */
export function reviewsFingerprint(
  rows: Array<{ text?: string | null; source?: string | null; userRating?: number | null }>,
): string {
  const norm = rows
    .map((r) => `${r.source ?? ""}|${r.userRating ?? ""}|${String(r.text ?? "").trim()}`)
    .filter((s) => String(s).replace(/^\|+/, "").replace(/\|/g, "").trim().length > 0)
    .sort()
  return createHash("sha256").update(norm.join("\n")).digest("hex")
}
