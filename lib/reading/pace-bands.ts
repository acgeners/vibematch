/**
 * Os grupos da /reading como regra pura — para a home destacar exatamente o que aquela página chama
 * de "Acompanhando", em vez de inventar um critério paralelo.
 *
 * ✅ FONTE ÚNICA: `components/reading/reading-list.tsx` e `components/home/continue-hero.tsx`
 * importam daqui. Enquanto existiram duas cópias dos limiares, a home e a /reading discordavam
 * sobre a MESMA obra, sem erro nenhum.
 *
 * 🔴 A distância é em CAPÍTULOS QUE FALTAM, não em porcentagem (decisão de 2026-11-02). Com %,
 * uma obra recém-lançada com 2 de 3 lidos (67%) caía em "Muito atrás" estando a 1 capítulo de
 * alcançar, e uma de 300 capítulos a 85% contava como "quase em dia" com 45 por ler. O corte de 7
 * saiu da lista real: nas 27 obras em andamento os capítulos faltando iam de 0 a 7 e saltavam
 * para 14.
 */

import { differenceInCalendarDays } from "date-fns"

/** Até quantos capítulos faltando ainda é "perto" (Acompanhando, Quase no fim). */
export const NEAR_CHAPTERS = 7
/** Dias sem ler a partir dos quais a obra em andamento esfria (Desacelerando, Atrasado). */
export const STALE_DAYS = 30
/** Dias sem ler a partir dos quais a obra concluída ou parada conta como "Parado". */
export const STALLED_DAYS = 45
/**
 * Dias sem lançamento a partir dos quais uma obra em andamento está EM HIATO NA PRÁTICA, anunciado
 * ou não (decisão de 2026-11-09). Vale para a /reading e para a home; NÃO muda o status gravado.
 */
export const SILENT_RELEASE_DAYS = 45
/** Acima disto lido, a obra concluída longe do fim é "Continuar"; até isto, "Definir". */
export const CONTINUE_PCT = 0.5
/** Abaixo disto lido e lendo agora, o card ganha a marca "recém-começou". Não decide grupo. */
export const BEHIND_PCT = 0.4

/** Grupos da seção "Em andamento". */
export type OngoingBand = "onpace" | "uptodate" | "catching" | "slowing" | "behind"

/**
 * Hiato de PUBLICAÇÃO, qualificado pela migration 183. Separa "a S4 sai em setembro" (esperar) de
 * "o autor parou" (decidir se larga). Estas obras moram na seção "Outras".
 */
export type HiatusBand = "season_break" | "interrupted" | "hiatus"

export type ReadingBand = OngoingBand | HiatusBand

/** Grupos da seção "Concluídas". */
export type CompletedBand = "finish" | "near" | "continuar" | "definir" | "parado"

export interface PaceInput {
  /** Capítulos lidos por quem está olhando. */
  chaptersRead: number | null
  /** Total conhecido de capítulos; null quando a fonte não sabe. */
  totalChapters: number | null
  /** Capítulos não lidos (total − lidos), já calculado por quem chama. */
  pending: number | null
  /** Última leitura de quem está olhando (ISO). */
  lastReadAt: string | null
  /**
   * Última vez que a pessoa mexeu na obra (`user_work_state.updated_at`), usada SÓ quando não há
   * `lastReadAt`. Criar a obra já com capítulos e importar lista não carimbavam a data, e sem isto
   * essas obras contavam como paradas por falta de dado. É estimativa: muda com nota e status
   * também, e por isso o card diz "mexeu em", nunca "leu em".
   */
  lastTouchedAt?: string | null
  /** Data do último capítulo lançado (ISO). Sem ela, a obra nunca conta como em hiato na prática. */
  lastReleasedAt?: string | null
  /** True quando a PUBLICAÇÃO está em hiato oficial. */
  publicationHiatus: boolean
  /**
   * True quando a publicação está em andamento (status Ongoing). Só ela pode estar em hiato NA
   * PRÁTICA: uma obra concluída também não lança há meses, e isso não é hiato.
   */
  publicationOngoing?: boolean
  /** `works.hiatus_kind` — só é lido com `publicationHiatus` true. */
  hiatusKind?: "between_seasons" | "mid_season" | null
}

/**
 * Dias de CALENDÁRIO desde `iso`. `Infinity` quando nulo/inválido — nunca conta como recente.
 *
 * Calendário, não janelas de 24 h: uma leitura às 23h de ontem é "1 dia atrás" à 1h de hoje. Com
 * 30 dias de limiar a diferença só aparece na fronteira, mas quando aparece põe a mesma obra em
 * grupos diferentes na home e na /reading.
 */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number {
  if (!iso) return Infinity
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return Infinity
  return differenceInCalendarDays(now, d)
}

