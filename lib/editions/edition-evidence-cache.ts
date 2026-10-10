/**
 * Evidência de edição vista na HIDRATAÇÃO, guardada até o SAVE confirmar o vínculo.
 *
 * Por que um cache, e não gravar na hora: a hidratação ("Buscar dados", "Atualizar dados") é uma
 * PRÉVIA — o candidato do MangaUpdates pode ser a obra errada, e quem confirma é a pessoa ao salvar.
 * E por que não levar a evidência pelo formulário: ela voltaria do navegador, e uma server action é
 * endpoint público. Aqui ela nunca sai do servidor: `fetchMangaUpdatesById` lembra, e
 * `upsertWorkExternalIds` (o ponto por onde os três caminhos de save gravam o vínculo) consome.
 *
 * Mesmo padrão do cache de contexto de reviews (`lib/external/index.ts`): Map de módulo, TTL, teto
 * de entradas. ⚠️ Falta de cache (servidor reiniciado entre a prévia e o save) não grava nada — o
 * estado fica como estava, que é o lado seguro: o marcador de sinopse ainda cria no máximo `unknown`.
 */
import type { EditionEvidence } from "./edition-evidence"

const TTL_MS = 2 * 60 * 60 * 1000
const MAX_ENTRIES = 500

interface Entry {
  evidence: EditionEvidence
  fetchedAt: string
  expiresAt: number
}

const cache = new Map<string, Entry>()

const keyOf = (source: "mangaupdates", externalId: string | number) => `${source}:${String(externalId).trim()}`

export function rememberEditionEvidence(
  source: "mangaupdates",
  externalId: string | number,
  evidence: EditionEvidence,
  now: Date = new Date(),
): void {
  const key = keyOf(source, externalId)
  cache.delete(key)
  cache.set(key, { evidence, fetchedAt: now.toISOString(), expiresAt: now.getTime() + TTL_MS })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function readEditionEvidence(
  source: "mangaupdates",
  externalId: string | number,
  now: Date = new Date(),
): { evidence: EditionEvidence; fetchedAt: string } | null {
  const key = keyOf(source, externalId)
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt < now.getTime()) {
    cache.delete(key)
    return null
  }
  return { evidence: entry.evidence, fetchedAt: entry.fetchedAt }
}

/** Só para teste. */
export function clearEditionEvidenceCache(): void {
  cache.clear()
}
