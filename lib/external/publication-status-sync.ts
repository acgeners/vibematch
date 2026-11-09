/**
 * Regra ÚNICA do status de publicação que vem das fontes, decidida em 2026-11-09.
 *
 * Vale para as três rotas que gravam o status sem um humano escolhendo: a checagem da
 * `/reading`, o lote do catálogo (`/curation/settings?g=fontes`) e o "Atualizar automático"
 * da obra. O "Atualizar dados" do curador continua mostrando o conflito: lá quem decide é ele.
 *
 *  1. **O MangaUpdates decide; o Comix só sem ele.** As fontes discordam quase sempre (a AniList
 *     atrasa, o Comix diz "releasing" em obra concluída), então "conflito entre fontes" não pode
 *     travar a escrita. Medido em 2026-11-09: em 5 obras que o MangaUpdates dava como concluídas,
 *     o "Atualizar automático" via conflito nas 5 e não gravava nada.
 *  2. **Nunca tira uma obra de Completed ou Cancelled.** Fonte que volta atrás é mais provável
 *     de estar errada que a obra ter "des-terminado".
 *  3. **"Ongoing" só pelo MangaUpdates, e só sobre obra em Hiatus ou sem status conhecido.** É o
 *     fim do hiato. Até 2026-11-09 a regra nunca gravava "Ongoing", e obra que voltava a sair
 *     ficava marcada como Hiatus para sempre — na amostra medida, 4 das 22 obras em hiato já
 *     tinham voltado. O Comix não entra aqui porque o status dele não separa "em andamento" de
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

export interface PublicationStatusDecision {
  status: string
  source: StatusSourceId
}

/**
 * O status a GRAVAR, ou `null` quando nada muda. `current` é o nome gravado hoje
 * ("Completed", "Ongoing", "Hiatus", "Cancelled", "Unknown" ou `null`).
 */
export function decidePublicationStatus(
  current: string | null | undefined,
  external: { mangaupdates?: string | null; comix?: string | null },
): PublicationStatusDecision | null {
  const mu = known(external.mangaupdates)
  const comix = known(external.comix)
  const pick: PublicationStatusDecision | null = mu
    ? { status: mu, source: "mangaupdates" }
    : comix
      ? { status: comix, source: "comix" }
      : null
  if (!pick) return null

  if (current != null && TERMINAL.has(current)) return null
  if (pick.status === current) return null

  if (pick.status === "Ongoing") {
    if (pick.source !== "mangaupdates") return null
    const semStatus = current == null || current === "Unknown"
    if (current !== "Hiatus" && !semStatus) return null
  }
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
