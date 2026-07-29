import { isTerminalPersonalStatus } from "@/lib/constants/status-lookups"

/**
 * A regra "só avalia quem leu": uma obra só pode receber nota pessoal (`user_score`) e as
 * avaliações pós-leitura quando o estado de leitura comprova leitura suficiente.
 *
 * ⚠️ Esta é a ÚNICA fonte da regra. Ela morava como um `const` local em `post-reading-flow.tsx`
 * e era só um gate de VISIBILIDADE no cliente — escondia as seções, mas nenhuma escrita a
 * consultava. O resultado: 42 das 219 obras com nota ficaram com nota sem ter leitura registrada
 * (19 "On-hold", 10 "Stalled", 5 "Untracked"…), porque `tastePatchFrom` regrava `user_score` a
 * cada save de status e NADA nunca a limpa quando o estado de leitura regride.
 *
 * Quem grava nota tem que chamar `canRateReadingState` — o gate do cliente sozinho não é regra,
 * é decoração: server action é endpoint público.
 */

/** Fração mínima lida (%) pra uma obra NÃO-terminal poder receber nota. Estrito (`>`). */
export const MIN_READ_PCT_FOR_RATING = 20

export interface ReadingStateForRating {
  /** Id OU nome do status pessoal — `isTerminalPersonalStatus` aceita os dois. */
  personalStatus: number | string | null | undefined
  chaptersRead: number | null | undefined
  totalChapters: number | null | undefined
}

/**
 * Progresso de leitura em % — `null` quando não dá pra calcular (total desconhecido/zero ou
 * capítulos lidos não registrados). `null` NÃO é 0%: é "não sei", e o gate trata como
 * insuficiente porque a obra não provou leitura.
 */
export function readProgressPct(state: ReadingStateForRating): number | null {
  const total = state.totalChapters
  const read = state.chaptersRead
  if (total == null || total <= 0) return null
  if (read == null) return null
  return (read / total) * 100
}

/**
 * A obra pode ter nota pessoal? Status terminal (Finished/Dropped — o leitor encerrou, então
 * formou opinião) OU mais de 20% lido.
 *
 * "Terminal" vem do banco (`personal_status.is_terminal`), nunca de nome escrito à mão.
 */
export function canRateReadingState(state: ReadingStateForRating): boolean {
  if (isTerminalPersonalStatus(state.personalStatus)) return true
  const pct = readProgressPct(state)
  return pct != null && pct > MIN_READ_PCT_FOR_RATING
}

/**
 * Quantos capítulos faltam pra a obra passar do limiar. `null` quando o total é desconhecido
 * (aí não há alvo a informar) ou quando já passa. Serve pro texto do aviso na UI.
 */
export function chaptersNeededForRating(state: ReadingStateForRating): number | null {
  if (canRateReadingState(state)) return null
  const total = state.totalChapters
  if (total == null || total <= 0) return null
  const needed = Math.floor((total * MIN_READ_PCT_FOR_RATING) / 100) + 1
  return Math.max(0, needed - (state.chaptersRead ?? 0))
}
