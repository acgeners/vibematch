/**
 * As regras que fazem PUBLICAÇÃO e LEITURA se falarem — como função pura, num lugar só.
 *
 * Duas delas já existiam, mas moravam DENTRO do `WorkStatusForm` (e uma cópia parcial no
 * `updateWorkStatus`). Enquanto foram efeito de componente, valiam só pra quem passasse pelo
 * diálogo: o atalho da faixa da página da obra chama `setReadingStatusForWorks`, que grava
 * `personal_status_id` e mais nada — e foi assim que nasceu o estado do print, "Finished com
 * 6/26 capítulos numa obra Ongoing". Regra de coerência que mora na tela não é regra; é dica.
 *
 * Aqui elas são funções puras, testáveis, aplicadas nos DOIS lados (cliente e server action —
 * que é endpoint público). Nada aqui lê banco nem sessão.
 *
 * ── Duas famílias, e a diferença importa ────────────────────────────────────────────────
 *
 *  · **Automáticas** (`clampChaptersRead`, `chaptersForFullyRead`, `promoteStatusForProgress`)
 *    resolvem contradições ARITMÉTICAS, onde só existe uma leitura possível do que o usuário
 *    quis dizer. Aplicam sozinhas.
 *
 *  · **Avisos** (`evaluateReadingCoherence`) tratam do que depende de dado que pode estar
 *    ERRADO. `works.publication_status_id` vem de fonte externa e envelhece: bloquear
 *    "Finished" numa obra marcada Ongoing impediria registrar a verdade quando quem está
 *    desatualizado é o catálogo. Então avisa, oferece a saída, e a decisão continua sendo de
 *    quem lê.
 */

import {
  FULLY_READ_STATUS,
  getPublicationStatusNameById,
  isConcludedPublicationStatus,
  isFullyReadPersonalStatus,
  isStillPublishingStatus,
  isTerminalPersonalStatus,
  personalStatusNameOrDefault,
  readingPersonalStatusName,
  tracksProgressPersonalStatus,
} from "@/lib/constants/status-lookups"

/** Status pessoal como id (`personal_status_id`) ou nome — `null` = sem linha no espelho. */
export type PersonalStatusRef = number | string | null | undefined

export interface ReadingCoherenceInput {
  personalStatus: PersonalStatusRef
  /** `works.publication_status_id` — catálogo, compartilhado. */
  publicationStatusId: number | null | undefined
  chaptersRead: number | null | undefined
  /** `works.total_chapters`; `null` quando o catálogo não sabe — aí nenhuma regra dispara. */
  totalChapters: number | null | undefined
}

