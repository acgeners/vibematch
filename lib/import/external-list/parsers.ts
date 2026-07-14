import { gunzipSync } from "node:zlib"
import { FULLY_READ_STATUS } from "@/lib/constants/status-lookups"
import type { PersonalStatus } from "@/types/domain"
import type { ExternalListEntry, ExternalListSource } from "./types"

// ── Mapas de status por fonte ────────────────────────────────────────
// Não usamos lib/import/normalizer.ts (gerado) porque o vocabulário das
// listas externas ("read", "want to read", "Plan to Read") não está lá.

const MAL_JSON_STATUS: Record<string, PersonalStatus> = {
  read: FULLY_READ_STATUS as PersonalStatus,
  reading: "Reading",
  "want to read": "Want to Read",
  stalled: "Stalled",
  dropped: "Dropped",
  "on-hold": "On-hold",
}

// Formato XML do MyAnimeList (também usado pela exportação do Anime-Planet).
const MAL_XML_STATUS: Record<string, PersonalStatus> = {
  completed: FULLY_READ_STATUS as PersonalStatus,
  reading: "Reading",
  "on-hold": "On-hold",
  dropped: "Dropped",
  "plan to read": "Want to Read",
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
  }
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
