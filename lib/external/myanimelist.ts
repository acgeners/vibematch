import type { PublicationStatus } from "@/types/domain"
import { upsertSourceHealth } from "./source-health-store"

// ============================================================================
// MyAnimeList — API OFICIAL v2 (api.myanimelist.net)
// ============================================================================
// Substitui o Jikan nos METADADOS. O Jikan é um scraper NÃO-OFICIAL que fala com
// o MAL por baixo dos panos: quando o MAL o recusa, ele devolve
//   504 {"message":"Jikan failed to connect to MyAnimeList..."}
// e a fonte inteira some do app — mesmo com o MyAnimeList no ar. Medido em
// 2026-07-12: `api.jikan.moe` em 504 consistente enquanto `myanimelist.net`
// respondia 200. Ou seja, a indisponibilidade era do INTERMEDIÁRIO, não da fonte.
//
// A API oficial só quer um Client ID no header `X-MAL-CLIENT-ID` — OAuth completo
// é exigido apenas pra dados de usuário logado (listas pessoais), que não usamos.
// Registre em https://myanimelist.net/apiconfig → `MAL_CLIENT_ID` no .env.
//
// O QUE ELA NÃO TEM: reviews. Não existe endpoint nem campo — é justamente a lacuna
// que fazia o Jikan existir. Elas vêm de `myanimelist-reviews.ts`, que raspa a página
// de reviews do próprio myanimelist.net (200, sem Cloudflare, permitido pelo robots.txt).

const MAL_BASE = "https://api.myanimelist.net/v2"

/** Campos pedidos explicitamente: a API v2 devolve quase nada por padrão. */
const MAL_FIELDS = [
  "id",
  "title",
  "alternative_titles",
  "synopsis",
  "main_picture",
  "mean",
  "num_scoring_users",
  "num_chapters",
  "num_volumes",
  "status",
  "start_date",
  "end_date",
  "genres",
].join(",")

export interface MalMangaResult {
  id: number
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  chapters?: number
  score?: number
  scoredBy?: number
}

export interface MalMangaDetail {
  id: number
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  chapters?: number
  publicationStatus?: PublicationStatus
  /** Nota 0-10 (`mean`). */
  rating?: number
  /** Nº de usuários que deram nota (`num_scoring_users`). */
  votes?: number
  genres: string[]
}

export interface MalRecommendation {
  id: number
  title: string
  /**
   * Nº de usuários que sugeriram esta recomendação (`num_recommendations`). É o PESO
   * do consenso — `mergeSimilarWorks` o usa pra ranquear. Sem ele, toda recomendação
   * do MAL entraria com peso `undefined` e o ranking degradaria em silêncio.
   */
  votes: number
}

export function isMalConfigured(): boolean {
  return Boolean(process.env.MAL_CLIENT_ID?.trim())
}

// --- Circuito ---------------------------------------------------------------
//
// Mesmo padrão do jikan/comix: N falhas TRANSIENTES seguidas → abre por um tempo,
// pra uma fonte fora não comer o orçamento de 8s da busca, que é COMPARTILHADO com
// AniList/MU/Kitsu/ComicK. Um sucesso fecha na hora.
//
// Erro de CONFIGURAÇÃO (Client ID ausente/inválido → 400/401/403) NÃO é transiente:
// retentar não conserta, e abrir o circuito só esconderia o problema. Ele é logado
// alto e a chamada devolve vazio — o painel de saúde mostra o motivo.
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])
const CIRCUIT_FAIL_THRESHOLD = 3
const CIRCUIT_TTL_MS = 5 * 60_000

let consecutiveFails = 0
let circuitOpenUntil = 0
let lastPersistedStatus: string | null = null

export function isMalCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil
}

/** Telemetria best-effort: só grava em MUDANÇA de estado (não a cada chamada). */
function persistHealth(status: "ok" | "down", reason: string | null): void {
  if (status === lastPersistedStatus) return
  lastPersistedStatus = status
  void upsertSourceHealth("myanimelist", {
    status,
    lastOkAt: status === "ok" ? Date.now() : null,
    lastFailAt: status === "ok" ? null : Date.now(),
    failReason: reason,
    consecutiveFails,
  }).catch(() => {})
}

