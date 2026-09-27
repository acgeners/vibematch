/**
 * Tags que dizem "existe uma edição R19/não-censurada desta obra além da R15" —
 * metadado de EDIÇÃO, deliberadamente `adult_indicator` false (ver migração 161 e
 * o comentário em lib/ai-evaluation/adult-content-rules.ts).
 *
 * Desde a migração 199 é UMA tag só, "R19 disponível" (as antigas "Uncensored
 * Version Available" e "Official English R19 Version Available" viraram alias
 * dela). Quem decide filtro e ocultação é `works.r19_edition`, mantida por gatilho
 * a partir de `tags.marks_r19_edition` — este Set serve só à EXIBIÇÃO.
 * Distinto de tags que afirmam que a OBRA CATALOGADA é a edição explícita
 * (ex.: "R19 Version", que já é `adult_indicator_strong`).
 *
 * Usado por `EditionNoteBadge` (página da obra) e pelos painéis de
 * Consolidação (nota explicativa ao revisar tag nova parecida).
 */
export const EDITION_NOTE_TAG_NAMES: ReadonlySet<string> = new Set([
  "R19 disponível",
])

export function hasEditionNoteTag(tagNames: Iterable<string | null | undefined>): boolean {
  for (const name of tagNames) {
    if (name && EDITION_NOTE_TAG_NAMES.has(name)) return true
  }
  return false
}
