import type { CriterionSlug } from "@/types/domain"

/**
 * Preset de "mood" — bias momentâneo aplicado tanto no formulário de
 * recomendação (vira texto pro LLM) quanto no ranking (filtros + sort
 * temporários via query param ?mood=ID, não persiste entre sessões).
 *
 * `userContextSnippet` é injetado no campo userContext do run-creator-form;
 * `criterionMin/Max` viram filtros de range no ranking; `sortField` (opcional)
 * sobrescreve o sort default pra esse modo.
 */
export interface MoodPreset {
  id: string
  emoji: string
  label: string
  description: string
  userContextSnippet: string
  criterionMin?: Partial<Record<CriterionSlug, number>>
  criterionMax?: Partial<Record<CriterionSlug, number>>
  sortField?: CriterionSlug
}

export const MOOD_PRESETS: MoodPreset[] = [
  {
    id: "leve",
    emoji: "🌿",
    label: "Leve",
    description: "Algo mais leve, com humor, sem peso emocional",
    userContextSnippet: "quero algo leve hoje, com humor, evitando drama denso e tragédia",
    criterionMax: { drama: 5, tragedy: 3 },
    criterionMin: { humor: 6 },
    sortField: "humor",
  },
  {
    id: "denso",
    emoji: "🎭",
    label: "Denso",
    description: "Drama forte, protagonista marcante, peso emocional",
    userContextSnippet: "mood pra algo denso, drama profundo, com protagonistas marcantes",
    criterionMin: { drama: 7, protagonist: 7 },
    sortField: "drama",
  },
  {
    id: "acao",
    emoji: "⚔️",
    label: "Ação",
    description: "Aventura, conflito externo, ritmo alto",
    userContextSnippet: "quero ação, aventura, conflito externo, ritmo alto",
    criterionMin: { action_adventure: 7 },
    sortField: "action_adventure",
  },
  {
    id: "romance",
    emoji: "💞",
    label: "Romance",
    description: "Romance no centro, com química e dinâmica do casal",
    userContextSnippet: "foco em romance, com dinâmica de casal envolvente",
    criterionMin: { romance: 7, couple_dynamics: 6 },
    sortField: "romance",
  },
  {
    id: "comedia",
    emoji: "😂",
    label: "Comédia",
    description: "Humor em primeiro plano, leveza, situações engraçadas",
    userContextSnippet: "humor forte, leve e divertido, sem peso de drama",
    criterionMin: { humor: 7 },
    criterionMax: { drama: 4, tragedy: 3 },
    sortField: "humor",
  },
  {
    id: "surpresa",
    emoji: "🎲",
    label: "Surpreenda-me",
    description: "Sorteia uma obra do topo do ranking filtrado",
    userContextSnippet: "",
  },
]

export const MOOD_PRESETS_BY_ID: Record<string, MoodPreset> = Object.fromEntries(
  MOOD_PRESETS.map((p) => [p.id, p])
)
