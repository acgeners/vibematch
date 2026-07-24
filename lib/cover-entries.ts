import { normalizeCoverSource } from "@/lib/utils"

export interface CoverEntry {
  url: string
  source: string
  isPrimary: boolean
}

export interface ArchivedCoverEntry {
  url: string
  source?: string | null
}

export interface CoverLists {
  covers: CoverEntry[]
  archived: ArchivedCoverEntry[]
}

/**
 * Transições de estado da lista de capas na edição (migration 163).
 *
 * Funções PURAS, fora do componente, porque a mesma capa é editada por DUAS
 * telas — a grade compacta e o diálogo avançado. Duplicar as regras nos dois
 * lugares seria a receita para elas divergirem em silêncio: arquivar por um
 * caminho e não pelo outro dá exatamente o bug que a tabela existe pra impedir.
 *
 * A invariante que todas mantêm: uma URL nunca está nas duas listas, e havendo
 * capa ativa, exatamente uma é a primária.
 */

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

/** Garante exatamente uma primária entre as ativas (promove a primeira). */
function ensurePrimary(covers: CoverEntry[]): CoverEntry[] {
  if (covers.length === 0 || covers.some((c) => c.isPrimary)) return covers
  return covers.map((c, i) => (i === 0 ? { ...c, isPrimary: true } : c))
}

export function setPrimaryCover(covers: CoverEntry[], url: string): CoverEntry[] {
  return covers.map((c) => ({ ...c, isPrimary: c.url === url }))
}

/**
 * Apagar = arquivar. Sem isto a capa volta no próximo "Atualizar dados".
 * Se a arquivada era a primária, promove a primeira das restantes.
 */
export function archiveCover(lists: CoverLists, url: string): CoverLists {
  const removed = lists.covers.find((c) => c.url === url)
  if (!removed) return lists
  const covers = ensurePrimary(
    lists.covers.filter((c) => c.url !== url).map((c) => ({ ...c })),
  )
  const archived = lists.archived.some((a) => a.url === url)
    ? lists.archived
    : [{ url: removed.url, source: removed.source || null }, ...lists.archived]
  return { covers, archived }
}

export function restoreCover(lists: CoverLists, url: string): CoverLists {
  const entry = lists.archived.find((a) => a.url === url)
  const archived = lists.archived.filter((a) => a.url !== url)
  if (!entry || lists.covers.some((c) => c.url === url)) return { covers: lists.covers, archived }
  return {
    covers: [
      ...lists.covers,
      {
        url: entry.url,
        source: normalizeCoverSource(entry.source ?? ""),
        isPrimary: lists.covers.length === 0,
      },
    ],
    archived,
  }
}

export function setCoverSource(covers: CoverEntry[], url: string, source: string): CoverEntry[] {
  return covers.map((c) => (c.url === url ? { ...c, source } : c))
}

export type AddCoverResult =
  | { ok: true; lists: CoverLists; added: CoverEntry }
  | { ok: false; error: string }

/**
 * Adicionar uma URL que estava arquivada é um "desarquivar" EXPLÍCITO — deixá-la
 * nas duas listas faria o save gravar e bloquear a mesma capa.
 */
export function addCover(lists: CoverLists, rawUrl: string, rawSource: string): AddCoverResult {
  const url = rawUrl.trim()
  if (!url) return { ok: false, error: "URL obrigatória" }
  if (!isHttpUrl(url)) return { ok: false, error: "URL precisa começar com http:// ou https://" }
  if (lists.covers.some((c) => c.url === url)) return { ok: false, error: "Essa URL já está na lista" }

  const added: CoverEntry = {
    url,
    source: normalizeCoverSource(rawSource),
    isPrimary: lists.covers.length === 0,
  }
  return {
    ok: true,
    added,
    lists: {
      covers: [...lists.covers, added],
      archived: lists.archived.filter((a) => a.url !== url),
    },
  }
}
