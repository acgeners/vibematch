/**
 * Regra ÚNICA do status de publicação que vem das fontes.
 *
 * 🔴 **O status é o da TRADUÇÃO disponível, não o do original** (decisão da Ana, 2026-11-16) —
 * a mesma régua do número de capítulos (`pickTotalChapters`, último capítulo disponível). Obra
 * concluída no original com capítulos ainda por traduzir está EM ANDAMENTO. O sinal é a
 * contagem: o total do original (cabeçalho do MangaUpdates, "78 Chapters (Complete)") contra o
 * último capítulo disponível. A marca "Completely scanlated" do MangaUpdates NÃO serve: medido
 * em 16/11, ela dizia "incompleta" em 65 obras que a Comix tem inteiras (licenciadas, em que a
 * tradução de fãs parou) e "completa" em 35 com capítulos faltando.
 *
 * Vale para as três rotas que gravam o status sem um humano escolhendo — a checagem da
 * `/reading`, o lote do catálogo e o "Atualizar automático" — e para o valor proposto no
 * cadastro e no "Atualizar dados". Quando as fontes divergem entre si, o curador ainda escolhe.
 *
 *  1. **O MangaUpdates decide; o Comix só sem ele.** As fontes discordam quase sempre (a AniList
 *     atrasa, o Comix diz "releasing" em obra concluída), então "conflito entre fontes" não pode
 *     travar a escrita.
 *  2. **Só o MangaUpdates tira uma obra de Completed ou Cancelled.** Até 16/11 nada tirava, e
 *     obra marcada concluída por engano ficava presa: medido, 10 com o MangaUpdates dizendo
 *     Ongoing. Sem ele, o Comix não desfaz um status terminal.
 *  3. **"Ongoing" só pelo MangaUpdates.** O status do Comix não separa "em andamento" de
 *     "concluída com a tradução saindo" (ver `lib/external/chapter-total.ts`).
 *
 * Status é feature do Ridge: quem grava o resultado marca o recálculo.
 */

export type StatusSourceId = "mangaupdates" | "comix"

const KNOWN = new Set(["Completed", "Ongoing", "Hiatus", "Cancelled"])
const TERMINAL = new Set(["Completed", "Cancelled"])

function known(status: string | null | undefined): string | null {
  return status != null && KNOWN.has(status) ? status : null
}

/** O que se sabe da tradução: o total do original e o último capítulo disponível para ler. */
export interface TranslationEvidence {
  originalChapters?: number | null
  availableChapters?: number | null
}

/** `true` quando há capítulos do original que ainda não estão disponíveis. Sem as duas contagens, `false`. */
export function translationBehind(t: TranslationEvidence | undefined): boolean {
  const original = t?.originalChapters
  const available = t?.availableChapters
  return original != null && original > 0 && available != null && available > 0 && available < original
}

/**
 * O status do ORIGINAL traduzido para o status da TRADUÇÃO: enquanto faltar capítulo do
 * original, a tradução está em andamento — mesmo com o original concluído, cancelado ou em
 * hiato. Sem contagem, fica o status do original.
 */
export function statusByTranslation(original: string, t: TranslationEvidence | undefined): string {
  if (original === "Ongoing" || !KNOWN.has(original)) return original
  return translationBehind(t) ? "Ongoing" : original
}

export interface PublicationStatusDecision {
  status: string
  source: StatusSourceId
}

/**
 * O status a GRAVAR, ou `null` quando nada muda. `current` é o nome gravado hoje
 * ("Completed", "Ongoing", "Hiatus", "Cancelled", "Unknown" ou `null`). `external` traz o status
 * do ORIGINAL em cada fonte; `translation`, as contagens que o traduzem.
 */
export function decidePublicationStatus(
  current: string | null | undefined,
  external: { mangaupdates?: string | null; comix?: string | null },
  translation?: TranslationEvidence,
): PublicationStatusDecision | null {
  const mu = known(external.mangaupdates)
  const comix = known(external.comix)
  const pick: PublicationStatusDecision | null = mu
    ? { status: statusByTranslation(mu, translation), source: "mangaupdates" }
    : comix
      ? { status: comix, source: "comix" }
      : null
  if (!pick) return null
  if (pick.status === current) return null

  if (current != null && TERMINAL.has(current) && pick.source !== "mangaupdates") return null
  if (pick.status === "Ongoing" && pick.source !== "mangaupdates") return null
  return pick
}

/**
 * Lê o status de cada fonte da procedência que o merge multi-fonte já calcula
 * (`ExternalWorkData.fieldProvenance.publicationStatus`).
 */
export function statusBySource(
  provenance: ReadonlyArray<{ value: string | number; sources: readonly string[] }> | undefined,
): { mangaupdates: string | null; comix: string | null } {
  const of = (source: StatusSourceId): string | null => {
    const entry = provenance?.find((p) => p.sources.includes(source))
    return entry ? String(entry.value) : null
  }
  return { mangaupdates: of("mangaupdates"), comix: of("comix") }
}

