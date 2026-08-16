import {
  PUBLICATION_STATUSES_BY_ID,
  PERSONAL_STATUSES_BY_ID,
  INTEREST_HIDDEN_PERSONAL_STATUSES,
} from "@/lib/constants/criteria"
import { SYNOPSIS_QUALITIES } from "@/types/domain"

/**
 * Parsing de filtros de URL compartilhado por /curation/works ("Curadoria da
 * Obra") e /my-ai-scores — as duas metades em que a antiga página de 5
 * abas foi dividida. Ambas filtram por Status (publicação/leitura) e Interesse
 * (manual + Previsão da IA) do mesmo jeito.
 */

export const PUB_STATUS_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.values(PUBLICATION_STATUSES_BY_ID).map((info) => [info.status, info.id]),
)
export const PERSONAL_STATUS_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info.id]),
)

/** Status ocultos por PADRÃO na aba Interesse (obra finalizada/abandonada/travada/em releitura
 *  não precisa de estimativa de interesse). A lista vem do banco
 *  (`personal_status.hide_from_interest`, migration 155) — antes era escrita à mão aqui, e
 *  "Completed" parou de casar em silêncio quando o status virou "Finished".
 *  Escolha explícita de status no filtro sobrepõe. */
export const INTEREST_DEFAULT_PERSONAL_NAMES = Object.keys(PERSONAL_STATUS_NAME_TO_ID).filter(
  (s) => !(INTEREST_HIDDEN_PERSONAL_STATUSES as readonly string[]).includes(s),
)
export const INTEREST_DEFAULT_PERSONAL_IDS = INTEREST_DEFAULT_PERSONAL_NAMES.map(
  (s) => PERSONAL_STATUS_NAME_TO_ID[s],
).filter((id): id is number => id != null)

export function parseStatusList(
  raw: string | string[] | undefined,
  nameToId: Record<string, number>,
): { names: string[]; ids: number[] } {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return { names: [], ids: [] }
  const names = value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p in nameToId)
  const ids = names.map((n) => nameToId[n])
  return { names, ids }
}

export function parseSynopsisQualities(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return []
  // Sentinela do filtro de Interesse (tratada só na fila tab=sinopse; inofensiva nas
  // outras queries): "none" = "Não avaliada" (synopsis_quality IS NULL).
  //
  // "unknown" ("Desconhecido") NÃO está aqui de propósito: a proveniência legada acabou
  // na migration 179. O token cai fora na filtragem abaixo, então um link ou filtro
  // salvo antigo abre sem ele — e não como um filtro que não casa nada.
  const valid = new Set<string>([...SYNOPSIS_QUALITIES, "none"])
  return value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => valid.has(p))
}

/** Valores previstos pela IA (♥–♥♥♥♥) — filtro "Previsão da IA". */
export function parsePredictionQualities(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return []
  const valid = new Set<string>(SYNOPSIS_QUALITIES)
  return value.split(",").map((p) => p.trim()).filter((p) => valid.has(p))
}

/** Versões de prompt da previsão (ex.: v3, v2) — filtro "Versão da previsão" (aba sinopse). */
export function parsePredictionVersions(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return []
  return value.split(",").map((p) => p.trim()).filter((p) => /^v\d+$/i.test(p))
}

/** Delta previsto − atual: valores exatos de "-3" a "3" (níveis ♥, aba sinopse). */
export function parsePredictionDeltas(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return []
  const valid = new Set(["-3", "-2", "-1", "0", "1", "2", "3"])
  return value.split(",").map((p) => p.trim()).filter((p) => valid.has(p))
}

export function toParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined
  return Array.isArray(v) ? v.join(",") : v
}
