/**
 * "Hiatus" cobre DUAS situações que não têm o mesmo significado para quem lê:
 *
 * - **entre temporadas** — a temporada fechou e a próxima está prometida (`S4: TBA`,
 *   `S2: Sep 2026`). É pausa programada; a obra volta.
 * - **interrompida** — a publicação parou NO MEIO de uma temporada (`S2: 30 Chapters
 *   (Ongoing) 40~`), por saúde do autor ou sem motivo anunciado. Pode não voltar.
 *
 * O enum `publication_status` não distingue as duas, e **não pode** distinguir: das 9 fontes
 * externas, só o MangaUpdates traz o texto que explica a situação — as outras devolvem
 * "Hiatus" e pronto. Como o merge de `fetchMultiSourceDetails` fica com o status da PRIMEIRA
 * fonte aceita (`index.ts`, `accepted.find(...)`), um valor refinado seria sobrescrito pelo
 * genérico na primeira "Atualizar dados" em que outra fonte respondesse antes — sem erro e
 * sem log. Por isso isto é uma DIMENSÃO à parte (`works.hiatus_kind`), não um status novo.
 *
 * 🔴 **O sinal é ESTRUTURAL — a última linha `S<n>:` — e não o léxico.** A tentação é caçar
 * "Artist Hiatus"/"health" no texto; medido nas 97 obras em hiato do catálogo (2026-08-11),
 * o léxico aparece em **2**. O que decide é onde a última temporada parou: com o capítulo
 * final conhecido (`41-75`) ela fechou; com range aberto (`43~`, `104~`, `213-`, `78/~`) ou
 * `(Ongoing)`, ela parou no meio.
 *
 * Retrato dessa medição:
 *
 * | resultado | n | % |
 * |---|---|---|
 * | `between_seasons` (alta) | 68 | 70,1% |
 * | `mid_season` (alta) | 18 | 18,6% |
 * | `between_seasons` (baixa) | 4 | 4,1% |
 * | `null` (indeterminado) | 7 | 7,2% |
 *
 * ⚠️ **`null` é resultado, não falha.** Sem a terceira saída, os 7,2% de textos que só dizem
 * `27 Chapters (Hiatus)` receberiam um dos dois rótulos por default — e rótulo errado aqui é
 * pior que rótulo nenhum, porque a tela o apresenta como conferido.
 */

export type HiatusKind = "between_seasons" | "mid_season"

export interface HiatusClassification {
  /** `null` quando o texto não sustenta nenhuma das duas — ver o ⚠️ acima. */
  kind: HiatusKind | null
  /** `low` quando o sinal existe mas é indireto; a UI não deve afirmar sozinha nesse caso. */
  confidence: "high" | "low"
  /** A evidência textual que produziu o veredito — é o que permite auditar sem re-buscar. */
  evidence: string
}

/**
 * Linha de temporada. `Special:` fica de FORA de propósito: especial não é temporada, e obra
 * com `**Special:** 11 Chapters (Complete)` depois da última temporada faria o especial —
 * sempre fechado — responder pela publicação.
 */
const SEASON_LINE = /^(?:S(?:eason)?\s*\d+|Side\s+Stor(?:y|ies)|SS)\s*:?\s*(.*)$/i

const MONTH = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i

/** Motivo declarado ⇒ a parada não foi programada. Raro (2 em 97), mas inequívoco quando aparece. */
const INTERRUPTION_REASON =
  /\b(?:artist|author|creator)[\s-]*hiatus\b|\bextended\s+hiatus\b|\bindefinite\b|\bhealth\b|\billness\b|\bhospital\b|\bsurgery\b|\binjur/i

/** O MU às vezes nomeia a pausa de temporada — vale como último recurso, sem estrutura. */
const SEASON_BREAK_REASON = /\bseason\s+(?:hiatus|break)\b|\bbetween\s+seasons\b/i

/** O MU escreve em markdown: `**S1:**`, `1\~40`, `*TBA*`. Sem isto nenhum regex casa. */
function normalize(raw: string): string {
  return raw
    .replace(/\\([~*\\])/g, "$1")
    .replace(/\*/g, "")
    .replace(/[ \t]+/g, " ")
}

function lastSeasonLine(text: string): { line: string; rest: string } | null {
  let last: { line: string; rest: string } | null = null
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const match = line.match(SEASON_LINE)
    if (match) last = { line, rest: match[1].trim() }
  }
  return last
}

/**
 * A temporada ainda estava correndo quando parou.
 *
 * ⚠️ O range ABERTO é o que separa `S2: 24 Chapters (31~54)` (fechada) de `S2: 4 Chapters
 * (39~)` (aberta): o dígito só existe de um lado do til. Sem exigir o fim da string / o
 * fecha-parênteses, `31~54` casaria como aberto e toda temporada fechada viraria interrompida.
 */
function hasOpenRun(rest: string): boolean {
  if (/\(\s*ongoing\s*\)/i.test(rest)) return true
  return /\d+\s*\/?\s*[~\-–]\s*\??\s*(?:\)|$)/.test(rest)
}

