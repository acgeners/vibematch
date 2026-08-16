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
//
// ⚠️ A citação composta tem MAIS formas do que "7-8/9-10": o modelo escreve "Faixa 7-8/9",
// "Faixa 4-6 a 7-8" e "Faixa 7-8, tendendo ao limite superior". Capturar só o primeiro par
// faz qualquer régua de coerência acusar contradição onde a prosa cobre a nota — foi assim
// que uma varredura minha deu 483 incoerências das quais 6 de 6 amostradas eram falso
// positivo (2026-08-16). O grupo abaixo consome a citação INTEIRA; `bandBounds` já reduz a
// qualquer forma dessas ao par mín–máx.
// A palavra que liga as duas citações varia ("a", "e", "até", "limiar", "tendendo"), então
// ela é aceita genericamente — mas SÓ quando vem seguida de mais números, senão o grupo
// engoliria o começo do argumento. Sem casar, o resultado é "sem-faixa": nenhuma afirmação,
// que é o lado seguro.
const BAND_RE =
  /^\s*Faixa\s+(\d+(?:\s*[-–/]\s*\d+)*(?:\s*[/,]?\s*[a-zà-ú]{1,10}\s*\d+(?:\s*[-–/]\s*\d+)*)?)\s*(?:\(([^)]*)\))?\s*[:,]\s*([\s\S]*)$/i

export function parseJustification(text: string): ParsedJustification {
  const m = text.match(BAND_RE)
  if (!m) return { band: null, label: null, detail: text.trim() }
  return { band: m[1], label: m[2]?.trim() || null, detail: m[3].trim() }
}

/** Menor e maior número de uma faixa: "7-8/9-10" → [7,10] · "4-6" → [4,6] · "4-6 a 7-8" → [4,8]. */
export function bandBounds(band: string): [number, number] {
  const nums = (band.match(/\d+/g) ?? []).map(Number).filter((n) => Number.isFinite(n))
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
 *  - uma regra de pós-processamento sobe a nota (`enforceR19AdultContentRule`, e até a v22 o
 *    `enforceNeutralCoupleDynamicsWhenNoRomance`) sem reescrever a justificativa (~31 casos);
 *    o clamp de couple_dynamics saiu na v23, mas as ~31 linhas que ele produziu seguem no banco;
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

/** Estado da relação entre a NOTA e a faixa que a prosa cita. */
export type BandCoherence = "sem-faixa" | "coerente" | "divergente"

/**
 * A prosa contradiz o número? — a única checagem de coerência deste projeto que sobrevive
 * à validação manual, porque é ESTRUTURAL: compara o rótulo citado com a faixa da nota, sem
 * interpretar uma palavra do texto.
 *
 * 🔴 Duas armadilhas, as duas medidas em 2026-08-16, e as duas produzem número plausível:
 *
 *  1. **Citação composta.** "Faixa 7-8/9" e "Faixa 4-6 a 7-8" cobrem mais de uma faixa. Ler
 *     só o primeiro par e comparar por igualdade de string dá 6 falsos positivos em 6
 *     amostrados. Aqui a citação vira um INTERVALO e a pergunta é se a nota cai dentro dele.
 *
 *  2. **A fresta do meio ponto.** Os bins da rubrica são de inteiros e não se tocam: nenhum
 *     contém 3,5 · 6,5 · 8,5. Comparar contra `[lo, hi]` cru reprova toda nota de meio ponto
 *     na borda — 226 casos no catálogo, nenhum deles erro de julgamento. Por isso o teto usa
 *     a mesma lógica semiaberta de `bandBarBounds`, que é como a faixa é DESENHADA na tela.
 *
 * Sobra o que importa: 71 divergências reais em 8.766 atributos (0,8%), das quais 5 de 5
 * amostradas eram legítimas — prosa dizendo "Faixa 0-3 (Ausente)" sobre uma nota 4,0.
 */
export function bandCoherence(score: number, justification: string | null | undefined): BandCoherence {
  if (!justification) return "sem-faixa"
  const { band } = parseJustification(justification)
  if (!band) return "sem-faixa"
  const [lo, hi] = bandBounds(band)
  const teto = Math.min(hi + 1, 10)
  const s = Math.round(score * 10) / 10
  // Semiaberto no topo, EXCETO no fim da régua: 10,0 tem que caber em "9-10".
  const dentro = s >= lo && (s < teto || (teto === 10 && s === 10))
  return dentro ? "coerente" : "divergente"
}
