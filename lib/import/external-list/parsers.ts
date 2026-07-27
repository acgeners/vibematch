import { gunzipSync } from "node:zlib"
import { personalStatusNameBySlugOrThrow } from "@/lib/constants/status-lookups"
import type { PersonalStatus } from "@/types/domain"
import type { AniListListEntry } from "@/lib/external/anilist"
import type { ExternalListEntry, ExternalListSource } from "./types"

// ── Mapas de status por fonte ────────────────────────────────────────
//
// Os mapas ficam escritos à mão aqui porque o vocabulário das listas externas
// ("read", "want to read", "Plan to Read") não vem do banco.
//
// A CHAVE é da FONTE (o vocabulário do MyAnimeList/Anime-Planet) — fica escrita à mão, é o
// contrato deles. O VALOR é NOSSO status, e por isso sai do banco pelo SLUG: escrever o nome
// aqui é o que fez `read: "Completed"` traduzir, em silêncio, para um status que já não existia.
// `personalStatusNameBySlugOrThrow` estoura se o slug sumir, em vez de importar lixo.
const ours = (slug: string) => personalStatusNameBySlugOrThrow(slug) as PersonalStatus

const MAL_JSON_STATUS: Record<string, PersonalStatus> = {
  read: ours("finished"),
  reading: ours("reading"),
  "want to read": ours("want-to-read"),
  stalled: ours("stalled"),
  dropped: ours("dropped"),
  "on-hold": ours("on-hold"),
}

// Formato XML do MyAnimeList (também usado pela exportação do Anime-Planet).
const MAL_XML_STATUS: Record<string, PersonalStatus> = {
  completed: ours("finished"),
  reading: ours("reading"),
  "on-hold": ours("on-hold"),
  dropped: ours("dropped"),
  "plan to read": ours("want-to-read"),
}

// Enum de status do MediaList do AniList → NOSSO status (via slug).
const ANILIST_STATUS: Record<string, PersonalStatus> = {
  CURRENT: ours("reading"),
  PLANNING: ours("want-to-read"),
  COMPLETED: ours("finished"),
  DROPPED: ours("dropped"),
  PAUSED: ours("on-hold"),
  REPEATING: ours("reading"),
}

function clampScore(value: number): number {
  const clamped = Math.max(0, Math.min(10, value))
  return Math.round(clamped * 10) / 10
}

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n)
}

// ── Decodificação do conteúdo recebido (sempre base64 dos bytes do arquivo) ──
// Detecta gzip pelos magic bytes (0x1f 0x8b) e descompacta; senão trata como utf8.
export function decodeContent(contentBase64: string): string {
  const buf = Buffer.from(contentBase64, "base64")
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf).toString("utf8")
  }
  return buf.toString("utf8")
}

export function detectSource(text: string): ExternalListSource | null {
  const t = text.trimStart()
  if (t.startsWith("<")) return "animeplanet" // XML formato MAL
  try {
    const json = JSON.parse(t)
    if (Array.isArray(json)) return "mangaupdates"
    if (json && typeof json === "object" && Array.isArray((json as { entries?: unknown }).entries)) {
      return "myanimelist"
    }
  } catch {
    // não é JSON válido
  }
  return null
}

export function parseExternalList(text: string, source: ExternalListSource): ExternalListEntry[] {
  switch (source) {
    case "myanimelist":
      return parseMalJson(text)
    case "mangaupdates":
      return parseMangaUpdates(text)
    case "animeplanet":
      return parseMalXml(text)
    case "anilist":
      // AniList não vem de texto/arquivo — é buscado pela API e convertido por
      // parseAniListList. Cair aqui é erro de uso.
      throw new Error("A lista do AniList é buscada pela API, não parseada de arquivo.")
    case "titles":
      return parseTitleList(text)
  }
}

// Lista de títulos colada: um título por linha. Títulos costumam ter vírgula e
// ponto-e-vírgula no meio, então quebrar por linha é o único separador seguro.
// Dedup dentro da lista (case-insensitive); a dedup contra o DB é da reconciliação.
export function parseTitleList(text: string): ExternalListEntry[] {
  const seen = new Set<string>()
  const out: ExternalListEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const title = line.trim()
    if (!title) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      source: "titles",
      externalId: null,
      title,
      personalStatus: null,
      userScore: null,
      chaptersRead: null,
    })
  }
  return out
}

