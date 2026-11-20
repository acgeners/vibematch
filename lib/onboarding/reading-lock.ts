import { canRateReadingState, firstRatableChapter, MIN_READ_PCT_FOR_RATING } from "@/lib/reading-gate"
import { readingPersonalStatusName } from "@/lib/constants/status-lookups"

/** "Como foi a leitura" na tela de notas (boas-vindas e "Dar notas"). */
export type ReadingKind = "terminei" | "larguei" | "lendo"

/**
 * A escala de nota fica travada? Só em "Estou lendo" com o capítulo PREENCHIDO e abaixo do limiar
 * (decisão de 19/11/2026: em branco libera). Quem decide é `canRateReadingState` — a mesma regra que
 * a nota rápida aplica no servidor —, nunca uma conta à parte aqui.
 */
export function readingLock(
  kind: ReadingKind,
  chapters: number | null,
  totalChapters: number | null,
): { locked: boolean; text: string | null } {
  if (kind !== "lendo" || chapters == null) return { locked: false, text: null }
  const canRate = canRateReadingState({
    personalStatus: readingPersonalStatusName(),
    chaptersRead: chapters,
    totalChapters,
  })
  if (canRate) return { locked: false, text: null }
  const first = firstRatableChapter(totalChapters)
  return {
    locked: true,
    text:
      first != null
        ? `Dá para dar nota a partir do cap. ${first} (${MIN_READ_PCT_FOR_RATING}%).`
        : "Sem o total de capítulos da obra, a nota só vale com o capítulo em branco.",
  }
}
