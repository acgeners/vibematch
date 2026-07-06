/**
 * Extrai o slug canônico de uma obra do Mangago a partir de um input livre —
 * aceita o slug cru ("solo_leveling") ou uma URL de detalhe
 * (https://www.mangago.me/read-manga/{slug}/, com/sem barra final,
 * querystring ou hash). O slug é sempre o 1º segmento depois de `/read-manga/`
 * (URLs de capítulo têm o slug nesse mesmo 1º segmento).
 *
 * Rejeita (→ null): vazio, URL de outro host que não `*.mangago.me`, e URLs
 * do Mangago que NÃO estejam em `/read-manga/` (ex.: home, `/genre/…`).
 *
 * Util PURO (sem deps de server) — usável no client (inputs manuais) e no
 * server (validação/persistência). Espelha `extractComixHid`.
 */

// Slugs do Mangago são sempre minúsculas + dígitos + underscore
// (ex.: "solo_leveling_hunter_origin", "kingdom_hearts_358_2_days").
const SLUG_RE = /^[a-z0-9_]+$/i

// Host aceito: mangago.me e qualquer subdomínio (www., m., …).
const MANGAGO_HOST = /(?:^|\.)mangago\.me$/i

/** Extrai o host de "https://host/…", "//host/…" ou "host/…" (host com ponto). */
function hostOf(value: string): string | null {
  const withScheme = value.match(/^(?:https?:)?\/\/([^/]+)/i)
  if (withScheme) return withScheme[1]
  const bare = value.match(/^([a-z0-9.-]+\.[a-z]{2,})(?=\/)/i)
  return bare ? bare[1] : null
}

export function extractMangagoSlug(input: string): string | null {
  const s = (input ?? "").trim()
  if (!s) return null

  // Caminho de detalhe: /read-manga/{slug}[/…][?…][#…]
  const readManga = s.match(/\/read-manga\/([^/?#]+)/i)
  if (readManga) {
    const host = hostOf(s)
    if (host && !MANGAGO_HOST.test(host)) return null // URL de outro site
    const slug = readManga[1].trim().toLowerCase()
    return SLUG_RE.test(slug) ? slug : null
  }

  // Sem /read-manga/: se parece URL/caminho (tem barra ou esquema), rejeita —
  // não é uma página de obra do Mangago. Caso contrário, trata como slug cru.
  if (/[/:]/.test(s)) return null
  const slug = s.toLowerCase()
  return SLUG_RE.test(slug) ? slug : null
}