/** Total conhecido e > 0, ou null. Sem total não há % , não há teto e não há coerência a checar. */
function knownTotal(totalChapters: number | null | undefined): number | null {
  if (totalChapters == null) return null
  const n = Math.floor(Number(totalChapters))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * O teto HONESTO de capítulos: o maior entre o total do catálogo e o que já está gravado.
 *
 * `works.total_chapters` é curadoria e atrasa — a `/leitura` marca "até o último lançado" a
 * partir da checagem externa, e é normal ter 132 lidos numa obra cujo catálogo ainda diz 120.
 * Um teto cru no total transformaria a próxima edição de status num APAGAMENTO silencioso de
 * 12 capítulos de progresso real. Limitar o que a pessoa acabou de digitar é correção; reduzir
 * o que já estava lá é perda de dado.
 */
export function chapterCeiling(
  totalChapters: number | null | undefined,
  currentRead: number | null | undefined,
): number | null {
  const total = knownTotal(totalChapters)
  const read = Math.floor(Number(currentRead ?? 0))
  const floorFromRead = Number.isFinite(read) && read > 0 ? read : null
  if (total == null) return floorFromRead
  if (floorFromRead == null) return total
  return Math.max(total, floorFromRead)
}

export interface ClampedChapters {
  /** O valor que deve ser gravado. */
  value: number
  /** O que o usuário pediu (já normalizado pra inteiro ≥ 0). */
  requested: number
  /** true quando `value !== requested` — a UI usa pra explicar o que fez. */
  clamped: boolean
}

/**
 * Capítulos lidos nunca passam do total conhecido nem descem de zero.
 *
 * O stepper já respeitava isso porque nunca gerava um valor fora da faixa; o campo digitável
 * gera. Devolver `clamped` (em vez de só corrigir) é o que permite dizer "você digitou 40, o
 * catálogo conhece 26" — silêncio aqui vira "o app comeu o que eu digitei".
 */
export function clampChaptersRead(
  requested: number | null | undefined,
  totalChapters: number | null | undefined,
): ClampedChapters {
  const raw = Math.floor(Number(requested ?? 0))
  const safe = Number.isFinite(raw) ? Math.max(0, raw) : 0
  const total = knownTotal(totalChapters)
  const value = total != null ? Math.min(total, safe) : safe
  return { value, requested: safe, clamped: value !== safe }
}

/**
 * "Finished" quer dizer que a obra foi lida inteira → capítulos lidos = total.
 *
 * Devolve o novo valor, ou `null` quando não há o que corrigir (status não é "leu tudo", total
 * desconhecido, ou já está no fim).
 */
export function chaptersForFullyRead(input: {
  personalStatus: PersonalStatusRef
  chaptersRead: number | null | undefined
  totalChapters: number | null | undefined
}): number | null {
  if (!isFullyReadPersonalStatus(nameOf(input.personalStatus))) return null
  const total = knownTotal(input.totalChapters)
  if (total == null) return null
  const read = Math.floor(Number(input.chaptersRead ?? 0))
  if (Number.isFinite(read) && read >= total) return null
  return total
}

/** O que provocou a checagem: o usuário mexeu nos CAPÍTULOS ou escolheu um STATUS. */
export type CoherenceTrigger = "chapters" | "status"

/**
 * Progresso > 0 num status que não acompanha progresso ⇒ promove pra "Reading".
 *
 * Quais são esses status vem do banco, não de uma lista de nomes: `tracks_progress = false` na
 * `personal_status` (migration 155) marca exatamente os quatro "não comecei" — Want to Read,
 * Not Now, Untracked e Not Interested.
 *
 * ⚠️ **A DIREÇÃO importa, e é por isso que existe o `trigger`.** Marcar capítulo lido numa obra
 * "Untracked" é dizer "comecei" → promove. Escolher "Untracked" numa obra com 26 capítulos
 * lidos é dizer "tira isso do meu acompanhamento" → NÃO promove, senão a pessoa nunca mais
 * consegue destrackear nada que leu (são 667 obras em Untracked hoje). A exceção é o status
 * default (`is_default_unset`, "Want to Read"): ele não é escolha, é a ausência de linha, e
 * promovê-lo dos dois lados é o comportamento que o form já tinha desde antes.
 *
 * Devolve o NOME do status novo, ou `null` quando não há promoção.
 */
export function promoteStatusForProgress(
  input: { personalStatus: PersonalStatusRef; chaptersRead: number | null | undefined },
  trigger: CoherenceTrigger,
): string | null {
  const read = Math.floor(Number(input.chaptersRead ?? 0))
  if (!Number.isFinite(read) || read <= 0) return null

  const name = nameOf(input.personalStatus)
  if (tracksProgressPersonalStatus(name)) return null

  const isUnsetDefault = name === personalStatusNameOrDefault(null)
  if (!isUnsetDefault && trigger === "status") return null

  const reading = readingPersonalStatusName()
  return name === reading ? null : reading
}

export type ReadingCoherenceIssue =
  | {
      /** Marcou "leu a obra inteira" numa obra que ainda está saindo. */
      kind: "finished-while-publishing"
      /** Nome da publicação ("Ongoing" / "Hiatus") — entra no texto do aviso. */
      publicationStatus: string
      /** Pra onde o botão de 1 clique leva: quem leu tudo que saiu está EM DIA, não terminou. */
      suggestedStatus: string
      chaptersRead: number
      totalChapters: number | null
    }
  | {
      /** Chegou ao último capítulo de uma obra concluída — convite, não correção. */
      kind: "finish-suggested"
      suggestedStatus: string
      totalChapters: number
    }

/**
 * O aviso a exibir, ou `null` quando publicação e leitura combinam.
 *
 * Só UM por vez, e nesta ordem: uma contradição vale mais que um convite.
 *
 * `Cancelled` e `Unknown` não geram nada — na primeira a obra acabou incompleta (marcar
 * "Finished" é legítimo e sugerir seria presunção), e na segunda o catálogo admite que não
 * sabe. `Dropped` também não é incoerência: largar uma obra em publicação é o caso normal.
 */
export function evaluateReadingCoherence(
  input: ReadingCoherenceInput,
): ReadingCoherenceIssue | null {
  const name = nameOf(input.personalStatus)
  const total = knownTotal(input.totalChapters)
  const read = Math.max(0, Math.floor(Number(input.chaptersRead ?? 0)) || 0)

  if (isFullyReadPersonalStatus(name) && isStillPublishingStatus(input.publicationStatusId)) {
    return {
      kind: "finished-while-publishing",
      publicationStatus: getPublicationStatusNameById(input.publicationStatusId) ?? "em publicação",
      suggestedStatus: readingPersonalStatusName(),
      chaptersRead: read,
      totalChapters: total,
    }
  }

  if (
    isConcludedPublicationStatus(input.publicationStatusId) &&
    total != null &&
    read >= total &&
    !isTerminalPersonalStatus(name)
  ) {
    return { kind: "finish-suggested", suggestedStatus: FULLY_READ_STATUS, totalChapters: total }
  }

  return null
}

/** id/nome/null → nome canônico, com o default de quem não tem linha no espelho. */
function nameOf(status: PersonalStatusRef): string {
  if (status == null) return personalStatusNameOrDefault(null)
  if (typeof status === "number") return personalStatusNameOrDefault(status)
  return status
}
