/**
 * Reviews e síntese de reviews de uma obra `mixed` vistas na VERSÃO NORMAL — módulo PURO.
 *
 * 🔴 Não há separação real a fingir: medido em 2026-10-10 nas 140 mixed, das 5.941 reviews só 141
 * dizem qual edição o leitor leu (2,4%), e o digest é uma síntese da obra inteira. Então a versão
 * normal NÃO ganha "as reviews dela" — ganha as reviews da OBRA, rotuladas como tal, menos o texto
 * que cita conteúdo sexual explícito (que a R15 não mostra). Medido no mesmo retrato:
 *
 * | o que cita sexo explícito                 | quanto                          |
 * |-------------------------------------------|---------------------------------|
 * | reviews                                   | 756 de 5.941 (12,7%), em 124 obras |
 * | síntese estruturada (prosa ou traços)     | 62 de 116 obras com síntese     |
 * | resumo em prosa                           | 24 obras                        |
 *
 * ⚠️ A síntese sai INTEIRA quando cita, em vez de frase a frase: cortar uma frase do consenso
 * reescreveria o texto do modelo, e o que sobra continuaria sendo a leitura das duas edições. Os
 * AVISOS de conteúdo são exceção — cada um é um item com sentido próprio, e a régua por item
 * (`isR18ExclusiveWarning`) os separa sem reescrever nada.
 * ⚠️ Na versão R18 (e em obra não-mixed) tudo passa intacto.
 */
import type { MixedEdition } from "@/lib/editions/mixed-edition"
import { isR18ExclusiveWarning, mentionsExplicitSexualContent } from "@/lib/editions/edition-content"

interface ReviewLike {
  text: string
}
interface DigestLike {
  consensus?: string | null
  execution?: string | null
  divergence?: string | null
  salient_traits?: unknown
  content_warnings?: unknown
}
export interface ReviewsSnapshotLike {
  total: number
  bySource: Array<{ source: string; reviews: ReviewLike[] }>
  manual: ReviewLike[]
  summary: string | null
  digest: DigestLike | null
}

export interface EditionReviewsView<S> {
  snapshot: S
  /** A síntese (digest e/ou resumo) cita conteúdo explícito e saiu da versão normal. */
  synthesisHidden: boolean
  /** Quantas reviews saíram da versão normal por citarem conteúdo explícito. */
  reviewsHidden: number
}

const textOfWarning = (w: unknown): string => (typeof w === "string" ? w : JSON.stringify(w ?? ""))

function digestMentionsExplicit(d: DigestLike): boolean {
  if ([d.consensus, d.execution, d.divergence].some((t) => mentionsExplicitSexualContent(t))) return true
  const traits = Array.isArray(d.salient_traits) ? d.salient_traits : []
  return traits.some((t) => mentionsExplicitSexualContent(typeof t === "string" ? t : JSON.stringify(t)))
}

export function reviewsForEdition<S extends ReviewsSnapshotLike>(snapshot: S, edition: MixedEdition | null): EditionReviewsView<S> {
  if (edition !== "normal") return { snapshot, synthesisHidden: false, reviewsHidden: 0 }

  let hidden = 0
  const keep = <R extends ReviewLike>(list: R[]): R[] =>
    list.filter((r) => {
      const out = mentionsExplicitSexualContent(r.text)
      if (out) hidden++
      return !out
    })
  const bySource = snapshot.bySource
    .map((s) => ({ ...s, reviews: keep(s.reviews) }))
    .filter((s) => s.reviews.length > 0)
  const hiddenExternal = hidden
  const manual = keep(snapshot.manual)

  const digest = snapshot.digest
  const digestHidden = digest != null && digestMentionsExplicit(digest)
  const summaryHidden = mentionsExplicitSexualContent(snapshot.summary)
  const synthesisHidden = digestHidden || summaryHidden
  const filteredDigest =
    digest == null || synthesisHidden
      ? null
      : {
          ...digest,
          content_warnings: Array.isArray(digest.content_warnings)
            ? digest.content_warnings.filter((w) => !isR18ExclusiveWarning(textOfWarning(w)))
            : digest.content_warnings,
        }

  return {
    snapshot: {
      ...snapshot,
      total: Math.max(0, snapshot.total - hiddenExternal),
      bySource: bySource as S["bySource"],
      manual: manual as S["manual"],
      // Síntese que cita conteúdo explícito sai INTEIRA (digest e resumo juntos: um descreve o outro).
      summary: synthesisHidden ? null : snapshot.summary,
      digest: filteredDigest as S["digest"],
    },
    synthesisHidden,
    reviewsHidden: hidden,
  }
}
