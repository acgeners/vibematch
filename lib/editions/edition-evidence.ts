/**
 * Evidência de EDIÇÃO a partir do texto CRU do MangaUpdates — módulo PURO (sem rede, sem banco).
 *
 * 🔴 Por que existe (auditoria de 2026-10-10, `Auditoria/edicoes-mixed-r19-mu-2026-10-10`): o
 * MangaUpdates escreve, na descrição, blocos como
 *
 *     **Original Webtoon:**
 *     R19: [KakaoPage](…), [Daum](…)
 *     R15: [KakaoPage](…)
 *
 * e a limpeza de sinopse (`lib/synopsis-text.ts`) apaga esses blocos — de propósito, porque não são
 * prosa — e reinjeta só um `[R19 disponível]`. A pista de que existe uma edição NORMAL (o `R15:`)
 * nunca chegava ao banco, e o marcador sozinho virava "obra com duas edições" (mig 199). Das 206
 * obras assim, 140 eram de fato `mixed`, 35 eram R18-only (variante de CENSURA de obra já R19), 28
 * tinham o R19 de OUTRO contexto (o novel, outra obra, o enredo) e 3 seguiam indeterminadas.
 *
 * Este módulo lê o texto ANTES da limpeza e devolve a evidência estruturada. Ele NÃO muda a sinopse
 * gravada (mudar o texto limpo mexeria no hash do cache de avaliação e na identidade de sinopse).
 *
 * A régua (decisões fechadas em 2026-10-10):
 *   · R15 E R19 explícitos no QUADRINHO (webtoon/tradução oficial) → `mixed`;
 *   · a categoria do MU "R19 with R15 Version" afirma as duas edições → `mixed`;
 *   · R19 só no NOVEL (ou numa nota sobre outra obra) NÃO contamina o quadrinho → `single`
 *     quando há prova de que o R19 é de outro contexto;
 *   · R19 sem R15 → no máximo `unknown` (não confirma `mixed` e não decide `r18_only` sozinho —
 *     R18-only é decisão de auditoria/curadoria);
 *   · censura × sem censura ("Uncensored Version Available", "Official English Uncensored",
 *     "English Company Added Censorship") é informação EDITORIAL de uma obra que pode ser R18 —
 *     não prova edição normal. Fica registrada, não decide nada.
 */

/** Rótulos que descrevem uma edição NÃO adulta. */
const NORMAL_LABELS = new Set(["12", "15", "16", "17"])
/** Rótulos que descrevem uma edição adulta. */
const ADULT_LABELS = new Set(["18", "19"])

const LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]*)\)/g
const LABEL_RE = /(?<![A-Za-z0-9])(?:R\s?-?\s?(12|15|16|17|18|19)|(12|15|16|17|18|19)\s?\+)(?![0-9])/gi
/** Rótulo de bloco numa linha própria: `**Original Webtoon:**`, `Official Translations:`… */
const HEADER_RE =
  /^\s*\**\s*((?:alt\.?\s+)?(?:original|official)\s+[a-z .-]+?|links?|notes?)\s*:?\s*\**\s*:?\s*\**\s*$/i
/** Rótulo de bloco com conteúdo na mesma linha: `**Original Webtoon:** R19: …`. */
const INLINE_HEADER_RE = /^\s*\*\*\s*([^*]{3,40}?)\s*:?\s*\*\*\s*:?\s*(.*)$/

/** Categoria do MU que afirma, ela mesma, as duas edições. */
export const MU_MIXED_CATEGORIES: ReadonlySet<string> = new Set(["r19 with r15 version"])
/** Categoria do MU que diz que o QUADRINHO é a edição normal e o R19 é do novel. */
export const MU_COMIC_IS_NORMAL_CATEGORIES: ReadonlySet<string> = new Set(["r15 but based on a r19 novel"])
/** Categorias de CENSURA — informação editorial, nunca prova de edição normal. */
export const MU_CENSORSHIP_CATEGORIES: ReadonlySet<string> = new Set([
  "uncensored version available",
  "official english uncensored",
  "english company added censorship",
  "partially uncensored",
  "full censorship",
])
/** Categorias que mencionam uma edição R19 sem afirmar a normal. */
export const MU_R19_MENTION_CATEGORIES: ReadonlySet<string> = new Set([
  "official english r19 version available",
  "r19 version",
  "r19",
  "r18/r19",
])

/** Nota do MU dizendo que o QUADRINHO segue a edição normal (o R19 é do novel). */
const NOTE_COMIC_IS_NORMAL_RE =
  /(webtoon|manhwa|comic)[^.]{0,60}(released as|is|was|follows?|following|will follow)[^.]{0,40}(r15|how the novel (?:was )?first released|the r15 version)|not r19 like the novel/i

export type EditionVerdict = "mixed" | "single" | "unknown" | "none"

export type SectionKind = "comic" | "translation" | "novel" | "note" | "other"

export interface EditionSection {
  header: string
  kind: SectionKind
  labels: string[]
  lines: string[]
}

