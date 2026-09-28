/**
 * FANTASY DE TRANSIÇÃO — o valor que o SLOT `fantasy` do cálculo usa enquanto o catálogo migra
 * do construto misto `fantasy_nobility` para o `fantasy` puro. Dono único da regra.
 *
 * ── O PROBLEMA QUE ELA RESOLVE ────────────────────────────────────────────────────────────────
 *
 * Desde a migration 198 o slot `fantasy` de `SCORING_CRITERION_SLUGS` lê `category_scores.fantasy`,
 * e essa linha tem DUAS réguas no catálogo: ~979 obras com `legacy_split_copy` (cópia do
 * `fantasy_nobility`, que media fantasia + nobreza/corte) e as poucas reavaliadas pelo producer de
 * 11 com `fantasy` REAL (Fantasy puro — em média ~3,6 pontos abaixo do legado da mesma obra).
 * Uma feature do Ridge com duas escalas: o coeficiente é aprendido na mistura.
 *
 * Medido em 2026-09-28 (harness read-only, 231 rotuladas, 20 delas com `fantasy` real): o híbrido
 * dá cvMAE OOF 0,707 e o slot uniforme (legado sempre que existir) dá 0,684 — Δ −0,023, IC95%
 * bootstrap pareado [−0,044; −0,003]. O canal dominante é a feature direta no Ridge; `IA(n)`,
 * `criterionFit` e a reinferência de pesos somam por cima.
 *
 * ⚠️ Isto NÃO contradiz a medição de 2026-09-22 em `scoring-features.ts` ("trocar o CONTEÚDO do
 * slot não tem dano demonstrável"): aquela perguntava se o conteúdo real é pior que valores
 * sorteados; esta pergunta se MISTURAR duas escalas numa feature custa. Custa — e o conserto é
 * uniformizar a escala, não julgar o conteúdo novo.
 *
 * ── A REGRA ────────────────────────────────────────────────────────────────────────────────────
 *
 *   `fantasy_nobility` (legado) com nota  → usa o legado          · "fantasy_nobility_legacy"
 *   senão `fantasy` com nota              → usa o fantasy real    · "fantasy_real_fallback"
 *   senão                                 → slot AUSENTE          · "absent"
 *
 * ⚠️ O valor legado entra CRU, sem bias. As 979 cópias já entravam assim (origem
 * `legacy_split_copy` não recebe bias), e o bias de `fantasy` é aprendido sobre o construto puro —
 * aplicá-lo ao misto seria misturar régua de novo. O fallback real segue calibrado como sempre.
 *
 * ⚠️ Ausência é AUSÊNCIA: nenhum default. A guarda de completude do cálculo (`expected_score`
 * exige os 9 slots) continua decidindo com a mesma semântica de antes.
 *
 * ── O QUE ELA NÃO FAZ ──────────────────────────────────────────────────────────────────────────
 *
 * Não grava nada. `category_scores.fantasy` (o dado semântico da obra, mostrado na UI e produzido
 * pelo producer) fica intacto; `fantasy_nobility` segue `eval_type='Legado'` e fora do producer.
 * O slug do slot continua `fantasy` — só o VALOR que o cálculo lê muda.
 *
 * Temporária: sai quando as obras que ensinam o modelo (as rotuladas) tiverem `fantasy` real e a
 * régua única do slot passar a ser a nova.
 */

export const FANTASY_SCORING_SLOT = "fantasy" as const
export const FANTASY_LEGACY_SLUG = "fantasy_nobility" as const

export type FantasyScoringSource = "fantasy_nobility_legacy" | "fantasy_real_fallback" | "absent"

export interface TransitionalFantasy {
  /** Valor que o slot `fantasy` do cálculo usa. `null` ⇔ `source === "absent"`. */
  value: number | null
  source: FantasyScoringSource
}

function score(rows: ReadonlyArray<{ criterion_slug: string; score: unknown }>, slug: string): number | null {
  const row = rows.find((r) => r.criterion_slug === slug)
  if (row == null || row.score == null || row.score === "") return null
  const n = Number(row.score)
  return Number.isFinite(n) ? n : null
}

/** Escolhe o valor do slot `fantasy` a partir das linhas de `category_scores` da obra. Pura. */
export function resolveTransitionalFantasy(
  rows: ReadonlyArray<{ criterion_slug: string; score: unknown }>,
): TransitionalFantasy {
  const legacy = score(rows, FANTASY_LEGACY_SLUG)
  if (legacy != null) return { value: legacy, source: "fantasy_nobility_legacy" }
  const real = score(rows, FANTASY_SCORING_SLOT)
  if (real != null) return { value: real, source: "fantasy_real_fallback" }
  return { value: null, source: "absent" }
}

/**
 * Aplica a escolha aos DOIS mapas do cálculo (cru e calibrado), já montados. Muta só os mapas
 * em memória que recebe — nunca as linhas de origem.
 *
 * No fallback os mapas já trazem o `fantasy` real (e o calibrado já tem o bias dele), então não
 * há o que trocar; no legado os dois recebem o valor cru.
 */
export function applyTransitionalFantasy(
  maps: { raw: Record<string, number>; calibrated: Record<string, number> },
  choice: TransitionalFantasy,
): void {
  if (choice.source !== "fantasy_nobility_legacy" || choice.value == null) return
  maps.raw[FANTASY_SCORING_SLOT] = choice.value
  maps.calibrated[FANTASY_SCORING_SLOT] = choice.value
}
