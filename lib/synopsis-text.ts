/**
 * Regras de TEXTO da sinopse: a **limpeza** (links, blocos de fonte/publicação) e a
 * **identidade** (o que conta como "a mesma sinopse").
 *
 * Isto morava dentro de `lib/external/index.ts`, e por isso rodava num ponto só do
 * funil: a fronteira "acabei de buscar nas fontes" (`mergeData`). Tudo depois dela —
 * o pool do "Atualizar dados", o dedup do save, o gravador — comparava por igualdade
 * EXATA e nunca relimpava nada. O resultado media no banco: 55% das sinopses do Comix
 * com markdown cru (elas entram por `enrichComixDataForWork`, que desviava do funil) e
 * 195 pares quase-idênticos convivendo como linhas separadas.
 *
 * Módulo PURO de propósito (sem `server-only`, sem imports de rede): o picker no
 * cliente precisa MOSTRAR o mesmo texto que o servidor vai gravar.
 */

/** Quanto dois textos precisam se parecer pra contarem como a mesma sinopse. */
export const SYNOPSIS_DUPLICATE_THRESHOLD = 0.92

/** Teto de linhas de metadado consumidas após um rótulo de bloco (trava de segurança). */
const MAX_BLOCK_TAIL_LINES = 8

/**
 * Rótulo da família "Original …" — **exige dois-pontos** (ou parêntese).
 *
 * `novel` é a única palavra da lista que aparece naturalmente no meio de uma frase
 * ("but this wasn't in the original novel, was it?!"), e o gatilho antigo aceitava um
 * espaço qualquer depois do rótulo: com `novel` na lista e `[:\s]` no gatilho, essa
 * frase perderia tudo da vírgula pra frente. Boilerplate de verdade sempre traz o
 * dois-pontos.
 */
