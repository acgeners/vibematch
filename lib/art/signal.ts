/**
 * O SINAL de arte — dono único dos extratores.
 *
 * Tudo que lê review/digest atrás de arte mora aqui: o léxico, a janela em torno das menções,
 * as tags de arte e a ordem do vetor de features. Uma 2ª cópia é como a estimativa e a
 * explicação dela passam a discordar sobre a mesma obra — a mesma armadilha do
 * `LOW_BALANCE_USD` e do `STRONG_TAG_WEIGHT`.
 *
 * Duas metades, separadas por CUSTO:
 *
 *   `extractArtSignal`   — caro (lê digest + texto de todas as reviews). Roda quando reviews
 *                          ou digest mudam, e o resultado é persistido em `works.art_signal`.
 *   `artFeatureVector`   — barato (aritmética sobre 6 números + as tags). Roda no recalc.
 *
 * ⚠️ As TAGS não entram no sinal persistido de propósito. Elas já chegam ao recalc pelo
 * `work_tags` do select, e guardá-las junto obrigaria a reler o digest a cada mudança de tag.
 * Por isso `artFeatureVector` recebe o conjunto de slugs como argumento separado.
 */

/**
 * Bump obrigatório ao mexer no léxico, na janela ou no que `extractArtSignal` conta — o sinal
 * persistido de versão menor foi extraído por outra régua e precisa ser refeito. Sem isto, uma
 * mudança de léxico produz catálogo com duas réguas misturadas, que é exatamente o que já
 * aconteceu com as versões de prompt de avaliação.
 */
export const ART_SIGNAL_VERSION = 1

/** Léxico de QUALIDADE de arte. Bilíngue: reviews são majoritariamente em inglês, o digest é em PT. */
const LEX_POS =
  /\b(gorgeous|beautiful|beautifully|stunning|amazing|lovely|pretty|masterpiece|detailed|expressive|polished|vibrant|breathtaking|aesthetic|crisp|clean|consistent|eye.?candy|art is (so |really |very )?(good|great|amazing|beautiful)|great art|good art|love the art|art style is (good|great|beautiful)|bela|linda|bonita|deslumbrante|elogiada|elogiado|excelente|caprichada|detalhada|expressiva)\b/gi
const LEX_NEG =
  /\b(bad art|poor art|mediocre|ugly|inconsistent|stiff|sloppy|rushed|generic|bland|amateur|amateurish|off.?model|cheap|art (is|gets) (bad|worse|weird|inconsistent)|anatomy is|weird anatomy|feia|fraca|fraco|inconsistente|criticada|criticado|ruim|pobre|tosca|simples demais)\b/gi
/** Onde a review fala de arte. Só a janela em torno disto alimenta o léxico. */
const ART_TERM =
  /\b(art|artwork|art.?style|drawing|drawings|illustration|illustrations|visuals|arte|desenho)\b/gi

/**
 * As tags que descrevem arte. Slugs, não nomes — o nome muda na curadoria e o slug é a chave.
 *
 * 🔴 A REGRA é da curadora (2026-08-12), e é de PROCEDÊNCIA, não de intuição:
 *   Format › Presentation  → TODAS as 12
 *   Format › Status        → `colorized-version-available` e `discontinued-colorized-version`
 *   Format › Structure     → `webtoon-webcomic`
 *
 * A versão anterior tinha 5 slugs escolhidos a olho e deixava de fora `official-colored` e
 * `realistic-art-style`, que falam de traço direto.
 *
 * ⚠️ **Cobertura, medida no catálogo (978 obras):** `webtoon-webcomic` 869 · `full-color` 856 ·
 * `elaborate-art-style` 130 · `art-style-change` 20 · `atypical-art-style` 10 ·
 * `web-comic-with-ost` 5 · `official-colored` 3 · e SEIS delas em 0 ou 1 obra. Como FEATURE
 * de um modelo com 200 rótulos, uma tag presente em 1 obra não consegue ser aprendida — ela
 * entra aqui porque, quando existe, é evidência que a pessoa precisa VER na página da obra.
 * Não confunda os dois papéis: exibir e prever têm exigências diferentes.
 *
 * ⚠️ **Isto é uma cópia da taxonomia e vai divergir.** A fonte é
 * `tag_subgroup_assignment` no banco; `sync-constants` não gera sub-grupo hoje. Enquanto o
 * piloto não decidir o desenho, a lista fica fixa aqui — a exibição na página da obra, essa
 * sim, deriva do banco e não usa esta lista, justamente para não esconder tag nova.
 */
