import type { CriterionSlug } from "@/types/domain"

/**
 * Preset de "mood" — bias momentâneo aplicado tanto no formulário de
 * recomendação (vira texto pro LLM) quanto no ranking (filtros + sort
 * temporários via query param ?mood=ID, não persiste entre sessões).
 *
 * `userContextSnippet` é injetado no campo userContext do RecommendDialog;
 * `criterionMin/Max` viram filtros de range no ranking; `sortField` (opcional)
 * sobrescreve o sort default pra esse modo.
 *
 * 🔴 A FONTE DE VERDADE dos limiares é `criterionMin/MaxSd`, em σ. Os campos em
 * PONTOS são só o fallback pra quando os momentos do catálogo não puderem ser
 * lidos — e valem a foto de 2026-08-05, então envelhecem.
 *
 * Por que σ: um limiar em pontos não quer dizer a mesma coisa em dois atributos
 * com distribuições diferentes, e os presets apodreciam sozinhos conforme o
 * catálogo crescia. Medido em 2026-08-05 (969 obras) com os valores ANTIGOS,
 * todos em pontos:
 *
 *   Romance (romance≥7, couple≥6)     536 obras — 55% do catálogo
 *   Denso   (drama≥7, protagonist≥7)  446 obras — 46%
 *   Leve                              130 — 13%
 *   Ação    (action≥7)                 53 — 5,5%
 *   Comédia                            34 — 3,5%
 *
 * Dois botões devolviam metade do acervo e dois quase nada. As duas causas
 * apareceram no mesmo preset: `romance ≥ 7` pedia MENOS que a média (7,43),
 * enquanto `couple ≥ 6` era exatamente a média — um número errado e um certo,
 * lado a lado, indistinguíveis a olho. Em σ o limiar diz a mesma coisa nos nove
 * e se recalibra sozinho quando o catálogo muda.
 *
 * ⚠️ σ normaliza a ESCALA, não o FORMATO: as notas vêm em passos de 0,5, então
 * em atributo de σ pequeno o degrau é grosso (protagonista, σ 0,89: `≥+0,5σ`
 * pega 328 obras e `≥+1σ` pega 62). Não existe vocabulário uniforme — cada
 * preset foi calibrado por tamanho de fatia MEDIDO, não por um σ padrão.
 */
export interface MoodPreset {
  id: string
  emoji: string
  label: string
  description: string
  userContextSnippet: string
  /** Fallback em PONTOS (0–10). Só usado quando não há momentos do catálogo. */
  criterionMin?: Partial<Record<CriterionSlug, number>>
  criterionMax?: Partial<Record<CriterionSlug, number>>
  /** Limiar em σ contra a média do catálogo — a fonte de verdade. */
  criterionMinSd?: Partial<Record<CriterionSlug, number>>
  criterionMaxSd?: Partial<Record<CriterionSlug, number>>
  sortField?: CriterionSlug
}

export const MOOD_PRESETS: MoodPreset[] = [
  {
    id: "leve",
    emoji: "🌿",
    label: "Leve",
    description: "Algo mais leve, com humor, sem peso emocional",
    userContextSnippet: "quero algo leve hoje, com humor, evitando drama denso e tragédia",
    // 136 obras (14,0%) — era 130 (13,4%): a única que já estava calibrada.
    criterionMinSd: { humor: 0.5 },
    criterionMaxSd: { drama: -0.5, tragedy: -0.5 },
    criterionMin: { humor: 5.7 },
    criterionMax: { drama: 6, tragedy: 3 },
    sortField: "humor",
  },
  {
    id: "denso",
    emoji: "🎭",
    label: "Denso",
    description: "Drama forte, protagonista marcante, peso emocional",
    userContextSnippet: "mood pra algo denso, drama profundo, com protagonistas marcantes",
    // 102 obras (10,5%) — era 446 (46%). O culpado era `protagonist ≥ 7`, que
    // pedia MENOS que a média (7,21): "protagonista marcante" sem marcar nada.
    criterionMinSd: { drama: 1, protagonist: 0.5 },
    criterionMin: { drama: 8, protagonist: 7.7 },
    sortField: "drama",
  },
  {
    id: "acao",
    emoji: "⚔️",
    label: "Ação",
    description: "Aventura, conflito externo, ritmo alto",
    userContextSnippet: "quero ação, aventura, conflito externo, ritmo alto",
    // 73 obras (7,5%) — era 53 (5,5%). A ÚNICA que afrouxa: ação é o atributo
    // mais raro do acervo (média 4,49), então `≥ 7` valia +1,86σ — um
    // quase-outlier vendido como "quero ação hoje".
    criterionMinSd: { action_adventure: 1.25 },
    criterionMin: { action_adventure: 6.2 },
    sortField: "action_adventure",
  },
  {
    id: "romance",
    emoji: "💞",
    label: "Romance",
    description: "Romance no centro, com química e dinâmica do casal",
    userContextSnippet: "foco em romance, com dinâmica de casal envolvente",
    // 66 obras (6,8%) — era 536 (55%). A fatia mais estreita, de propósito: num
    // acervo 85% romance, este botão só tem sentido se quiser dizer "romance é o
    // centro DESTA obra". `couple ≥ 6` já estava certo (6,0 é a média exata).
    criterionMinSd: { romance: 0.5, couple_dynamics: 0 },
    criterionMin: { romance: 8, couple_dynamics: 6 },
    sortField: "romance",
  },
  {
    id: "comedia",
    emoji: "😂",
    label: "Comédia",
    description: "Humor em primeiro plano, leveza, situações engraçadas",
    userContextSnippet: "humor forte, leve e divertido, sem peso de drama",
    // 56 obras (5,8%) — era 34 (3,5%). Segue sendo subconjunto estrito de Leve,
    // agora 41% dela (era 26%): os dois botões continuam dizendo coisas distintas.
    criterionMinSd: { humor: 1.25 },
    criterionMaxSd: { drama: -0.5, tragedy: -0.5 },
    criterionMin: { humor: 7.2 },
    criterionMax: { drama: 6, tragedy: 3 },
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