// AniList: converte as entradas já buscadas da API em entradas normalizadas.
// O externalId é o media id do AniList → casa com work_external_ids (source "anilist").
// Ordena por mediaId: as decisões do usuário são indexadas por POSIÇÃO, e o commit
// re-busca a lista — a API não garante ordem estável entre chamadas, então fixamos.
export function parseAniListList(entries: AniListListEntry[]): ExternalListEntry[] {
  return [...entries]
    .sort((a, b) => a.mediaId - b.mediaId)
    .map((e) => ({
    source: "anilist" as const,
    externalId: String(e.mediaId),
    title: e.title,
    personalStatus: e.status ? ANILIST_STATUS[e.status] ?? null : null,
    userScore: e.score != null ? clampScore(e.score) : null,
    chaptersRead: e.progress != null ? toPositiveInt(e.progress) : null,
  }))
}

// ── MyAnimeList JSON ─────────────────────────────────────────────────
// { user, export, entries: [{ name, status, rating(0–5), ch, vol }] }
interface MalJsonEntry {
  name?: string
  status?: string
  rating?: number | null
  ch?: number | null
}

function parseMalJson(text: string): ExternalListEntry[] {
  const json = JSON.parse(text) as { entries?: MalJsonEntry[] }
  const entries = json.entries ?? []
  const out: ExternalListEntry[] = []
  for (const e of entries) {
    const title = (e.name ?? "").trim()
    if (!title) continue
    const statusKey = (e.status ?? "").toLowerCase().trim()
    const rating = typeof e.rating === "number" ? e.rating : null
    out.push({
      source: "myanimelist",
      externalId: null,
      title,
      personalStatus: MAL_JSON_STATUS[statusKey] ?? null,
      // escala 0–5 → 0–10; 0 = sem nota.
      userScore: rating && rating > 0 ? clampScore(rating * 2) : null,
      chaptersRead: toPositiveInt(e.ch),
    })
  }
  return out
}

// ── MangaUpdates JSON ────────────────────────────────────────────────
// [{ id, title, volume, chapter, date, rating }]
interface MangaUpdatesEntry {
  id?: number | string
  title?: string
  chapter?: number | null
  rating?: number | null
}

function parseMangaUpdates(text: string): ExternalListEntry[] {
  const json = JSON.parse(text) as MangaUpdatesEntry[]
  const out: ExternalListEntry[] = []
  for (const e of json) {
    const title = (e.title ?? "").trim()
    if (!title) continue
    const rating = typeof e.rating === "number" ? e.rating : null
    out.push({
      source: "mangaupdates",
      externalId: e.id != null ? String(e.id) : null,
      title,
      // O export não traz status de leitura.
      personalStatus: null,
      // MangaUpdates usa escala 0–10 quando presente (null neste export).
      userScore: rating && rating > 0 ? clampScore(rating) : null,
      chaptersRead: toPositiveInt(e.chapter),
    })
  }
  return out
}

// ── Anime-Planet / MyAnimeList XML ───────────────────────────────────
// <myanimelist><manga>…</manga>…</myanimelist>
// Estrutura plana e regular → extração por blocos, sem dependência de XML.
function parseMalXml(text: string): ExternalListEntry[] {
  const blocks = text.split(/<manga>/i).slice(1).map((b) => b.split(/<\/manga>/i)[0])
  const out: ExternalListEntry[] = []
  for (const block of blocks) {
    const title = xmlTag(block, "manga_title")
    if (!title) continue
    const statusKey = (xmlTag(block, "my_status") ?? "").toLowerCase().trim()
    const score = toPositiveInt(xmlTag(block, "my_score"))
    out.push({
      source: "animeplanet",
      externalId: xmlTag(block, "manga_mangadb_id"),
      title,
      personalStatus: MAL_XML_STATUS[statusKey] ?? null,
      // my_score já é 0–10; 0 = sem nota.
      userScore: score != null ? clampScore(score) : null,
      chaptersRead: toPositiveInt(xmlTag(block, "my_read_chapters")),
    })
  }
  return out
}

function xmlTag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))
  if (!m) return null
  let value = m[1].trim()
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  if (cdata) value = cdata[1].trim()
  return value || null
}