export const ART_TAG_SLUGS = [
  // Format › Presentation (12)
  "full-color",
  "elaborate-art-style",
  "art-style-change",
  "atypical-art-style",
  "web-comic-with-ost",
  "official-colored",
  "highly-visual-narrative",
  "drawn-by-hentai-artist",
  "x-ray-cross-section-view",
  "realistic-art-style",
  "chibi",
  "cgdct",
  // Format › Status (as duas sobre colorização)
  "colorized-version-available",
  "discontinued-colorized-version",
  // Format › Structure
  "webtoon-webcomic",
] as const

/** ±chars em torno de cada menção. Fora disso a review está falando de outra coisa. */
const WINDOW = 140
/** Teto de janelas por review — evita que uma review gigante domine a contagem. */
const MAX_WINDOWS = 12
/** Teto do texto acumulado por obra, para o léxico não virar O(catálogo × reviews). */
const MAX_TEXT = 20_000

export interface ArtSignal {
  /** `ART_SIGNAL_VERSION` de quando foi extraído. Menor ⇒ régua antiga, refazer. */
  v: number
  /** Traços do eixo "arte" no digest, por polaridade. */
  digestPositive: number
  digestNegative: number
  /** Quantas reviews a obra tem e quantas vezes elas mencionam arte. */
  reviewCount: number
  artMentions: number
  /** Léxico de qualidade DENTRO das janelas — não no texto inteiro. */
  lexPositive: number
  lexNegative: number
}

export interface ArtSignalInput {
  /** `works.review_digest`, cru: string JSON, objeto já parseado, ou nada. */
  reviewDigest: unknown
  /** Texto das reviews persistidas da obra. */
  reviewTexts: string[]
}

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0
  let n = 0
  while (re.exec(text) !== null) n++
  return n
}

/** Recorta ±WINDOW chars em torno de cada menção a arte. */
function artWindows(text: string): string {
  ART_TERM.lastIndex = 0
  const parts: string[] = []
  let m: RegExpExecArray | null
  while ((m = ART_TERM.exec(text)) !== null) {
    parts.push(text.slice(Math.max(0, m.index - WINDOW), Math.min(text.length, m.index + WINDOW)))
    if (parts.length >= MAX_WINDOWS) break
  }
  return parts.join(" ")
}

/**
 * Extrai o sinal cru. NUNCA estoura: digest corrompido é tratado como ausente, porque a obra
 * ainda tem reviews e tags a oferecer — abortar aqui apagaria o sinal inteiro por causa de um
 * JSON quebrado (que já aconteceu neste projeto).
 */
export function extractArtSignal(input: ArtSignalInput): ArtSignal {
  let digestPositive = 0
  let digestNegative = 0
  let digestArtText = ""

  try {
    const d = (
      typeof input.reviewDigest === "string" ? JSON.parse(input.reviewDigest) : input.reviewDigest
    ) as { salient_traits?: Array<{ axis?: string; polarity?: string; trait?: string }> } & Record<
      string,
      unknown
    >
    for (const tr of d?.salient_traits ?? []) {
      // O eixo é texto livre do modelo: casa "arte", "art", "Arte / estilo".
      if (!/arte|art/i.test(String(tr?.axis ?? ""))) continue
      if (tr.polarity === "positive") digestPositive++
      else if (tr.polarity === "negative") digestNegative++
      digestArtText += " " + String(tr?.trait ?? "")
    }
    for (const key of ["consensus", "execution"]) {
      const prose = String(d?.[key] ?? "")
      ART_TERM.lastIndex = 0
      if (ART_TERM.test(prose)) digestArtText += " " + artWindows(prose)
      ART_TERM.lastIndex = 0
    }
  } catch {
    /* digest corrompido: trata como ausente, não aborta */
  }

  let reviewCount = 0
  let artMentions = 0
  let revArtText = ""
  for (const raw of input.reviewTexts) {
    const text = String(raw ?? "")
    reviewCount++
    const hits = countMatches(text, ART_TERM)
    artMentions += hits
    if (hits > 0 && revArtText.length < MAX_TEXT) revArtText += " " + artWindows(text)
  }

  const janelas = revArtText + " " + digestArtText
  return {
    v: ART_SIGNAL_VERSION,
    digestPositive,
    digestNegative,
    reviewCount,
    artMentions,
    lexPositive: countMatches(janelas, LEX_POS),
    lexNegative: countMatches(janelas, LEX_NEG),
  }
}

