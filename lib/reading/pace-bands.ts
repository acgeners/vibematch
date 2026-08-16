/**
 * As bandas de RITMO da /reading, como regra pura — para a home destacar exatamente o que
 * aquela página chama de "Acompanhando", em vez de inventar um critério paralelo.
 *
 * A matriz é % lido × recência da leitura, com o hiato de publicação na frente de tudo.
 *
 * ✅ FONTE ÚNICA desde 2026-08-03: `components/reading/reading-list.tsx` importa daqui.
 * Ele tinha a própria cópia dos três limiares e da classificação — enquanto existiram duas,
 * mudar um limiar num lugar e não no outro fazia a home e a /reading discordarem sobre a
 * MESMA obra, sem erro nenhum. Quem for mexer nos limiares mexe aqui, e os dois andam juntos.
 */

import { differenceInCalendarDays } from "date-fns"

export const ONPACE_PCT = 0.85 // ≥ 85% lido (e recente) → Acompanhando (quase no fim)
export const BEHIND_PCT = 0.4 // < 40% lido → Atrasado (independe da recência)
export const STALE_DAYS = 30 // ≥ 30 dias sem ler → "frio"

/**
 * `season_break` e `interrupted` são hiato de PUBLICAÇÃO qualificado (migration 183); `hiatus`
 * ficou com o resto.
 *
 * 🔴 A separação existe porque as duas pedem ações OPOSTAS de quem lê: "a S4 sai em setembro"
 * é esperar, "o autor parou há 4 anos" é decidir se larga. Enquanto as duas caíam na mesma
 * banda, a /reading dava o mesmo conselho para as duas — e o rótulo era "Possível hiato" para
 * uma obra cuja próxima temporada tem data anunciada.
 *
 * ⚠️ `hiatus` continua acumulando DOIS casos, e isso é herança, não desenho: hiato de
 * publicação que o texto da fonte não qualifica (10 obras em 2026-08-11) **e** "você leu tudo e
 * não volta há 30 dias", que não é hiato da obra e sim seu. O hint da banda sempre admitiu a
 * mistura ("leu tudo e parou — ou série em hiato"); separá-la é outro trabalho, e mexe em quem
 * não tem nada a ver com a publicação.
 */
export type ReadingBand =
  | "onpace"
  | "uptodate"
  | "trailing"
  | "slowing"
  | "season_break"
  | "interrupted"
  | "hiatus"
  | "behind"

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
  /**
   * `works.hiatus_kind` — qualifica o hiato quando ele existe. Só é lido com
   * `publicationHiatus` true; sozinho não classifica nada, porque o trigger
   * `trg_clear_hiatus_kind` já garante que obra fora do hiato tem isto nulo.
   *
   * ⚠️ Opcional de propósito: os chamadores que ainda não plumbaram a coluna continuam
   * caindo em `hiatus`, que é o comportamento de antes — nunca num tipo inventado.
   */
  hiatusKind?: "between_seasons" | "mid_season" | null
}

/**
 * Dias de CALENDÁRIO desde `iso`. `Infinity` quando nulo/inválido — nunca conta como recente.
 *
 * Calendário, não janelas de 24 h: uma leitura às 23h de ontem é "1 dia atrás" à 1h de hoje,
 * não "0". Era o que a /reading já fazia (`differenceInCalendarDays`) e o que a doc daqui já
 * afirmava — a implementação anterior, com `Math.floor(ms / 86.400.000)`, é que discordava
 * das duas. Com 30 dias de limiar a diferença só aparece na fronteira, mas quando aparece
 * põe a mesma obra em bandas diferentes na home e na /reading.
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
 * /reading: hiato oficial > sem total > em dia > atrasado > frio > no ritmo.
 */
export function classifyPace(input: PaceInput, now: Date = new Date()): ReadingBand {
  if (input.publicationHiatus) {
    if (input.hiatusKind === "between_seasons") return "season_break"
    if (input.hiatusKind === "mid_season") return "interrupted"
    return "hiatus"
  }

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
