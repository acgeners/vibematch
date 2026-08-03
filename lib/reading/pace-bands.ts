/**
 * As bandas de RITMO da /leitura, como regra pura — para a home destacar exatamente o que
 * aquela página chama de "Acompanhando", em vez de inventar um critério paralelo.
 *
 * A matriz é % lido × recência da leitura, com o hiato de publicação na frente de tudo.
 *
 * ✅ FONTE ÚNICA desde 2026-08-03: `components/reading/reading-list.tsx` importa daqui.
 * Ele tinha a própria cópia dos três limiares e da classificação — enquanto existiram duas,
 * mudar um limiar num lugar e não no outro fazia a home e a /leitura discordarem sobre a
 * MESMA obra, sem erro nenhum. Quem for mexer nos limiares mexe aqui, e os dois andam juntos.
 */

import { differenceInCalendarDays } from "date-fns"

export const ONPACE_PCT = 0.85 // ≥ 85% lido (e recente) → Acompanhando (quase no fim)
export const BEHIND_PCT = 0.4 // < 40% lido → Atrasado (independe da recência)
export const STALE_DAYS = 30 // ≥ 30 dias sem ler → "frio"

export type ReadingBand = "onpace" | "uptodate" | "trailing" | "slowing" | "hiatus" | "behind"

export interface PaceInput {
  /** Capítulos lidos por quem está olhando. */
  chaptersRead: number | null
  /** Total conhecido de capítulos; null quando a fonte não sabe. */
  totalChapters: number | null
  /** Capítulos não lidos (total − lidos), já calculado pela query. */
  pending: number | null
  /** Última leitura de quem está olhando (ISO). */
  lastReadAt: string | null
  /** True quando a PUBLICAÇÃO está em hiato oficial. */
  publicationHiatus: boolean
}

/**
 * Dias de CALENDÁRIO desde `iso`. `Infinity` quando nulo/inválido — nunca conta como recente.
 *
 * Calendário, não janelas de 24 h: uma leitura às 23h de ontem é "1 dia atrás" à 1h de hoje,
 * não "0". Era o que a /leitura já fazia (`differenceInCalendarDays`) e o que a doc daqui já
 * afirmava — a implementação anterior, com `Math.floor(ms / 86.400.000)`, é que discordava
 * das duas. Com 30 dias de limiar a diferença só aparece na fronteira, mas quando aparece
 * põe a mesma obra em bandas diferentes na home e na /leitura.
 */
export function daysSince(iso: string | null, now: Date = new Date()): number {
  if (!iso) return Infinity
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return Infinity
  return differenceInCalendarDays(now, d)
}

/** Fração lida (0–1), ou null quando o total é desconhecido. */
export function progressOf(input: PaceInput): number | null {
  const { chaptersRead, totalChapters } = input
  if (!totalChapters || totalChapters <= 0) return null
  return Math.min(1, (chaptersRead ?? 0) / totalChapters)
}

/**
 * Classifica numa das 6 bandas. Ordem de avaliação — a primeira que casa vence, igual à
 * /leitura: hiato oficial > sem total > em dia > atrasado > frio > no ritmo.
 */
export function classifyPace(input: PaceInput, now: Date = new Date()): ReadingBand {
  if (input.publicationHiatus) return "hiatus"

  const pct = progressOf(input)
  // Sem total conhecido não dá pra medir progresso: fica em "Acompanhando" (neutro).
  if (input.pending == null || pct == null) return "onpace"

  const stale = daysSince(input.lastReadAt, now) >= STALE_DAYS
  if (input.pending === 0) return stale ? "hiatus" : "uptodate"
  if (pct < BEHIND_PCT) return "behind"
  if (stale) return "slowing"
  if (pct >= ONPACE_PCT) return "onpace"
  return "trailing"
}

/**
 * A "atividade mais recente" da obra: o mais novo entre a sua última leitura e o último
 * capítulo lançado. Serve de ordenação para "Também em leitura" — uma obra que acabou de
 * receber capítulo é tão relevante quanto uma que você acabou de ler.
 */
export function lastActivityAt(
  lastReadAt: string | null,
  lastChapterReleasedAt: string | null,
): number {
  const a = lastReadAt ? new Date(lastReadAt).getTime() : 0
  const b = lastChapterReleasedAt ? new Date(lastChapterReleasedAt).getTime() : 0
  const max = Math.max(Number.isNaN(a) ? 0 : a, Number.isNaN(b) ? 0 : b)
  return max
}