function recordOk(): void {
  consecutiveFails = 0
  circuitOpenUntil = 0
  persistHealth("ok", null)
}

function recordFailure(reason: string, transient: boolean): void {
  if (transient) {
    consecutiveFails += 1
    if (consecutiveFails >= CIRCUIT_FAIL_THRESHOLD && !isMalCircuitOpen()) {
      circuitOpenUntil = Date.now() + CIRCUIT_TTL_MS
      console.error(
        `[mal] circuito ABERTO por ${CIRCUIT_TTL_MS / 60_000}min — ${consecutiveFails} falhas seguidas (${reason}). ` +
          `As outras fontes seguem normais.`
      )
    }
  }
  persistHealth("down", reason)
}

/**
 * GET autenticado por Client ID. Devolve `null` em qualquer falha (a telemetria já
 * registrou o motivo) — nenhum caller deve quebrar porque o MAL saiu do ar.
 */
async function malGet(path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const clientId = process.env.MAL_CLIENT_ID?.trim()
  if (!clientId) {
    recordFailure("MAL_CLIENT_ID ausente", false)
    return null
  }
  if (isMalCircuitOpen()) return null

  const url = new URL(`${MAL_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  try {
    const res = await fetch(url, {
      headers: { "X-MAL-CLIENT-ID": clientId },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const transient = TRANSIENT_STATUSES.has(res.status)
      if (!transient) {
        // 400 "Invalid client id" / 401 / 403: erro de config, não indisponibilidade.
        console.error(
          `[mal] HTTP ${res.status} em ${path} — provável Client ID inválido ou ausente. ` +
            `Registre em https://myanimelist.net/apiconfig e defina MAL_CLIENT_ID.`
        )
      }
      recordFailure(`HTTP ${res.status}`, transient)
      return null
    }

    recordOk()
    return (await res.json()) as Record<string, unknown>
  } catch (err) {
    // Timeout/rede: transiente por natureza.
    recordFailure(err instanceof Error ? err.name : "network", true)
    return null
  }
}

// --- Mapeamento -------------------------------------------------------------

function cleanText(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim()
}

/** A v2 usa snake_case ("currently_publishing"); o Jikan usava outra grafia
 *  ("publishing"). Manter o mapa antigo faria TODA obra cair no default → "Unknown". */
function statusFromMal(raw: unknown): PublicationStatus | undefined {
  if (typeof raw !== "string") return undefined
  switch (raw.toLowerCase()) {
    case "finished": return "Completed"
    case "currently_publishing": return "Ongoing"
    case "on_hiatus": return "Hiatus"
    case "discontinued": return "Cancelled"
    case "not_yet_published": return "Unknown"
    default: return "Unknown"
  }
}

