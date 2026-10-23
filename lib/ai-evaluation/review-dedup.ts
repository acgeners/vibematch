/**
 * Deduplicação de reviews — a régua de "é a mesma review" do prompt de avaliação.
 *
 * Mora fora do `service.ts` para o apêndice de Arte (`art-appendix.ts`) usar EXATAMENTE a mesma
 * régua sem import circular: "já está nas reviews principais" tem de significar o mesmo para o
 * prompt e para o apêndice.
 *
 * O que ela elimina são CÓPIAS da mesma manifestação (a mesma review em duas plataformas, a versão
 * longa e a resumida). Opiniões parecidas de leitores diferentes são consenso, não cópia, e ficam.
 */

export function reviewTextFingerprint(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 4)
  )
}

export function jaccardReviews(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const intersection = [...a].filter((w) => b.has(w)).length
  return intersection / new Set([...a, ...b]).size
}

/** Jaccard a partir do qual duas reviews são a mesma (a régua original). */
const JACCARD_DUPLICATA = 0.75

/**
 * Contenção: fração do vocabulário do lado MENOR que está dentro do maior. Pega o que o Jaccard deixa
 * passar porque a união cresce — a versão longa de uma review e a resumida, ou a mesma review postada
 * em duas plataformas com um cabeçalho a mais. Medido em 22/10/2026 (`Auditoria/qualidade-avaliacoes-
 * ia-2026-10/CONSENSO-DIAGNOSTICO-2026-10-22.md`): nos 45 pares do prompt com contenção ≥ 0,8 e Jaccard
 * < 0,75, 37 eram a mesma manifestação e os 2 falsos positivos tinham o lado menor com ≤ 9 termos —
 * daí o piso de 12, abaixo do qual um comentário curto "cabe" no vocabulário de qualquer review longa.
 */
export const CONTENCAO_DUPLICATA = 0.8
export const CONTENCAO_MIN_TERMOS = 12

export function containmentReviews(a: Set<string>, b: Set<string>): number {
  const [menor, maior] = a.size <= b.size ? [a, b] : [b, a]
  if (menor.size === 0) return 0
  let dentro = 0
  for (const w of menor) if (maior.has(w)) dentro++
  return dentro / menor.size
}

/** As duas impressões digitais são da MESMA manifestação (cópia), não de duas opiniões parecidas. */
export function mesmaManifestacao(a: Set<string>, b: Set<string>): boolean {
  if (jaccardReviews(a, b) >= JACCARD_DUPLICATA) return true
  return Math.min(a.size, b.size) >= CONTENCAO_MIN_TERMOS && containmentReviews(a, b) >= CONTENCAO_DUPLICATA
}

export interface OpcoesDeduplicacao {
  /**
   * Entre duas versões da MESMA manifestação, fica a mais completa (mais termos; empate: texto mais
   * longo; empate: a primeira). Ela ocupa a POSIÇÃO da primeira ocorrência, mas é o registro INTEIRO
   * dela: texto, fonte, nota e título da fonte andam juntos — nada é recortado, combinado ou
   * reatribuído a outra fonte.
   *
   * Só para conjuntos de PARES (o pool da seleção). Sem ela, a primeira ocorrência vence, e isso é de
   * propósito: no prompt a review manual vem antes e não pode ser trocada por uma raspada; no apêndice
   * de Arte as enviadas vêm antes e "já está no prompt" tem de continuar significando a enviada.
   */
  preferirVersaoMaisCompleta?: boolean
}

function maisCompleta(a: { text: string }, fpA: Set<string>, b: { text: string }, fpB: Set<string>): boolean {
  if (fpA.size !== fpB.size) return fpA.size > fpB.size
  return a.text.trim().length > b.text.trim().length
}

export function deduplicateReviews<T extends { text: string }>(reviews: T[], opts: OpcoesDeduplicacao = {}): T[] {
  const kept: T[] = []
  const fingerprints: Array<Set<string>> = []
  const shortKeys = new Set<string>()
  for (const r of reviews) {
    const fp = reviewTextFingerprint(r.text)
    if (fp.size < 4) {
      const key = r.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60)
      if (shortKeys.has(key)) continue
      shortKeys.add(key)
      kept.push(r)
      fingerprints.push(fp)
      continue
    }
    const i = fingerprints.findIndex((existing) => mesmaManifestacao(fp, existing))
    if (i === -1) {
      kept.push(r)
      fingerprints.push(fp)
    } else if (opts.preferirVersaoMaisCompleta && maisCompleta(r, fp, kept[i], fingerprints[i])) {
      kept[i] = r
      fingerprints[i] = fp
      absorverCopiasJaGuardadas(kept, fingerprints, i)
    }
  }
  return kept
}

/**
 * A nova representante pode cobrir uma review que JÁ foi guardada como distinta: a versão inteira de
 * uma review que noutra plataforma veio dividida em duas postagens (caso real: *The Grand Duke's Bride
 * Is a Warrior From Hell*, ComicK em 2 partes × Comix inteira). Sem isto a cópia sobra na saída, a
 * dedup do prompt a tira depois e, num pool acima da capacidade, a vaga dela se perde.
 * Junta cada cópia coberta: fica a versão mais completa, na posição mais antiga; nada é combinado.
 */
function absorverCopiasJaGuardadas<T extends { text: string }>(kept: T[], fingerprints: Array<Set<string>>, i: number): void {
  for (let j = 0; j < kept.length; j++) {
    if (j === i || fingerprints[j].size < 4 || !mesmaManifestacao(fingerprints[i], fingerprints[j])) continue
    const [fica, sai] = j < i ? [j, i] : [i, j]
    if (maisCompleta(kept[sai], fingerprints[sai], kept[fica], fingerprints[fica])) {
      kept[fica] = kept[sai]
      fingerprints[fica] = fingerprints[sai]
    }
    kept.splice(sai, 1)
    fingerprints.splice(sai, 1)
    i = fica
    j = -1 // a representante pode ter mudado: recomeça a varredura
  }
}
