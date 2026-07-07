import type { ExternalSearchResult } from "./types"

// Utilitários PUROS de normalização + similaridade de título. Extraídos de
// `index.ts` pra serem a fonte única reusada por `searchAllSources`, pelo matcher
// de import (`lib/import/external-list/matcher.ts`) e pela resolução de URL do
// Comix (`comix-resolve.ts`), sem que esses consumidores precisem importar o
// módulo pesado de orquestração `index.ts` (evita ciclo + acoplamento).

export function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    // Remove marcas diacríticas combinantes (U+0300–U+036F).
    .replace(/[̀-ͯ]/g, "")
    // Preserva letras/números de qualquer script (\p{L}/\p{N}) — antes
    // [^a-z0-9] descartava coreano/japonês/chinês, fazendo buscas pelo
    // título original retornarem 0 candidatos.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export type TitleSimReason =
  | "empty"
  | "exact"
  | "forward_substring"
  | "forward_substring_partial"
  | "reverse_substring_substantial"
  | "reverse_substring_significant"
  | "reverse_substring_marginal"
  | "jaccard"
  | "no_words"

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function titleSimilarityDetailed(a: string, b: string): { score: number; reason: TitleSimReason } {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return { score: 0, reason: "empty" }
  if (na === nb) return { score: 1, reason: "exact" }

  // Candidato contém a query — exige (1) que a query apareça como sequência
  // completa de palavras (word boundary) E (2) que não haja palavras extras
  // significativas demais no candidato. Sem isso, "Lucia" casava "Lucian"
  // (substring de palavra) e "Ending Maker" casava "Bad Ending Maker" (frase
  // contida mas com prefixo adjetival que muda a obra).
  if (nb.includes(na)) {
    const naBoundary = new RegExp(`\\b${escapeRegExp(na)}\\b`)
    if (naBoundary.test(nb)) {
      const ratio = na.length / nb.length
      const naWordSet = new Set(na.split(" ").filter((w) => w.length > 2))
      const extraSignificantWords = nb
        .split(" ")
        .filter((w) => w.length > 2 && !naWordSet.has(w)).length
      if (extraSignificantWords === 0 || ratio >= 0.85) {
        return { score: 0.9, reason: "forward_substring" }
      }
      if (extraSignificantWords <= 1 && ratio >= 0.55) {
        return { score: 0.78, reason: "forward_substring_partial" }
      }
      // Muitas palavras extras → cai pro Jaccard abaixo.
    }
    // Sem word boundary (ex.: "lucia" dentro de "lucian"), cai pro Jaccard.
  }

  // Query contém o candidato (reverse substring) — situação onde mais falsos
  // positivos acontecem. Ex.: buscar "The Fake Lady and Her Rabbit Duke" e
  // encontrar "Fake Lady" (obra completamente diferente). Gradua o score pela
  // proporção do candidato dentro da query + palavras significativas.
  if (na.includes(nb)) {
    const ratio = nb.length / na.length
    const shortWords = nb.split(" ").filter((w) => w.length > 2).length
    if (ratio >= 0.6 || shortWords >= 4) return { score: 0.9, reason: "reverse_substring_substantial" }
    if (ratio >= 0.4 || shortWords >= 3) return { score: 0.75, reason: "reverse_substring_significant" }
    if (ratio >= 0.25 && shortWords >= 2) return { score: 0.65, reason: "reverse_substring_marginal" }
    // Caso contrário cai pro Jaccard abaixo (provável rejeição pelo threshold)
  }

  const aw = new Set(na.split(" ").filter((w) => w.length > 2))
  const bw = new Set(nb.split(" ").filter((w) => w.length > 2))
  if (!aw.size || !bw.size) return { score: 0, reason: "no_words" }
  const intersection = [...aw].filter((word) => bw.has(word)).length
  return { score: intersection / new Set([...aw, ...bw]).size, reason: "jaccard" }
}

export type MatchedNameKind = "title" | "originalTitle" | "alt"

export function bestTitleMatchDetailed(
  query: string,
  result: Pick<ExternalSearchResult, "title" | "originalTitle" | "alternativeTitles">
): { score: number; reason: TitleSimReason; matchedName: string | null; matchedKind: MatchedNameKind | null } {
  const candidates: Array<{ name: string | null | undefined; kind: MatchedNameKind }> = [
    { name: result.title, kind: "title" },
    { name: result.originalTitle, kind: "originalTitle" },
    ...(result.alternativeTitles ?? []).map((n) => ({ name: n, kind: "alt" as const })),
  ]
  let best: { score: number; reason: TitleSimReason; matchedName: string | null; matchedKind: MatchedNameKind | null } = {
    score: 0,
    reason: "empty",
    matchedName: null,
    matchedKind: null,
  }
  for (const { name, kind } of candidates) {
    if (!name) continue
    const sim = titleSimilarityDetailed(query, name)
    if (sim.score > best.score) {
      best = { score: sim.score, reason: sim.reason, matchedName: name, matchedKind: kind }
    }
  }
  return best
}

export function bestTitleMatch(query: string, result: Pick<ExternalSearchResult, "title" | "originalTitle" | "alternativeTitles">) {
  return bestTitleMatchDetailed(query, result).score
}