/**
 * A mesma extração, mas guardando o TEXTO — para a página da obra mostrar de onde a
 * estimativa saiu, e não só o número.
 *
 * 🔴 Reusa os MESMOS regexes do `extractArtSignal`. Uma 2ª cópia do léxico aqui é como a
 * tela passa a explicar uma conta diferente da que foi feita — o modo de falha mais caro
 * possível numa superfície cujo propósito é justamente "mostre seu trabalho".
 *
 * ⚠️ Não é usado pelo modelo. Guardar isto no `art_signal` custaria dezenas de KB por obra
 * numa coluna que o recalc lê para o catálogo inteiro.
 */
export interface ArtEvidence {
  /** Frases do eixo "arte" do digest, com a polaridade que o modelo contou. */
  digestTraits: Array<{ trait: string; polarity: string }>
  /** Termos do léxico que casaram, com quantas vezes. Positivos e negativos separados. */
  lexHits: { positive: Array<[string, number]>; negative: Array<[string, number]> }
  /** Trechos de review em torno de menções a arte — a frase que um leitor escreveu. */
  excerpts: string[]
}

function contarTermos(text: string, re: RegExp): Array<[string, number]> {
  re.lastIndex = 0
  const conta = new Map<string, number>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const termo = m[0].toLowerCase().replace(/\s+/g, " ")
    conta.set(termo, (conta.get(termo) ?? 0) + 1)
  }
  return [...conta.entries()].sort((a, b) => b[1] - a[1])
}

export function extractArtEvidence(input: ArtSignalInput, maxExcerpts = 4): ArtEvidence {
  const digestTraits: ArtEvidence["digestTraits"] = []
  let digestArtText = ""
  try {
    const d = (
      typeof input.reviewDigest === "string" ? JSON.parse(input.reviewDigest) : input.reviewDigest
    ) as { salient_traits?: Array<{ axis?: string; polarity?: string; trait?: string }> } & Record<
      string,
      unknown
    >
    for (const tr of d?.salient_traits ?? []) {
      if (!/arte|art/i.test(String(tr?.axis ?? ""))) continue
      const trait = String(tr?.trait ?? "").trim()
      if (trait) digestTraits.push({ trait, polarity: String(tr?.polarity ?? "") })
      digestArtText += " " + trait
    }
    for (const key of ["consensus", "execution"]) {
      const prose = String(d?.[key] ?? "")
      ART_TERM.lastIndex = 0
      if (ART_TERM.test(prose)) digestArtText += " " + artWindows(prose)
      ART_TERM.lastIndex = 0
    }
  } catch {
    /* digest corrompido: sem frases, mas as reviews seguem valendo */
  }

  const excerpts: string[] = []
  let revArtText = ""
  for (const raw of input.reviewTexts) {
    const text = String(raw ?? "")
    ART_TERM.lastIndex = 0
    const m = ART_TERM.exec(text)
    if (!m) continue
    if (revArtText.length < MAX_TEXT) revArtText += " " + artWindows(text)
    if (excerpts.length < maxExcerpts) {
      const ini = Math.max(0, m.index - 90)
      const frag = text.slice(ini, Math.min(text.length, m.index + 120)).replace(/\s+/g, " ").trim()
      if (frag.length > 40) excerpts.push(frag)
    }
  }

  const janelas = revArtText + " " + digestArtText
  return {
    digestTraits,
    lexHits: {
      positive: contarTermos(janelas, LEX_POS),
      negative: contarTermos(janelas, LEX_NEG),
    },
    excerpts,
  }
}

/**
 * Nomes das features, NA ORDEM do vetor. Existe para que qualquer diagnóstico possa
 * nomear um coeficiente sem recontar posições à mão.
 */
export const ART_FEATURE_NAMES: readonly string[] = [
  "digest_pos",
  "digest_neg",
  "digest_net",
  "tem_digest_arte",
  ...ART_TAG_SLUGS,
  "lex_pos",
  "lex_neg",
  "lex_net",
  "lex_rate",
  "mencoes",
  "mencoes_por_review",
]

