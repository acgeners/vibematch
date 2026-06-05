// coffeemanga.ink — site WordPress + tema Madara, sem Cloudflare (fetch direto).
// Só usado como fonte de CHECAGEM DE CAPÍTULO (último cap + datas de lançamento),
// não entra no pipeline de metadata/IA. Dá datas ABSOLUTAS por capítulo, o que
// melhora a previsão de cadência (vs. a string relativa do comix).

const CM_BASE = "https://coffeemanga.ink"

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
}

export interface CoffeemangaCandidate {
  slug: string
  title: string
}

export interface CoffeemangaChapters {
  latest: number | null
  /** Data (ISO) do capítulo mais recente. */
  lastDateIso: string | null
  /** Datas (ISO) dos capítulos recentes, em ordem decrescente — pra estimar cadência. */
  recentDatesIso: string[]
  /** Todos os números de capítulo (desc, dedup) — pra CONTAR capítulos de verdade (cada decimal é 1 cap). */
  chapterNumbers: number[]
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#822[01]|&#8217|&#0?39|&[lr]squo|&apos;?/g, "'")
    .replace(/&#822[01];|&[lr]dquo;?/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&hellip;?/g, "…")
    .replace(/&nbsp;?/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim()
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store", redirect: "follow" })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** Busca Madara (`?s=&post_type=wp-manga`) → candidatos `{ slug, title }`. */
export async function searchCoffeemanga(query: string): Promise<CoffeemangaCandidate[]> {
  const html = await fetchHtml(`${CM_BASE}/?s=${encodeURIComponent(query)}&post_type=wp-manga`)
  if (!html) return []

  const out: CoffeemangaCandidate[] = []
  const seen = new Set<string>()
  const re = /<div class="post-title">\s*<h\d[^>]*>\s*<a href="[^"]*\/manga\/([^/"]+)\/"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const slug = m[1]
    const title = decodeEntities(m[2])
    if (slug && slug !== "feed" && title && !seen.has(slug)) {
      seen.add(slug)
      out.push({ slug, title })
    }
  }
  return out
}

function parseChapterNumber(text: string): number | null {
  const m = decodeEntities(text).match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

/** Converte a data do Madara (absoluta "June 1, 2026" ou relativa "3 days ago") em ISO. */
function parseMadaraDate(text: string, now: Date = new Date()): string | null {
  const s = decodeEntities(text)
  if (!s) return null
  const rel = s.match(/(\d+)\s+(hour|day|week|month|year)s?\s+ago/i)
  if (rel) {
    const n = Number(rel[1])
    const u = rel[2].toLowerCase()
    const days = u === "year" ? n * 365 : u === "month" ? n * 30 : u === "week" ? n * 7 : u === "day" ? n : n / 24
    return new Date(now.getTime() - days * 86_400_000).toISOString()
  }
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Página de detalhe `/manga/{slug}/` → último cap + datas dos capítulos recentes. */
export async function fetchCoffeemangaChapters(slug: string): Promise<CoffeemangaChapters | null> {
  const html = await fetchHtml(`${CM_BASE}/manga/${encodeURIComponent(slug)}/`)
  if (!html) return null

  const re =
    /<li class="wp-manga-chapter[^"]*">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span class="chapter-release-date">([\s\S]*?)<\/span>/g
  let m: RegExpExecArray | null
  let latest: number | null = null
  let lastDateIso: string | null = null
  const dates: string[] = []
  const nums = new Set<number>()
  while ((m = re.exec(html)) !== null) {
    const num = parseChapterNumber(m[1])
    const date = parseMadaraDate(m[2])
    if (num != null) {
      nums.add(num)
      if (latest == null || num > latest) {
        latest = num
        lastDateIso = date
      }
    }
    if (date) dates.push(date)
  }
  if (latest == null) return null

  return {
    latest,
    lastDateIso,
    recentDatesIso: dates.slice(0, 16),
    chapterNumbers: [...nums].sort((a, b) => b - a),
  }
}
