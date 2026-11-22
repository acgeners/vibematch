import { canRateReadingState } from "@/lib/reading-gate"

/**
 * 🔴 Categorias de gosto completas, com a leitura liberada, SÃO a nota da obra (regra da Ana, 22/11/2026):
 * "não é pra acontecer de ter nota das categorias e não ter nota na obra".
 *
 * Aconteceu em 4 obras da dona, e o histórico de notas (`prediction_ledger`) mostra a nota sendo dada e
 * depois sumindo — o "Salvar" do formulário de status regravava a nota de quando a página abriu (corrigido
 * em `ratingPatchFrom`). Mas aquele era UM jeito de chegar lá; outro é a categoria completar com a leitura
 * travada (a nota não é gravada) e a trava abrir depois. Por isso a regra mora no ESCRITOR do estado de
 * leitura (`writeReadingState`/`mirrorOwnerState`), que é por onde passa todo caminho que mexe em nota,
 * status ou capítulos — não em cada tela.
 *
 * Esta é a decisão pura: quais obras SEM nota ganham qual nota. Só preenche o que está vazio; nota que já
 * existe não é tocada aqui.
 */
export interface UnlabeledState {
  workId: string
  personalStatusId: number | null
  chaptersRead: number | null
  totalChapters: number | null
}

export function tasteLabelsToRestore(
  rows: UnlabeledState[],
  /** A nota das categorias (`computeTasteUserScore`) por obra; ausente ou `null` = incompleta. */
  labelByWork: Map<string, number | null>,
): Map<number, string[]> {
  const out = new Map<number, string[]>()
  for (const r of rows) {
    const label = labelByWork.get(r.workId)
    if (label == null) continue
    const ok = canRateReadingState({
      personalStatus: r.personalStatusId,
      chaptersRead: r.chaptersRead,
      totalChapters: r.totalChapters,
    })
    if (!ok) continue
    out.set(label, [...(out.get(label) ?? []), r.workId])
  }
  return out
}

/** O patch mexe no que decide a nota (ela mesma, o status ou os capítulos)? Só aí vale reconferir. */
export function touchesLabelOrGate(patch: object): boolean {
  return ["user_score", "personal_status_id", "chapters_read"].some((k) => Object.prototype.hasOwnProperty.call(patch, k))
}
