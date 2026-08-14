const DAY_MS = 86_400_000

/**
 * Mediana dos intervalos (em dias) entre datas de lançamento consecutivas.
 * Robusta a hiatos isolados (um gap grande não desloca a mediana como faria a
 * média). Precisa de ≥3 datas (≥2 intervalos) pra retornar algo; senão `null`.
 */
export function medianGapDays(datesIso: string[]): number | null {
  const ts = datesIso
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)
  if (ts.length < 3) return null

  const gaps: number[] = []
  for (let i = 0; i < ts.length - 1; i++) {
    const g = (ts[i] - ts[i + 1]) / DAY_MS
    if (g > 0) gaps.push(g)
  }
  if (gaps.length < 2) return null

  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
}

/**
 * Converte a string relativa pré-formatada da comix ("4d ago", "1w ago",
 * "8mos ago", "2y ago", "just now") numa data aproximada. `null` quando não casa.
 */
export function parseRelativeAgeToDate(
  label: string | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!label) return null
  const s = label.trim()
  if (/^(just now|now)$/i.test(s)) return new Date(now)
  const m = s.match(/^(\d+)\s*(y|mos|mo|w|d|h|min|m)\s*ago$/i)
  if (!m) return null
  const n = Number(m[1])
  const u = m[2].toLowerCase()
  const days =
    u === "y" ? n * 365
    : u === "mo" || u === "mos" ? n * 30
    : u === "w" ? n * 7
    : u === "d" ? n
    : u === "h" ? n / 24
    : n / 1440 // min / m
  return new Date(now.getTime() - days * DAY_MS)
}

/**
 * Próxima data prevista = âncora (data do último cap) + cadência (gap mediano).
 * Retorna `null` quando não há cadência confiável ou quando a âncora é antiga
 * demais (provável hiato — previsão sem sentido).
 */
export function predictNextFromAnchor(
  anchor: Date | null,
  cadenceDates: string[],
  now: Date = new Date(),
  maxAnchorAgeDays = 45,
): string | null {
  if (!anchor || !Number.isFinite(anchor.getTime())) return null
  if ((now.getTime() - anchor.getTime()) / DAY_MS > maxAnchorAgeDays) return null // hiato

  const gap = medianGapDays(cadenceDates)
  if (gap == null || gap <= 0) return null

  return new Date(anchor.getTime() + gap * DAY_MS).toISOString()
}

/**
 * Conveniência: âncora vinda de string relativa (comix "4d ago") + cadência do MangaDex.
 * Para âncora absoluta (mangago), use `predictNextFromAnchor` direto.
 */
export function predictNextRelease(opts: {
  anchorLabel: string | null | undefined
  cadenceDates: string[]
  now?: Date
  maxAnchorAgeDays?: number
}): string | null {
  const now = opts.now ?? new Date()
  return predictNextFromAnchor(
    parseRelativeAgeToDate(opts.anchorLabel, now),
    opts.cadenceDates,
    now,
    opts.maxAnchorAgeDays ?? 45,
  )
}
