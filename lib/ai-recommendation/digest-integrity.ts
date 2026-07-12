import type { ReviewDigest } from "./types"

// Markup de tool-call que NUNCA deve aparecer dentro de um campo do digest.
// Quando o modelo fecha um parâmetro com a tag errada (ex.: `</divergence>` em vez
// de `</parameter>`), o valor da string engole a tag e o bloco seguinte inteiro —
// `salient_traits` vira texto dentro de `divergence` e some do input. Sintoma no
// app: parágrafo com JSON cru E zero chips de traço.
//
// Isomórfico de propósito: a geração (server) rejeita antes de persistir, e a UI
// (client) reconhece as linhas que já foram gravadas assim antes da blindagem.
export const LEAKED_MARKUP_RE =
  /<\/?(?:parameter|antml:[a-z_]+|invoke|function_calls|function_results|consensus|divergence|salient_traits|content_warnings|execution)\b/i

export function hasLeakedMarkup(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => typeof t === "string" && LEAKED_MARKUP_RE.test(t))
}

/** Um digest persistido ANTES da blindagem pode carregar o markup vazado. */
export function isDigestCorrupted(digest: Pick<ReviewDigest, "consensus" | "divergence" | "execution">): boolean {
  return hasLeakedMarkup(digest.consensus, digest.divergence, digest.execution)
}

/** Neutraliza markup no TEXTO das reviews: uma review que contenha
 *  `<parameter name=...>` reproduz o vazamento sozinha (o texto é raspado de
 *  sites e injetado cru no prompt). */
export function sanitizeReviewText(text: string): string {
  return text
    .replace(/<\/?[a-z_][a-z0-9_:.-]*(?:\s[^>]*)?>/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}