function yearFromIso(date: unknown): number | undefined {
  if (typeof date !== "string" || date.length < 4) return undefined
  const n = parseInt(date.slice(0, 4), 10)
  return Number.isFinite(n) ? n : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

/** `alternative_titles` = { synonyms: string[], en: string, ja: string }. */
function altTitles(node: Record<string, unknown>, primary: string): string[] {
  const alt = node.alternative_titles as Record<string, unknown> | undefined
  const raw = [
    ...(Array.isArray(alt?.synonyms) ? (alt.synonyms as unknown[]) : []),
    alt?.en,
    alt?.ja,
  ]
  const out = raw
    .map((t) => cleanText(t))
    .filter((t) => t.length > 0 && t !== primary)
  return Array.from(new Set(out))
}

function coverFrom(node: Record<string, unknown>): string | undefined {
  const pic = node.main_picture as Record<string, unknown> | undefined
  const url = pic?.large ?? pic?.medium
  return typeof url === "string" && url ? url : undefined
}

function genresFrom(node: Record<string, unknown>): string[] {
  const list = Array.isArray(node.genres) ? (node.genres as unknown[]) : []
  return list
    .map((g) => cleanText((g as Record<string, unknown>)?.name))
    .filter((g) => g.length > 0)
}

function toDetail(node: Record<string, unknown>): MalMangaDetail | null {
  const id = num(node.id)
  const title = cleanText(node.title)
  if (!id || !title) return null
  return {
    id,
    title,
    alternativeTitles: altTitles(node, title),
    synopsis: node.synopsis ? cleanText(node.synopsis) : undefined,
    coverUrl: coverFrom(node),
    year: yearFromIso(node.start_date),
    yearEnd: yearFromIso(node.end_date),
    chapters: num(node.num_chapters) || undefined,
    publicationStatus: statusFromMal(node.status),
    rating: num(node.mean),
    votes: num(node.num_scoring_users),
    genres: genresFrom(node),
  }
}

// --- API pública ------------------------------------------------------------

/** Busca por título. A v2 exige `q` com pelo menos 3 caracteres. */
export async function searchMalManga(title: string): Promise<MalMangaResult[]> {
  const q = title.trim()
  if (q.length < 3) return []

  const json = await malGet("/manga", { q, limit: "5", fields: MAL_FIELDS })
  const data = Array.isArray(json?.data) ? (json.data as unknown[]) : []

  return data
    .map((row): MalMangaResult | null => {
      const node = (row as Record<string, unknown>)?.node as Record<string, unknown> | undefined
      if (!node) return null
      const detail = toDetail(node)
      if (!detail) return null
      return {
        id: detail.id,
        title: detail.title,
        alternativeTitles: detail.alternativeTitles,
        synopsis: detail.synopsis,
        coverUrl: detail.coverUrl,
        year: detail.year,
        chapters: detail.chapters,
        score: detail.rating,
        scoredBy: detail.votes,
      }
    })
    .filter((r): r is MalMangaResult => r !== null)
}

export async function fetchMalMangaById(malId: number): Promise<MalMangaDetail | null> {
  const json = await malGet(`/manga/${malId}`, { fields: MAL_FIELDS })
  return json ? toDetail(json) : null
}

/**
 * Detalhe por título: a v2 tem busca de verdade, então basta pegar o 1º resultado
 * cujo título case acima do limiar. (No Jikan isso era um CONTORNO: o `/manga/{id}` dele
 * falhava com frequência porque exigia raspar o MAL ao vivo. Na API oficial é só a via
 * natural.)
 */
export async function fetchMalMangaByTitle(title: string, threshold = 0.7): Promise<MalMangaDetail | null> {
  const results = await searchMalManga(title)
  if (results.length === 0) return null

  const target = title.trim().toLowerCase()
  const best = results.find((r) =>
    [r.title, ...r.alternativeTitles].some((t) => {
      const c = t.toLowerCase()
      return c === target || c.includes(target) || target.includes(c)
    })
  )
  const chosen = best ?? results[0]
  // Sem match textual e sem confiança suficiente: melhor nada do que a obra errada.
  if (!best && threshold > 0.9) return null

  return fetchMalMangaById(chosen.id)
}

/**
 * Recomendações vêm como CAMPO do detalhe (`recommendations`), não como endpoint
 * próprio — por isso o `fields` aqui é diferente do `MAL_FIELDS` padrão.
 */
export async function fetchMalRecommendations(malId: number): Promise<MalRecommendation[]> {
  const json = await malGet(`/manga/${malId}`, { fields: "recommendations" })
  const list = Array.isArray(json?.recommendations) ? (json.recommendations as unknown[]) : []

  return list
    .map((row): MalRecommendation | null => {
      const entry = row as Record<string, unknown>
      const node = entry?.node as Record<string, unknown> | undefined
      const id = num(node?.id)
      const t = cleanText(node?.title)
      // `num_recommendations` vem IRMÃO de `node`, não dentro dele.
      return id && t ? { id, title: t, votes: num(entry.num_recommendations) ?? 0 } : null
    })
    .filter((r): r is MalRecommendation => r !== null)
}
