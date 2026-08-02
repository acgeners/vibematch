/**
 * Tags que dizem "existe uma edição R19/não-censurada desta obra em outra
 * fonte" — metadado de EDIÇÃO, deliberadamente `adult_indicator` fraco/false
 * (ver migração 161 e o comentário em lib/ai-evaluation/adult-content-rules.ts).
 * Distinto de tags que afirmam que a OBRA CATALOGADA é a edição explícita
 * (ex.: "R19 Version", que já é `adult_indicator_strong`).
 *
 * Usado por `EditionNoteBadge` (página da obra) e pelos painéis de
 * Consolidação (nota explicativa ao revisar tag nova parecida).
 */
export const EDITION_NOTE_TAG_NAMES: ReadonlySet<string> = new Set([
  "Uncensored Version Available",
  "Official English R19 Version Available",
])

export function hasEditionNoteTag(tagNames: Iterable<string | null | undefined>): boolean {
  for (const name of tagNames) {
    if (name && EDITION_NOTE_TAG_NAMES.has(name)) return true
  }
  return false
}
