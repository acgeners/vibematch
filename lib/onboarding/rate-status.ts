import { PERSONAL_STATUSES } from "@/types/domain"
import type { PersonalStatus } from "@/types/domain"
import {
  FULLY_READ_STATUS,
  isTerminalPersonalStatus,
  personalStatusNameBySlugOrThrow,
  readingPersonalStatusName,
  tracksProgressPersonalStatus,
} from "@/lib/constants/status-lookups"
import { canRateReadingState, firstRatableChapter, MIN_READ_PCT_FOR_RATING } from "@/lib/reading-gate"
import type { OnboardingDeckWork } from "@/server/queries/onboarding-deck"

/**
 * O status de leitura na tela de notas (boas-vindas e "Dar notas").
 *
 * Até 20/11/2026 a tela tinha um vocabulário PRÓPRIO (Terminei · Larguei · Estou lendo) e não lia o
 * status gravado: toda obra aparecia como "Terminei". Medido na conta da dona, 41 obras na lista e
 * nenhuma Finished — 25 Started, 12 Reading, 2 On-hold, 2 Stalled. A escala liberava por esse
 * "Terminei" de mentira e o servidor, que lê o status real, guardava a nota sem virar rótulo em 28
 * delas: a nota aparecia na tela e não contava. Hoje a linha começa no status do banco, com os
 * nomes e o selo do resto do site, e a trava é a mesma regra do servidor (`canRateReadingState`).
 */

/** A obra na lista de notas: a do deck mais o estado de leitura gravado. */
export interface RateListWork extends OnboardingDeckWork {
  status: PersonalStatus
  chaptersRead: number | null
}

/**
 * Está na lista "já li, falta a nota"? Os status que acompanham progresso, os terminais incluídos.
 * Sai das FLAGS do banco: a consulta (`readStatusIds`) e a tela usam a mesma régua.
 */
export function isRateListStatus(status: number | string | null | undefined): boolean {
  return tracksProgressPersonalStatus(status) || isTerminalPersonalStatus(status)
}

/** O status que o "Já li" do deck grava (`deckSwipeAction`). */
export const DECK_READ_STATUS = personalStatusNameBySlugOrThrow("finished") as PersonalStatus

/** A saída da lista pelo menu: "ainda não li". */
export const WANT_TO_READ_STATUS = personalStatusNameBySlugOrThrow("want-to-read") as PersonalStatus

const DROPPED_STATUS = personalStatusNameBySlugOrThrow("dropped") as PersonalStatus
const READING_STATUS = readingPersonalStatusName()

/**
 * O menu de status da linha: os da lista e o Want to Read, na ordem do site. Not Now, Untracked e
 * Not Interested ficam fora (decisão de 20/11/2026): tirar a obra daqui é a lixeira.
 */
export const RATE_MENU_STATUSES: PersonalStatus[] = PERSONAL_STATUSES.filter(
  (s) => isRateListStatus(s) || s === WANT_TO_READ_STATUS,
)

/** O campo de capítulo aparece? Nos que acompanham progresso e não encerraram a leitura. */
export function asksChapter(status: number | string | null | undefined): boolean {
  return tracksProgressPersonalStatus(status) && !isTerminalPersonalStatus(status)
}

/** Os capítulos depois de trocar o status: Finished = a obra inteira (a régua de `setReadingStatusForWorks`). */
export function chaptersAfterStatus(
  status: PersonalStatus,
  chapters: number | null,
  totalChapters: number | null,
): number | null {
  if (status === FULLY_READ_STATUS && totalChapters != null && totalChapters > 0) return totalChapters
  return chapters
}

/**
 * A escala de nota fica travada? Quem decide é `canRateReadingState`, a regra que a nota rápida
 * aplica no servidor; aqui só se escolhe o texto que diz como destravar.
 */
export function rateLock(
  status: PersonalStatus,
  chapters: number | null,
  totalChapters: number | null,
): { locked: boolean; text: string | null } {
  if (canRateReadingState({ personalStatus: status, chaptersRead: chapters, totalChapters })) {
    return { locked: false, text: null }
  }
  const first = firstRatableChapter(totalChapters)
  if (first == null) {
    return {
      locked: true,
      text:
        status === READING_STATUS
          ? "Sem o total de capítulos da obra, a nota só vale com o capítulo em branco."
          : `Sem o total de capítulos da obra, a nota só vale com ${FULLY_READ_STATUS} ou ${DROPPED_STATUS}.`,
    }
  }
  if (chapters == null) {
    return { locked: true, text: `Diga em que capítulo parou: a nota vale a partir do cap. ${first}.` }
  }
  return { locked: true, text: `Nota a partir do cap. ${first} (mais de ${MIN_READ_PCT_FOR_RATING}% lido).` }
}

/** O subtítulo do grupo recolhido das travadas. */
// "Mais de", não "a partir de": a regra é estrita (`MIN_READ_PCT_FOR_RATING`), 20% exato não libera.
export const LOCKED_GROUP_HINT = `A nota vale com mais de ${MIN_READ_PCT_FOR_RATING}% dos capítulos lidos. Diga em que capítulo parou, ou marque ${FULLY_READ_STATUS} ou ${DROPPED_STATUS}.`