export interface EditionEvidence {
  source: "mangaupdates"
  verdict: EditionVerdict
  /** Por que o veredito saiu assim — frase curta, para a procedência. */
  reason: string
  /** Qual parte do MU sustenta o veredito. */
  basis: "mangaupdates_description" | "mangaupdates_category" | null
  /** Linhas do quadrinho (original ou tradução) com rótulo de edição normal (R12–R17). */
  normalLines: string[]
  /** Linhas do quadrinho (original ou tradução) com rótulo adulto (R18/R19). */
  r18Lines: string[]
  /** Linhas do NOVEL com rótulo adulto — registradas, mas não falam do quadrinho. */
  novelR18Lines: string[]
  categories: { mixed: string[]; censorship: string[]; r19Mentions: string[]; comicIsNormal: string[] }
  notes: string[]
}

const MAX_LINES = 10
const MAX_LINE_CHARS = 200

function kindOf(header: string): SectionKind {
  const h = header.toLowerCase()
  if (/novel|webnovel|light novel/.test(h)) return "novel"
  if (/webtoon|webcomic|comic|manhwa|manga|manhua/.test(h)) return "comic"
  if (/translation|english|release/.test(h)) return "translation"
  if (/note/.test(h)) return "note"
  return "other"
}

function decodeEntities(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:039|x27);/gi, "'")
}

/** Linha legível para a procedência: links viram só o texto, sem URL. */
function displayLine(line: string): string {
  const clean = line.replace(LINK_RE, "$1").replace(/https?:\/\/\S+/g, "").replace(/\*+/g, "").replace(/\s+/g, " ").trim()
  return clean.length > MAX_LINE_CHARS ? `${clean.slice(0, MAX_LINE_CHARS - 1)}…` : clean
}

function labelsOf(text: string): string[] {
  const out = new Set<string>()
  // Rótulos dentro do texto de link ("[R19](…)") contam; a URL em si não.
  const body = text.replace(LINK_RE, "$1").replace(/https?:\/\/\S+/g, "")
  for (const m of body.matchAll(LABEL_RE)) out.add((m[1] ?? m[2]) as string)
  return [...out].sort()
}

/** Divide a descrição em blocos ("Original Webtoon", "Official Translations", notas…). */
export function parseEditionSections(rawDescription: string | null | undefined): EditionSection[] {
  const text = decodeEntities((rawDescription ?? "").replace(/\r\n?/g, "\n"))
  const sections: Array<{ header: string; kind: SectionKind; lines: string[] }> = [
    { header: "top", kind: "other", lines: [] },
  ]
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const header = HEADER_RE.exec(line)
    if (header) {
      sections.push({ header: header[1].trim(), kind: kindOf(header[1]), lines: [] })
      continue
    }
    const inline = INLINE_HEADER_RE.exec(line)
    if (inline && /original|official|note|translation/i.test(inline[1])) {
      sections.push({ header: inline[1].trim(), kind: kindOf(inline[1]), lines: inline[2] ? [inline[2]] : [] })
      continue
    }
    if (/^\**\s*note/i.test(line)) {
      sections.push({ header: "note", kind: "note", lines: [line] })
      continue
    }
    sections[sections.length - 1].lines.push(line)
  }
  // O rótulo pode vir no PRÓPRIO cabeçalho ("**Official Translations (R15):**", visto em Lucia).
  return sections.map((s) => ({
    ...s,
    labels: labelsOf([s.kind === "other" ? "" : s.header, ...s.lines].join("\n")),
  }))
}

function linesWith(sections: EditionSection[], kinds: SectionKind[], wanted: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const s of sections) {
    if (!kinds.includes(s.kind)) continue
    const headerLabels = labelsOf(s.header)
    for (const line of s.lines) {
      if ([...headerLabels, ...labelsOf(line)].some((l) => wanted.has(l))) out.push(`${s.header}: ${displayLine(line)}`)
    }
  }
  return out.slice(0, MAX_LINES)
}

/**
 * Evidência de edição de UMA resposta do MangaUpdates (`GET /v1/series/{id}`): a descrição CRUA
 * (antes de qualquer limpeza) e as categorias.
 */