/**
 * O vetor de 15 features. Recebe o sinal persistido MAIS as tags de agora — ver o ⚠️ no topo
 * sobre por que as tags não moram no sinal.
 */
export function artFeatureVector(signal: ArtSignal, tagSlugs: Iterable<string>): number[] {
  const tags = tagSlugs instanceof Set ? tagSlugs : new Set(tagSlugs)
  const { digestPositive: dp, digestNegative: dn, lexPositive: lp, lexNegative: ln } = signal
  return [
    dp,
    dn,
    dp - dn,
    dp + dn > 0 ? 1 : 0,
    ...ART_TAG_SLUGS.map((t) => (tags.has(t) ? 1 : 0)),
    lp,
    ln,
    lp - ln,
    lp + ln > 0 ? (lp - ln) / (lp + ln) : 0,
    signal.artMentions,
    signal.reviewCount > 0 ? signal.artMentions / signal.reviewCount : 0,
  ]
}

/**
 * A obra tem ALGUMA evidência de arte? Sem nenhuma, o modelo devolveria a média do treino —
 * e média disfarçada de estimativa, dentro de um filtro, vira um fato que ninguém apurou.
 * Medido em 2026-08-12: 23 de 974 obras (2,4%) caem aqui.
 */
export function hasArtEvidence(signal: ArtSignal | null, tagSlugs: Iterable<string>): boolean {
  if (!signal) return false
  const tags = tagSlugs instanceof Set ? tagSlugs : new Set(tagSlugs)
  return (
    signal.digestPositive + signal.digestNegative > 0 ||
    signal.artMentions > 0 ||
    ART_TAG_SLUGS.some((t) => tags.has(t))
  )
}

/** Sinal persistido que precisa ser reextraído (ausente ou de régua antiga). */
export function isArtSignalStale(signal: ArtSignal | null | undefined): boolean {
  return !signal || typeof signal.v !== "number" || signal.v < ART_SIGNAL_VERSION
}

/** Lê o jsonb cru de `works.art_signal` sem confiar na forma. */
export function parseArtSignal(raw: unknown): ArtSignal | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const num = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null)
  const v = num("v")
  const fields = [
    "digestPositive",
    "digestNegative",
    "reviewCount",
    "artMentions",
    "lexPositive",
    "lexNegative",
  ] as const
  if (v == null) return null
  const out: Record<string, number> = { v }
  for (const f of fields) {
    const n = num(f)
    if (n == null) return null
    out[f] = n
  }
  return out as unknown as ArtSignal
}

// ── Seleção de EVIDÊNCIA para a avaliação de Arte por IA (apêndice art4) ──────────────────────
//
// ⚠️ Não alimenta `extractArtSignal` nem o `art_signal` persistido (sem bump de
// `ART_SIGNAL_VERSION`). É RECUPERAÇÃO de candidatas, não julgamento: decide quais trechos o
// modelo vê no apêndice de Arte; quem julga continua sendo o modelo.
//
// Calibrada (2026-10-01, `Auditoria/piloto-arte-abc/CRITERIO-ADAPTATIVO-EVIDENCIA-ARTE.md`) contra
// a leitura humana das 16 obras do gate: nas listas explícitas, precisão 0,95 e recall 0,90 para
// "julga a arte"; por obra, a contagem humana cai entre `julga` e `mencao` em 15 de 16. Regex NÃO
// mede semântica — o número só vale como ordem de grandeza e como filtro de alta precisão.

/** Termo de arte, mais largo que `ART_TERM` (painéis, cores, anatomia, "drawn"). */
const EVIDENCIA_TERMO =
  /\b(art|arts|artwork|art ?style|artstyle|drawings?|drawn|illustrations?|visuals?|colou?ring|colou?rs|panels?|anatomy|arte|desenhos?|traços?)\b/gi
