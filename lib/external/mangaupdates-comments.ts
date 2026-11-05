/**
 * Comentários de série do MangaUpdates: do registro da API ao texto que o pipeline grava.
 *
 * 🔴 Por que existe: até 2026-11 os comentários vinham RASPADOS da página
 * `www.mangaupdates.com/series/...`. Desde ~17/06/2026 o site responde **429 a navegador
 * antigo** — o corte medido em 2026-11-04 fica entre Chrome 136 (recusado) e 137 (aceito),
 * Firefox idem — e o conector se apresentava como Chrome 124. Não era limite de taxa (429 na
 * 1ª requisição, inclusive em `robots.txt`) nem bloqueio de IP (o mesmo IP passa trocando só
 * o User-Agent). A API oficial (`POST /v1/series/{id}/comments/search`) devolve os MESMOS
 * comentários (49 de 50 em *Solo Leveling*), e existe desde pelo menos jan/2023.
 *
 * ⚠️ O texto é a CHAVE de dedup da persistência (`saveWorkReviews` em modo acumulativo compara
 * por texto exato). Por isso o formato reproduz o que a raspagem gravava: cabeçalho
 * `Título do comentário:` / `Nota do usuário: N.N/10` e o corpo em UMA linha, com o
 * Markdown já "renderizado" (sem marcadores), como o `cleanHtml` deixava a página.
 * Texto diferente do antigo não quebra nada, mas entra como linha NOVA ao lado da antiga.
 */