/** Fração lida (0–1), ou null quando o total é desconhecido. */
export function progressOf(input: Pick<PaceInput, "chaptersRead" | "totalChapters">): number | null {
  const { chaptersRead, totalChapters } = input
  if (!totalChapters || totalChapters <= 0) return null
  return Math.min(1, (chaptersRead ?? 0) / totalChapters)
}

/** A data que mede "está lendo agora?": a leitura, e na falta dela a última vez que mexeu. */
export function recencyDate(input: Pick<PaceInput, "lastReadAt" | "lastTouchedAt">): string | null {
  return input.lastReadAt ?? input.lastTouchedAt ?? null
}

/** O tipo do hiato vira o grupo. Sem tipo, "hiatus": a fonte não disse se volta. */
export function hiatusBand(kind: PaceInput["hiatusKind"]): HiatusBand {
  if (kind === "between_seasons") return "season_break"
  if (kind === "mid_season") return "interrupted"
  return "hiatus"
}

/**
 * Obra em andamento que não lança há `SILENT_RELEASE_DAYS` dias ou mais: em hiato NA PRÁTICA,
 * anunciado ou não. Ela vai para "Em hiato" mesmo com capítulos por ler — o hiato é da publicação,
 * não da leitura, e o card continua mostrando quantos faltam. Sem data de lançamento, nunca.
 *
 * ⚠️ Só agrupa: o status GRAVADO continua o oficial. Gravar "Hiatus" mexeria na Nota Prevista e no
 * filtro do `/ranking` de todo mundo, e a checagem seguinte o desfaria — o MangaUpdates segue
 * dizendo "Ongoing" e a regra de status grava o fim do hiato (`decidePublicationStatus`).
 */
export function isPracticalHiatus(
  input: Pick<PaceInput, "lastReleasedAt" | "publicationOngoing">,
  now: Date = new Date(),
): boolean {
  if (!input.publicationOngoing) return false
  const silence = daysSince(input.lastReleasedAt, now)
  return Number.isFinite(silence) && silence >= SILENT_RELEASE_DAYS
}

/**
 * Grupo de uma obra em andamento (que não está em hiato, oficial ou na prática):
 *
 * | faltam    | leu há < 30 dias | 30+ dias      |
 * |-----------|------------------|---------------|
 * | 0         | Em dia                           |
 * | 1 a 7     | Acompanhando     | Desacelerando |
 * | 8 ou mais | Alcançando       | Atrasado      |
 *
 * Sem total conhecido não dá pra medir distância, e a obra fica em "Acompanhando" (neutro).
 */
export function classifyOngoing(input: PaceInput, now: Date = new Date()): OngoingBand {
  const { pending } = input
  if (pending == null || progressOf(input) == null) return "onpace"
  if (pending <= 0) return "uptodate"
  const cold = daysSince(recencyDate(input), now) >= STALE_DAYS
  if (pending <= NEAR_CHAPTERS) return cold ? "slowing" : "onpace"
  return cold ? "behind" : "catching"
}

/** O grupo de ritmo, com o hiato — oficial ou na prática — na frente de tudo (é o que a home pergunta). */
export function classifyPace(input: PaceInput, now: Date = new Date()): ReadingBand {
  if (input.publicationHiatus) return hiatusBand(input.hiatusKind)
  if (isPracticalHiatus(input, now)) return "hiatus"
  return classifyOngoing(input, now)
}

/**
 * Grupo de uma obra cuja publicação terminou. A pergunta é "vou terminar?":
 *
 * - faltam 0 → Lidas até o fim (falta só marcar como terminada);
 * - faltam 1 a 7 → Quase no fim, leia quando for;
 * - faltam 8 ou mais → Continuar (>50% lido) ou Definir (até 50%) se leu há menos de 45 dias,
 *   senão Parado.
 */
export function classifyCompleted(input: PaceInput, now: Date = new Date()): CompletedBand {
  const { pending } = input
  if (pending != null && progressOf(input) != null) {
    if (pending <= 0) return "finish"
    if (pending <= NEAR_CHAPTERS) return "near"
  }
  if (daysSince(recencyDate(input), now) >= STALLED_DAYS) return "parado"
  const pct = progressOf(input)
  return pct != null && pct > CONTINUE_PCT ? "continuar" : "definir"
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