/** Avaliação perto do termo (≤90 chars): adjetivo de qualidade, positivo, negativo ou mediano. */
const EVIDENCIA_AVALIACAO =
  /\b(gorgeous|beautiful|beautifully|stunning|amazing|lovely|pretty|masterpiece|detailed|expressive|polished|vibrant|breathtaking|crisp|clean|great|good|nice|decent|fine|okay|ok|solid|average|so-?so|meh|mediocre|ugly|bad|poor|terrible|awful|weird|stiff|sloppy|rushed|generic|bland|amateur\w*|inconsistent|cheap|simple|plain|unique|cute|incredible|phenomenal|stellar|spectacular|wonderful|fantastic|awesome|excellent|perfect|immersive|not (?:the )?(?:best|great|good|my cup)|could (?:be|have been) better|strong point|weak point|not a strong|isn'?t (?:amazing|perfect|great)|bonit[ao]|lind[ao]|bel[ao]s?|bo[am]|ruim|fe[ia]o?|fraca|mediano)\b/i
/** Nota numérica de arte ("Art: 8/10", "ART | 10 |"). */
const EVIDENCIA_NOTA = /\b(art|artwork|arte)\s*(?:[:|-]|\bis\b|\bwas\b)?\s*\|?\s*\d+(?:[.,]\d+)?\s*(?:\/\s*10|out of 10|\|)/i
/** Trajetória perto do termo. */
const EVIDENCIA_MUDANCA =
  /\b(improv\w*|got better|gets better|getting better|evolv\w*|evolution|chang\w*|worse|declin\w*|deteriorat\w*|went downhill|got lazy|later chapters|after (?:chapter|ch\.?|season)|season \d|early chapters|first (?:few )?chapters|in the beginning|at the start|at first|melhor[ao]u|piorou|mudou)\b/i
/** "drawn together", "drawn to": atração, não desenho. */
const DRAWN_FIGURADO = /^\s+(together|to|towards|into|in)\b/i
const EVIDENCIA_JANELA = 90
const EVIDENCIA_TRECHO = 140

export interface EvidenciaDeArte {
  /** Algum termo de arte. Menção não é julgamento. */
  mencao: boolean
  /** Termo de arte com avaliação de qualidade perto, ou nota numérica de arte. */
  julga: boolean
  /** Termo de arte com vocabulário de trajetória perto. */
  mudanca: boolean
  /** O texto em torno das menções (±140 chars, janelas fundidas, cortadas em espaço). */
  trecho: string
}

export function classificarEvidenciaDeArte(texto: string): EvidenciaDeArte {
  const t = String(texto ?? "")
  let mencao = false
  let julga = false
  let mudanca = false
  const janelas: Array<[number, number]> = []
  EVIDENCIA_TERMO.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = EVIDENCIA_TERMO.exec(t)) !== null) {
    const fim = m.index + m[0].length
    if (/^drawn$/i.test(m[1]) && DRAWN_FIGURADO.test(t.slice(fim, fim + 12))) continue
    mencao = true
    const jan = t.slice(Math.max(0, m.index - EVIDENCIA_JANELA), Math.min(t.length, fim + EVIDENCIA_JANELA))
    if (EVIDENCIA_AVALIACAO.test(jan)) julga = true
    if (EVIDENCIA_MUDANCA.test(jan)) mudanca = true
    janelas.push([Math.max(0, m.index - EVIDENCIA_TRECHO), Math.min(t.length, fim + EVIDENCIA_TRECHO)])
  }
  if (EVIDENCIA_NOTA.test(t)) {
    mencao = true
    julga = true
    const n = EVIDENCIA_NOTA.exec(t)!
    janelas.push([Math.max(0, n.index - EVIDENCIA_TRECHO), Math.min(t.length, n.index + n[0].length + EVIDENCIA_TRECHO)])
  }
  // Funde janelas que se tocam e corta nos espaços, para o trecho não começar no meio da palavra.
  janelas.sort((a, b) => a[0] - b[0])
  const fundidas: Array<[number, number]> = []
  for (const j of janelas) {
    const ult = fundidas[fundidas.length - 1]
    if (ult && j[0] <= ult[1]) ult[1] = Math.max(ult[1], j[1])
    else fundidas.push([j[0], j[1]])
  }
  const trecho = fundidas
    .map(([a, b]) => {
      let ini = a
      let fim = b
      if (ini > 0) { const s = t.indexOf(" ", ini); ini = s === -1 || s >= fim ? ini : s + 1 }
      if (fim < t.length) { const s = t.lastIndexOf(" ", fim); fim = s <= ini ? fim : s }
      return t.slice(ini, fim).trim()
    })
    .filter(Boolean)
    .join(" … ")
  return { mencao, julga, mudanca, trecho }
}