export function extractMangaUpdatesEditionEvidence(input: {
  description: string | null | undefined
  categories: Iterable<string> | null | undefined
}): EditionEvidence {
  const sections = parseEditionSections(input.description)
  const cats = [...(input.categories ?? [])].map((c) => c.trim()).filter(Boolean)
  const catsLower = cats.map((c) => c.toLowerCase())
  const categories = {
    mixed: cats.filter((_, i) => MU_MIXED_CATEGORIES.has(catsLower[i])),
    censorship: cats.filter((_, i) => MU_CENSORSHIP_CATEGORIES.has(catsLower[i])),
    r19Mentions: cats.filter((_, i) => MU_R19_MENTION_CATEGORIES.has(catsLower[i])),
    comicIsNormal: cats.filter((_, i) => MU_COMIC_IS_NORMAL_CATEGORIES.has(catsLower[i])),
  }

  const labelSet = (kinds: SectionKind[]) => new Set(sections.filter((s) => kinds.includes(s.kind)).flatMap((s) => s.labels))
  const comic = labelSet(["comic"])
  const translation = labelSet(["translation"])
  const novel = labelSet(["novel"])
  const otherLabels = labelSet(["other"])
  const has = (set: Set<string>, ref: ReadonlySet<string>) => [...set].some((l) => ref.has(l))
  const comicOrTr = new Set([...comic, ...translation])
  const notes = sections
    .filter((s) => s.kind === "note")
    .map((s) => displayLine(s.lines.join(" ")))
    .filter(Boolean)
    .slice(0, MAX_LINES)
  const noteSaysComicIsNormal = notes.some((n) => NOTE_COMIC_IS_NORMAL_RE.test(n))

  const evidence: Omit<EditionEvidence, "verdict" | "reason" | "basis"> = {
    source: "mangaupdates",
    normalLines: linesWith(sections, ["comic", "translation"], NORMAL_LABELS),
    r18Lines: linesWith(sections, ["comic", "translation"], ADULT_LABELS),
    novelR18Lines: linesWith(sections, ["novel"], ADULT_LABELS),
    categories,
    notes,
  }
  const done = (verdict: EditionVerdict, reason: string, basis: EditionEvidence["basis"]): EditionEvidence => ({
    ...evidence,
    verdict,
    reason,
    basis,
  })

  // 1. As duas edições do QUADRINHO, explícitas.
  const comicPair = has(comic, NORMAL_LABELS) && has(comic, ADULT_LABELS)
  const trPair = has(translation, NORMAL_LABELS) && has(translation, ADULT_LABELS)
  const crossPair = has(comicOrTr, NORMAL_LABELS) && has(comicOrTr, ADULT_LABELS)
  if (comicPair || trPair || crossPair) {
    const where = comicPair ? "Original Webtoon" : trPair ? "Official Translations" : "webtoon + traduções"
    return done("mixed", `MU lista edição normal E edição R19 do quadrinho (${where})`, "mangaupdates_description")
  }
  if (categories.mixed.length > 0) {
    return done("mixed", `MU: categoria "${categories.mixed[0]}"`, "mangaupdates_category")
  }

  const comicAdult = has(comicOrTr, ADULT_LABELS)
  const otherAdult = has(otherLabels, ADULT_LABELS)
  const novelAdult = has(novel, ADULT_LABELS)

  // 2. R19 que é de OUTRO contexto: o novel (ou nota dizendo que o quadrinho segue a R15).
  const categorySaysComicIsNormal = categories.comicIsNormal.length > 0
  if (!comicAdult && !otherAdult && (novelAdult || noteSaysComicIsNormal || categorySaysComicIsNormal)) {
    if (noteSaysComicIsNormal) return done("single", "MU: nota diz que o quadrinho segue a edição R15", "mangaupdates_description")
    if (novelAdult) return done("single", "MU: o R19 está só na seção do NOVEL", "mangaupdates_description")
    return done("single", `MU: categoria "${categories.comicIsNormal[0]}"`, "mangaupdates_category")
  }

  // 3. Menção R19 sem a edição normal: não confirma `mixed`.
  if (comicAdult || otherAdult || categories.r19Mentions.length > 0) {
    return done("unknown", "MU menciona edição R19 sem listar edição normal", "mangaupdates_description")
  }

  // 4. Só censura, ou nada.
  if (categories.censorship.length > 0) {
    return done("none", `MU: só informação de censura (${categories.censorship.join(", ")})`, null)
  }
  return done("none", "MU sem rótulo de edição", null)
}

/** Estado de edição gravado (o que a decisão automática precisa saber dele). */
export interface CurrentEditionState {
  state: "single" | "mixed" | "r18_only" | "unknown"
  decidedBy: "audit" | "curator" | "legacy" | "auto"
}

export type AutoEditionDecision =
  | { action: "keep"; why: string }
  | { action: "insert" | "update"; state: "single" | "mixed" | "unknown" }

/**
 * O que a INGESTÃO automática pode fazer com o estado de edição de uma obra.
 *
 *   · decisão de auditoria, curadoria ou o legado da mig 199 → nunca é tocada pela ingestão;
 *   · sem estado → grava o veredito (`none` não grava nada);
 *   · `unknown` automático → pode subir para `mixed`/`single` quando a evidência os prova;
 *   · `mixed`/`single` automáticos → ficam (a ingestão não oscila entre estados).
 *
 * Nunca produz `r18_only`: isso é decisão de auditoria/curadoria (`extractMangaUpdatesEditionEvidence`
 * só chega a `unknown` quando falta a edição normal).
 */
export function decideAutoEditionState(
  current: CurrentEditionState | null,
  verdict: EditionVerdict,
): AutoEditionDecision {
  if (verdict === "none") return { action: "keep", why: "sem evidência de edição" }
  if (!current) return { action: "insert", state: verdict }
  if (current.decidedBy !== "auto") return { action: "keep", why: `decisão de ${current.decidedBy} não é sobrescrita pela ingestão` }
  if (current.state === "unknown" && (verdict === "mixed" || verdict === "single")) {
    return { action: "update", state: verdict }
  }
  return { action: "keep", why: `estado automático ${current.state} mantido` }
}
