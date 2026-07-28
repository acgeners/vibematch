import { CRITERIA_RUBRICS } from "@/lib/constants/criteria"

/**
 * A justificativa da IA vem sempre no formato `Faixa X-Y (Rótulo): texto` — o prompt OBRIGA citar a
 * faixa (`lib/ai-evaluation/service.ts`). Aqui separamos a LEGENDA (faixa + rótulo, atrelada à faixa
 * daquele atributo) do TEXTO específico da obra, sem re-avaliar nada.
 */
export interface ParsedJustification {
  /** Faixa citada pela IA, crua: "7-8", "9-10", "7-8/9-10". */
  band: string | null
  /** Rótulo curto entre parênteses: "Core Romance", "Forte a Icônica". */
  label: string | null
  /** Texto específico da obra, sem o prefixo da faixa. */
  detail: string
}

// "Faixa 7-8 (Core Romance): texto" · "Faixa 7-8/9-10 (Forte): …" · "Faixa 4-6: …" (rótulo opcional)
const BAND_RE = /^\s*Faixa\s+(\d+(?:-\d+)?(?:\/\d+-\d+)?)\s*(?:\(([^)]*)\))?\s*:\s*([\s\S]*)$/i

export function parseJustification(text: string): ParsedJustification {
  const m = text.match(BAND_RE)
  if (!m) return { band: null, label: null, detail: text.trim() }
  return { band: m[1], label: m[2]?.trim() || null, detail: m[3].trim() }
}

/** Menor e maior número de uma faixa: "7-8/9-10" → [7,10] · "4-6" → [4,6]. */
export function bandBounds(band: string): [number, number] {
  const nums = band.split(/[-/]/).map(Number).filter((n) => Number.isFinite(n))
  if (nums.length === 0) return [0, 10]
  return [Math.min(...nums), Math.max(...nums)]
}

/**
 * Extensão VISUAL da faixa numa régua 0–10 — use ISTO pra desenhar, `bandBounds` pra rotular.
 *
 * As faixas da rubrica são BINS DE INTEIROS e NÃO são contíguas: "0-3" | "4-6" | "7-8" | "9-10".
 * Nenhuma contém 3,5 · 6,5 · 8,5. Desenhar [lo, hi] cru joga toda nota de meio ponto pra FORA do
 * próprio segmento — a barra fica com o marcador do lado de fora e parece defeito (medido em
 * 2026-07-22: 132 dos 205 pontos-fora-da-faixa do catálogo eram só isto).
 *
 * O bin real é semiaberto — "7-8" cobre [7, 9) —, então o topo vira exclusivo (hi + 1, teto 10) e
 * os bins passam a se tocar: "0-3"→[0,4] · "4-6"→[4,7] · "7-8"→[7,9] · "9-10"→[9,10].
 */
export function bandBarBounds(band: string): [number, number] {
  const [lo, hi] = bandBounds(band)
  return [lo, Math.min(hi + 1, 10)]
}

/** As 4 faixas da rubrica, em ordem — idênticas nos 9 critérios (conferido em `CRITERIA_RUBRICS`). */
const RUBRIC_BANDS = ["0-3", "4-6", "7-8", "9-10"] as const

/**
 * Faixa da rubrica a que uma nota pertence — a FONTE DA VERDADE para exibir faixa.
 *
 * Não use a faixa que a IA citou na prosa. Ela apodrece de três jeitos, todos silenciosos:
 *  - a nota é editada depois e a prosa fica falando da faixa antiga (82 casos no catálogo);
 *  - uma regra de pós-processamento sobe a nota (`enforceR19AdultContentRule`,
 *    `enforceNeutralCoupleDynamicsWhenNoRomance`) sem reescrever a justificativa (~31 casos);
 *  - o modelo simplesmente foge do formato `Faixa X-Y:` e o regex não casa — 5,1% dos atributos
 *    no v21 · Sonnet 5, contra 0,2% no Sonnet 4.6 com o MESMO prompt.
 *
 * Derivando, faixa · rótulo · barra · nota ficam coerentes por construção. Casa por `bandBarBounds`
 * (bin semiaberto), então o marcador da nota cai SEMPRE dentro do próprio segmento.
 */
export function bandForScore(score: number): string {
  const s = Math.round(score * 10) / 10
  return RUBRIC_BANDS.find((b) => s < bandBarBounds(b)[1]) ?? RUBRIC_BANDS[RUBRIC_BANDS.length - 1]
}

/** Colapsa faixa dupla ao primeiro-último: "7-8/9-10" → "7-10" · "4-6" → "4-6". */
export function collapseBand(band: string): string {
  const [lo, hi] = bandBounds(band)
  return lo === hi ? `${lo}` : `${lo}-${hi}`
}

/**
 * Rubrica canônica da faixa citada, de `CRITERIA_RUBRICS[slug]` — a legenda VERDADEIRAMENTE fixa
 * (não a paráfrase da IA). Casa pelo prefixo da faixa primária ("7-8" casa "7-8 | …"). null quando
 * não há rubrica pro slug/faixa.
 */
export function rubricForBand(slug: string, band: string): string | null {
  const primary = band.split("/")[0].trim()
  const ranges = CRITERIA_RUBRICS[slug]?.ranges ?? []
  return ranges.find((r) => r.trim().startsWith(primary)) ?? null
}

/**
 * Título curto e FIXO da faixa — o pedaço antes do ":" na rubrica. Ex.: "7-8 | Core romance: romance
 * é um dos pilares…" → "Core romance". É o rótulo canônico da faixa (não a paráfrase da IA). Faixas
 * escritas como frase, sem título, devolvem a frase até o primeiro ":"; dar-lhes um apelido curto é
 * edição de banco (`criteria.ranges`), não código.
 */
export function rubricTitle(slug: string, band: string): string | null {
  const range = rubricForBand(slug, band)
  if (!range) return null
  const afterBand = range.includes("|") ? range.slice(range.indexOf("|") + 1) : range
  const title = afterBand.split(":")[0].trim()
  return title || null
}

/**
 * Explicação curta da faixa PARA HUMANO — a primeira frase da rubrica, depois do rótulo.
 *
 * A rubrica de `criteria.ranges` é escrita pro prompt: depois da definição vêm ressalvas dirigidas
 * ao modelo ("NÃO rebaixe porque…", "Marcador de EDIÇÃO…", exemplos em CAIXA ALTA) que não dizem
 * nada a quem está preenchendo o formulário. Cortar na primeira frase entrega uma linha legível
 * SEM manter uma segunda cópia do texto: a rubrica continua com uma fonte só, e mudar o banco
 * continua mudando a UI.
 *
 * O corte é na quebra de frase real (ponto + espaço), então "ex.:" e "(…)." não partem a frase ao
 * meio. null quando a faixa não tem rubrica ou não tem texto além do rótulo.
 */
export function rubricSummary(slug: string, band: string): string | null {
  const range = rubricForBand(slug, band)
  if (!range) return null
  const afterBand = range.includes("|") ? range.slice(range.indexOf("|") + 1) : range
  const colon = afterBand.indexOf(":")
  if (colon === -1) return null
  const detail = afterBand.slice(colon + 1).trim()
  const first = detail.split(/(?<=\.)\s+/)[0]?.trim()
  return first || null
}