const ORIGINAL_BLOCK_RE =
  /[*_]{0,2}\s*original\s+(?:novel|webtoon|comic|manhwa|manga|work|source)\s*[*_]{0,2}\s*[:：(].*$/i

/** Demais rótulos de publicação — mantêm o gatilho histórico (`:` ou espaço). */
const PUBLISHING_BLOCK_RE =
  /[*_]{0,2}\s*(?:official\s+(?:translations?|release)|season\s+\d+\s+(?:author|artist)|published\s+(?:by|in|on)|serialized\s+(?:in|by))\s*[*_]{0,2}\s*[:\s].*$/i

/**
 * Linha que pertence à CAUDA de um bloco de fonte (a lista que vem embaixo do rótulo).
 * Só é consultada logo depois de um rótulo ter casado — nunca sozinha.
 *
 * Sem isto, apagar só a linha do rótulo deixava os restos órfãos, que é como o print
 * do "Atualizar dados" acabava exibindo `Naver Series, Ridibooks` solto no fim da
 * sinopse: o `**Original Novel:**` sumia e a lista dele ficava.
 */
function isBlockTailLine(line: string): boolean {
  const trimmed = line.trim()
  // Linha em branco FECHA o bloco — é o limite natural entre metadado e prosa.
  if (!trimmed) return false
  // Lista de links ("[English](https://…), [Japanese](https://…)").
  if (/\]\(https?:\/\//i.test(trimmed) || /https?:\/\//i.test(trimmed)) return true
  // Linha de classificação ("R19: …", "R15 (Main Story): KakaoPage, …").
  if (/^R\s*-?\s*\d{2}\b/i.test(trimmed)) return true
  // Lista curta de plataformas ("Naver Novel, Naver Series"). Prosa é excluída pela
  // pontuação de fim de frase — o teste é no FIM da linha, senão "T.Chinese, …" cairia.
  return trimmed.length <= 120 && !/[.!?][")»']?$/.test(trimmed)
}

/**
 * Remove os blocos "Original Novel / Official Translations / …" INTEIROS: o rótulo
 * (mesmo no meio da linha, que é como o MangaUpdates entrega — o `cleanHtml` dele
 * colapsa todo `\n` em espaço) e as linhas de metadado que o seguem.
 */
function stripSourceBlocks(text: string): string {
  const lines = text.split("\n")
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const stripped = line.replace(ORIGINAL_BLOCK_RE, "").replace(PUBLISHING_BLOCK_RE, "")
    if (stripped === line) {
      out.push(line)
      continue
    }
    // A prosa que vinha ANTES do rótulo na mesma linha fica (caso do MangaUpdates).
    if (stripped.trim()) out.push(stripped)
    let consumed = 0
    while (i + 1 < lines.length && consumed < MAX_BLOCK_TAIL_LINES && isBlockTailLine(lines[i + 1])) {
      i++
      consumed++
    }
  }

  return out.join("\n")
}

/**
 * Limpeza canônica de uma sinopse: tira markup, links, blocos de fonte e boilerplate
 * de publicação, preservando a prosa.
 *
 * **Não trunca**: a regra que apagava o último parágrafo curto (`\n{2,}…[^\n]{0,80}$`)
 * saiu — ela comia falas legítimas de fim de sinopse ("Can she survive the man who
 * doesn't remember her—or what he did?") sem deixar rastro.
 */
export function cleanSynopsisText(text: string | null | undefined): string {
  if (!text) return ""

  // Detecta marcadores de classificação ANTES da limpeza pra não perdê-los.
  // Aparecem em vários contextos ("Original Webtoon: R19", "Official
  // Translations (R19)", "R19 only", etc) e a maioria é removida pelas regras
  // de boilerplate abaixo. Reinjetamos no fim se foram apagados.
  const detectedRatings: string[] = []
  if (/\bR\s*-?\s*19\b/i.test(text)) detectedRatings.push("R19")
  if (/\bR\s*-?\s*18\b/i.test(text)) detectedRatings.push("R18")

  const withLineBreaks = text
    .replace(/\r\n?/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:039|x27);/gi, "'")
    // `<br>`/fim-de-bloco viram QUEBRA antes do strip genérico de tags: sem isto o
    // bloco de fonte perde as próprias fronteiras e a cauda dele vira prosa.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")

  let cleaned = stripSourceBlocks(withLineBreaks)
    .replace(/\[([^\]]*)\]\(https?:\/\/[^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[(?:source|src|via|from|written\s+by|translation|official)[^\]]{0,160}\]/gi, "")
    .replace(/\((?:source|src|via|from|written\s+by|translation|official)[^)]{0,160}\)/gi, "")
    // Bullets ANTES do strip de asterisco (a regra precisa do marcador pra achar a
    // linha); a ênfase/negrito sai logo depois, e só então as regras de LINHA rodam.
    // Nesta ordem `**Links:**` chega como `Links:` na regra do rótulo órfão — com o
    // strip por último, ele sobrevivia à primeira limpeza e só sumia na segunda, e
    // uma limpeza que não é ponto-fixo faz o texto mudar a cada save.
    .replace(/^\s*[*•]\s+[^\n]*$/gm, "")
    .replace(/\*+/g, "")
    .replace(/^\s*R19\s*:\s*[^\n]+$/gim, "R19")
    .replace(/^\s*R(?:15|18)\s*:\s*[^\n]+$/gim, "")
    .replace(/^\s*(?:links?|notes?|source|from|via)\s*:?\s*$/gim, "")
    .replace(/^\s*-{2,}\s*$/gm, "")
    .replace(/(?:^|\n)\s*R19\s*(?=(?:\n\s*R19\s*)+)/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  // Reinjeta marcadores ausentes — garante sinal pra enforceR19AdultContentRule
  // e pra IA mesmo quando o bloco "Original Webtoon"/"Official Translations" foi
  // removido pela limpeza.
  for (const marker of detectedRatings) {
    const re = new RegExp(`\\b${marker}\\b`, "i")
    if (!re.test(cleaned)) {
      cleaned = cleaned ? `${cleaned}\n\n[${marker} disponível]` : `[${marker} disponível]`
    }
  }
  return cleaned
}

/**
 * Chave de identidade: só pra comparar/deduplicar, NUNCA pra exibir ou gravar.
 * Passa pela limpeza primeiro — dois textos que só diferem no bloco de fonte são a
 * mesma sinopse (37 pares do catálogo eram exatamente isso).
 */
export function normalizeSynopsisForComparison(text: string | null | undefined): string {
  return cleanSynopsisText(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Score entre duas chaves JÁ normalizadas — evita relimpar o mesmo texto N vezes. */
function scoreNormalized(na: string, nb: string): number {
  if (!na || !nb) return 0
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1

  const aw = new Set(na.split(" ").filter((word) => word.length > 2))
  const bw = new Set(nb.split(" ").filter((word) => word.length > 2))
  if (!aw.size || !bw.size) return 0

  const intersection = [...aw].filter((word) => bw.has(word)).length
  const overlap = intersection / Math.min(aw.size, bw.size)
  const jaccard = intersection / new Set([...aw, ...bw]).size
  return Math.min(overlap, jaccard / 0.78)
}

/** 1 = mesma sinopse (idêntica ou uma contida na outra); 0 = sem relação. */
export function synopsisDuplicateScore(a: string | null | undefined, b: string | null | undefined): number {
  return scoreNormalized(normalizeSynopsisForComparison(a), normalizeSynopsisForComparison(b))
}

/** A regra de "é a mesma sinopse" — um lugar só, usado da busca até o gravador. */
export function isSameSynopsis(a: string | null | undefined, b: string | null | undefined): boolean {
  return synopsisDuplicateScore(a, b) >= SYNOPSIS_DUPLICATE_THRESHOLD
}

/**
 * Deduplica textos de sinopse pela regra fuzzy, preservando a ORDEM de entrada —
 * quem chega primeiro vence. Os callers ordenam antes (principal primeiro, salva
 * antes da nova) pra que o representante que sobrevive seja o curado.
 */
export function dedupeByMeaning<T>(items: T[], getText: (item: T) => string | null | undefined): T[] {
  const kept: T[] = []
  const keptKeys: string[] = []
  for (const item of items) {
    const key = normalizeSynopsisForComparison(getText(item))
    if (!key) continue
    if (keptKeys.some((other) => scoreNormalized(other, key) >= SYNOPSIS_DUPLICATE_THRESHOLD)) continue
    kept.push(item)
    keptKeys.push(key)
  }
  return kept
}