/** A linha promete a PRÓXIMA temporada em vez de contar capítulos já publicados. */
function isPromise(rest: string): boolean {
  if (/\bTBA\b/i.test(rest)) return true
  // Contagem de capítulos ⇒ a temporada já saiu; não é promessa, mesmo com data na linha.
  if (/\bchapters?\b/i.test(rest)) return false
  if (/https?:\/\//.test(rest)) return true
  return MONTH.test(rest) || /\b20\d\d\b/.test(rest)
}

function hasClosedRun(rest: string): boolean {
  return /\d+\s*[-~–]\s*\d+/.test(rest)
}

/**
 * Classifica o hiato a partir do "Status in Country of Origin" do MangaUpdates.
 *
 * Puro e sem rede de propósito: o texto cru fica em `works.publication_status_note`, então
 * reclassificar o catálogo inteiro depois de afinar a regra não custa uma requisição.
 */
export function classifyHiatus(statusText: string | null | undefined): HiatusClassification {
  if (!statusText?.trim()) {
    return { kind: null, confidence: "low", evidence: "sem texto de status" }
  }

  const text = normalize(statusText)
  const declaredInterruption = INTERRUPTION_REASON.test(text)
  const season = lastSeasonLine(text)

  if (season) {
    if (hasOpenRun(season.rest)) {
      return {
        kind: "mid_season",
        confidence: "high",
        evidence: declaredInterruption
          ? `temporada aberta, com motivo declarado: "${season.line}"`
          : `temporada aberta: "${season.line}"`,
      }
    }

    // Motivo declarado vence a estrutura: a temporada fechou, mas quem parou foi o autor —
    // então a próxima não está agendada, está parada. Confiança baixa porque os dois sinais
    // discordam, e nas 97 medidas isso não aconteceu nenhuma vez (é o ramo não exercitado).
    if (isPromise(season.rest)) {
      return declaredInterruption
        ? { kind: "mid_season", confidence: "low", evidence: `próxima anunciada, mas há motivo declarado: "${season.line}"` }
        : { kind: "between_seasons", confidence: "high", evidence: `próxima temporada anunciada: "${season.line}"` }
    }

    if (hasClosedRun(season.rest)) {
      return declaredInterruption
        ? { kind: "mid_season", confidence: "low", evidence: `temporada fechada, mas há motivo declarado: "${season.line}"` }
        // Fechou e ninguém anunciou a próxima. Estruturalmente é o mesmo caso do TBA — nenhum
        // capítulo ficou solto —, mas sem a promessa explícita não dá pra afirmar que volta.
        : { kind: "between_seasons", confidence: "low", evidence: `última temporada fechou, próxima não anunciada: "${season.line}"` }
    }
  }

  if (declaredInterruption) {
    return { kind: "mid_season", confidence: "low", evidence: "motivo declarado, sem quebra por temporada" }
  }
  if (SEASON_BREAK_REASON.test(text)) {
    return { kind: "between_seasons", confidence: "low", evidence: "pausa de temporada nomeada, sem quebra por temporada" }
  }
  return { kind: null, confidence: "low", evidence: "sem quebra por temporada no texto" }
}

/** As três colunas de `works` que este módulo governa. */
export interface HiatusWorkFields {
  publication_status_note: string | null
  hiatus_kind: HiatusKind | null
  hiatus_kind_confidence: "high" | "low" | null
}

/**
 * O que gravar em `works`, dado o texto do MU e o status que o merge decidiu.
 *
 * 🔴 **A classificação é condicionada ao status ser Hiatus, e a condição mora AQUI** — um só
 * lugar, porque são dois caminhos de escrita (criação e "Atualizar dados") e a invariante
 * "obra que não está em hiato não tem tipo de hiato" se perde no segundo que alguém esquecer.
 *
 * O caso que obriga isto é frequente, não hipotético: das 97 obras que o catálogo marcava como
 * Hiatus em 2026-08-11, **13 (13,4%) já estavam `(Ongoing)` no MU** — o hiato terminou e
 * ninguém atualizou. Sem zerar na volta, essas obras exibiriam "pausa entre temporadas" com a
 * publicação correndo normalmente.
 *
 * ⚠️ **A nota crua fica mesmo fora do hiato.** Ela é o "Status in Country of Origin", que
 * descreve a publicação em qualquer estado (é dela que sai a quebra por temporadas de uma obra
 * Ongoing), e é o que permite reclassificar sem rede quando a regra for afinada.
 */
export function hiatusFieldsFor(
  statusText: string | null | undefined,
  publicationStatus: string | null | undefined,
): HiatusWorkFields {
  const note = statusText?.trim() || null
  if (publicationStatus !== "Hiatus") {
    return { publication_status_note: note, hiatus_kind: null, hiatus_kind_confidence: null }
  }
  const { kind, confidence } = classifyHiatus(note)
  return {
    publication_status_note: note,
    hiatus_kind: kind,
    // Pareadas pelo CHECK da migration 183: veredito sem confiança faria a UI afirmar com a
    // mesma ênfase um "S4: TBA" explícito e um "a temporada fechou e ninguém anunciou nada".
    hiatus_kind_confidence: kind ? confidence : null,
  }
}