export interface MangaUpdatesCommentInput {
  subject?: string | null
  content?: string | null
  /** `metadata.author_series_rating` da API: a nota que o autor do comentário deu à série. */
  rating?: number | null
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#039": "'", "#x27": "'", nbsp: " " }

function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|#039|#x27|nbsp);/gi, (m, name: string) => ENTITY[name.toLowerCase()] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 10)))
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim()

// Escape de Markdown (`\*`) vira um caractere de uso privado durante o processamento, para o
// delimitador escapado não ser lido como ênfase, e volta ao ASCII no fim.
const ESCAPE_BASE = 0xe000
const protectEscapes = (text: string) =>
  text.replace(/\\([!-/:-@[-`{-~])/g, (_, ch: string) => String.fromCharCode(ESCAPE_BASE + ch.charCodeAt(0)))
const restoreEscapes = (text: string) =>
  text.replace(/[-]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - ESCAPE_BASE))

const isWhitespace = (ch: string | undefined) => ch === undefined || /\s/u.test(ch)
const isPunctuation = (ch: string | undefined) => ch !== undefined && /[\p{P}\p{S}]/u.test(ch)

interface DelimiterRun {
  char: "*" | "_"
  /** Quantos delimitadores ainda sobram (os casados com outro são removidos). */
  count: number
  readonly origCount: number
  canOpen: boolean
  canClose: boolean
}

/**
 * Ênfase pelas regras de "flanking" do CommonMark (§6.2), que é o que a página do MangaUpdates
 * aplica — medido: `**Rating:**10` e `s***, … s***` ficavam LITERAIS no texto raspado, e uma
 * regex de pares as teria apagado. Simplificado do algoritmo da especificação: casa o
 * delimitador de fechamento com a abertura mais próxima do mesmo caractere, respeitando a
 * "regra do 3".
 */
function stripEmphasis(text: string): string {
  const parts: Array<string | DelimiterRun> = []
  const re = /\*+|_+/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const prev = m.index > 0 ? text[m.index - 1] : undefined
    const next = text[m.index + m[0].length]
    const left = !isWhitespace(next) && (!isPunctuation(next) || isWhitespace(prev) || isPunctuation(prev))
    const right = !isWhitespace(prev) && (!isPunctuation(prev) || isWhitespace(next) || isPunctuation(next))
    const char = m[0][0] as "*" | "_"
    parts.push({
      char,
      count: m[0].length,
      origCount: m[0].length,
      canOpen: char === "*" ? left : left && (!right || isPunctuation(prev)),
      canClose: char === "*" ? right : right && (!left || isPunctuation(next)),
    })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))

  const openers: DelimiterRun[] = []
  for (const part of parts) {
    if (typeof part === "string") continue
    if (part.canClose) {
      while (part.count > 0) {
        let i = openers.length - 1
        for (; i >= 0; i--) {
          const op = openers[i]
          if (op.char !== part.char || op.count === 0) continue
          const oddMatch =
            (op.canClose || part.canOpen) &&
            (op.origCount + part.origCount) % 3 === 0 &&
            !(op.origCount % 3 === 0 && part.origCount % 3 === 0)
          if (!oddMatch) break
        }
        if (i < 0) break
        const op = openers[i]
        const use = op.count >= 2 && part.count >= 2 ? 2 : 1
        op.count -= use
        part.count -= use
        // Aberturas entre as duas nunca mais casam: ficam literais.
        openers.splice(i + 1)
        if (op.count === 0) openers.splice(i, 1)
      }
    }
    if (part.canOpen && part.count > 0) openers.push(part)
  }

  return parts.map((p) => (typeof p === "string" ? p : p.char.repeat(p.count))).join("")
}

function renderInline(block: string): string {
  let text = block
    .replace(/!\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "$1") // imagem → texto alternativo
    .replace(/\[([^\]]+)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "$1") // link → texto
    .replace(/<((?:https?|mailto):[^>\s]+)>/gi, "$1") // autolink
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, "$2") // código inline
  text = stripEmphasis(text)
  return text
}

const HR = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const SETEXT = /^[ \t]{0,3}=+[ \t]*$/
const FENCE = /^[ \t]{0,3}(?:`{3,}|~{3,})/
const HEADING = /^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/
const QUOTE = /^[ \t]{0,3}(?:>[ \t]?)+/
const LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/
/** Marca interna do spoiler de linha (`>!` sem fechamento), fora da faixa dos escapes. */
const LINE_SPOILER = ""

/**
 * O Markdown do comentário como TEXTO, do jeito que a página o exibia depois do `cleanHtml`:
 * sem marcadores de bloco (lista, citação, título, linha horizontal) nem de ênfase, links pelo
 * texto, spoiler (`>!…!<`) aberto, e tudo numa linha só.
 */
export function muMarkdownToText(content: string): string {
  const source = protectEscapes(
    decodeEntities(content.replace(/\r\n?/g, "\n"))
      // Spoiler no estilo do Reddit: a página mostra o conteúdo, sem os marcadores. Ele também
      // aparece SEM fechamento, como spoiler da linha inteira (`>! texto`) — medido: 15 dos 21
      // textos que ainda divergiam do raspado eram esse caso, e lido como citação o `>` saía
      // e o `!` ficava.
      .replace(/>!([\s\S]*?)!</g, "$1")
      .replace(/^[ \t]*>!/gm, LINE_SPOILER),
  )

  const blocks: string[] = []
  let current: string[] = []
  const flush = () => {
    if (current.length > 0) blocks.push(current.join("\n"))
    current = []
  }
  for (const raw of source.split("\n")) {
    if (raw.trim() === "" || HR.test(raw) || SETEXT.test(raw) || FENCE.test(raw)) {
      flush()
      continue
    }
    if (HEADING.test(raw)) {
      flush()
      blocks.push(raw.replace(HEADING, ""))
      continue
    }
    if (raw.startsWith(LINE_SPOILER)) {
      // O conteúdo do spoiler é texto corrido: um `- ` ali NÃO vira lista na página.
      current.push(raw.slice(LINE_SPOILER.length))
      continue
    }
    const line = raw.replace(QUOTE, "")
    if (LIST.test(line)) {
      flush()
      current.push(line.replace(LIST, ""))
      continue
    }
    current.push(line)
  }
  flush()

  return collapse(restoreEscapes(blocks.map(renderInline).join("\n")))
}

/**
 * O texto que o conector entrega: o MESMO formato que a raspagem gravava (ver o cabeçalho deste
 * arquivo). Comentário sem corpo é `null` — a página também o descartava.
 */
export function formatMangaUpdatesComment(input: MangaUpdatesCommentInput): string | null {
  const body = muMarkdownToText(input.content ?? "")
  if (!body) return null
  const title = collapse(decodeEntities(input.subject ?? ""))
  const rating = typeof input.rating === "number" && Number.isFinite(input.rating) ? input.rating : null
  return [
    title ? `Título do comentário: ${title}` : null,
    rating !== null ? `Nota do usuário: ${rating.toFixed(1)}/10` : null,
    body,
  ]
    .filter(Boolean)
    .join("\n")
}
