import { titleSimilarityDetailed } from "./title-match"
import type { TitleSimReason } from "./title-match"

/**
 * Scoring de matching ESPECÍFICO do Mangago (wrapper puro sobre
 * `bestTitleMatch`/`titleSimilarityDetailed`, sem alterar o util compartilhado).
 *
 * Por que um wrapper e não `bestTitleMatch` direto:
 *  1. Fix CJK — o Mangago exibe títulos nativos com espaço entre cada caractere
 *     ("呪 術 廻 戦", "나 혼 자 만 레 벨 업"). O `normalizeText` compartilhado NÃO
 *     junta isso e o filtro `w.length > 2` zera tokens de 1 char → score 0 em
 *     todo título nativo. Aqui colapsamos o espaço ENTRE caracteres CJK antes de
 *     comparar, então "呪 術 廻 戦" volta a casar "呪術廻戦" (exato = 1.0).
 *  2. Precisamos saber QUAL lado casou (title vs otherTitle), QUAL variante do
 *     input e QUAL título do candidato — para o desempate e a corroboração do
 *     resolvedor (E4/E5). `bestTitleMatch` só devolve o número.
 *  3. Sinalizamos `isReverseSubstringRisk`: quando o candidato é um substring
 *     curto/genérico do input (ex.: input "Dr. Stone" casa a obra "Stone" com
 *     0.9). O resolvedor NÃO deve auto-aceitar esses sem corroboração.
 *
 * PURO e determinístico — sem I/O. O `slug` do candidato NUNCA entra no score
 * (é só identidade), ele fica aqui apenas por conveniência de quem chama.
 */

export type MangagoMatchKind = "title" | "otherTitle"

export interface MangagoCandidate {
  title: string
  /** Títulos alternativos do resultado ("Other Title"), já separados. */
  otherTitles?: string[]
  /** Só identidade — não influencia o score. */
  slug?: string
}

export interface MangagoScore {
  score: number
  reason: TitleSimReason
  /** Qual lado do candidato casou (null quando score = 0). */
  matchedKind: MangagoMatchKind | null
  /** Qual variante do input (romaji/english/native/…) casou. */
  matchedTarget: string | null
  /** Qual título do candidato (title ou um otherTitle) casou. */
  matchedCandidateTitle: string | null
  /** true quando o candidato é substring curto do input (falso-positivo em potencial). */
  isReverseSubstringRisk: boolean
}

// Faixas Unicode CJK + Hangul + kana (incl. jamo e katakana halfwidth).
const CJK =
  "\\u1100-\\u11ff\\u3040-\\u30ff\\u3130-\\u318f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff\\uff66-\\uff9f"
// Espaço(s) entre dois caracteres CJK → alvo do colapso. Lookahead preserva o
// 2º char como início do próximo match, então "a b c d" colapsa em passada única.
const CJK_JOIN = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, "g")

/** Colapsa espaços ENTRE caracteres CJK; não toca espaços latinos ("Solo Leveling"). */
export function collapseCjkSpaces(value: string): string {
  return value.replace(CJK_JOIN, "$1")
}

const REVERSE_REASONS = new Set<TitleSimReason>([
  "reverse_substring_substantial",
  "reverse_substring_significant",
  "reverse_substring_marginal",
])

function emptyScore(): MangagoScore {
  return {
    score: 0,
    reason: "empty",
    matchedKind: null,
    matchedTarget: null,
    matchedCandidateTitle: null,
    isReverseSubstringRisk: false,
  }
}

export function scoreMangagoCandidate(targets: string[], candidate: MangagoCandidate): MangagoScore {
  const inputs = (targets ?? []).map((t) => (t ?? "").trim()).filter(Boolean)

  const names: Array<{ name: string; kind: MangagoMatchKind }> = [
    { name: candidate.title, kind: "title" },
    ...(candidate.otherTitles ?? []).map((name) => ({ name, kind: "otherTitle" as const })),
  ].filter((c) => c.name && c.name.trim())

  let best = emptyScore()

  for (const target of inputs) {
    const ta = collapseCjkSpaces(target)
    for (const { name, kind } of names) {
      const sim = titleSimilarityDetailed(ta, collapseCjkSpaces(name))
      // Desempate no MESMO score: title vence otherTitle (ex.: One Piece vs
      // One Piece Colored, ambos 1.0 — o com match no title é o canônico).
      const isBetter =
        sim.score > best.score ||
        (sim.score === best.score && kind === "title" && best.matchedKind === "otherTitle")
      if (isBetter) {
        best = {
          score: sim.score,
          reason: sim.reason,
          matchedKind: kind,
          matchedTarget: target,
          matchedCandidateTitle: name,
          isReverseSubstringRisk: REVERSE_REASONS.has(sim.reason),
        }
      }
    }
  }

  return best
}
