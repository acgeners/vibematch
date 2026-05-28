import type { MappedImportRow, ImportColumnMapping } from "@/types/domain"
import type { RawImportRow } from "@/types/domain"
import {
  parseBrazilianNumber,
  normalizeScore,
  normalizePublicationStatus,
  normalizePersonalStatus,
  normalizeSynopsisQuality,
  parseInteger,
} from "./normalizer"

export const AUTO_COLUMN_ALIASES: Record<string, keyof MappedImportRow> = {
  // Título
  Manhwa: "title",
  manhwa: "title",
  Título: "title",
  titulo: "title",
  Title: "title",
  title: "title",

  // Categorias (por emoji e por slug)
  "💞": "romance",
  "romance": "romance",
  "Romance": "romance",
  "💑": "couple_dynamics",
  "couple_dynamics": "couple_dynamics",
  "Dinâmica do Casal": "couple_dynamics",
  "👑": "fantasy_nobility",
  "fantasy_nobility": "fantasy_nobility",
  "Fantasia/Nobreza": "fantasy_nobility",
  "⚔️": "action_adventure",
  "action_adventure": "action_adventure",
  "Ação/Aventura": "action_adventure",
  "🔥": "adult_content",
  "adult_content": "adult_content",
  "Conteúdo Adulto": "adult_content",
  "🦸": "protagonist",
  "protagonist": "protagonist",
  "Protagonista Marcante": "protagonist",
  "😂": "humor",
  "humor": "humor",
  "Humor": "humor",
  "🎭": "drama",
  "drama": "drama",
  "Drama": "drama",
  "💔": "tragedy",
  "tragedy": "tragedy",
  "Tragédia": "tragedy",

  // Plataformas
  "M.U": "mu_rating",
  MangaDB: "mu_rating",
  mu_rating: "mu_rating",
  "#MU": "mu_votes",
  "M.Votes": "mu_votes",
  mu_votes: "mu_votes",
  "A.P": "ap_rating",
  AnimePlanet: "ap_rating",
  ap_rating: "ap_rating",
  "#AP": "ap_votes",
  "AP.Votes": "ap_votes",
  ap_votes: "ap_votes",
  Cmx: "cmx_rating",
  ComicK: "cmx_rating",
  cmx_rating: "cmx_rating",
  "#Cmx": "cmx_votes",
  cmx_votes: "cmx_votes",

  // Status
  Status: "publication_status",
  publication_status: "publication_status",
  "M.Status": "personal_status",
  personal_status: "personal_status",

  // Campos numéricos
  Cps: "total_chapters",
  total_chapters: "total_chapters",
  Lido: "chapters_read",
  chapters_read: "chapters_read",
  "♥Sinopse": "synopsis_quality",
  synopsis_quality: "synopsis_quality",
  Obs: "observation_adjustment",
  observation_adjustment: "observation_adjustment",
  "M.Nota": "user_score",
  user_score: "user_score",

  // Scores calculados importados da planilha
  "IA": "ia_eval",
  "IA(n)": "ia_eval_normalized",
  "Nota.IA": "calc_score",
  "Nota.Pr": "predicted_score",
  "Nota.Final": "final_score",
}

export function detectColumnMappings(
  columns: string[]
): ImportColumnMapping[] {
  return columns.map((col) => ({
    sourceColumn: col,
    targetField: AUTO_COLUMN_ALIASES[col] ?? "ignore",
  }))
}

export function applyMapping(
  row: RawImportRow,
  mappings: ImportColumnMapping[]
): MappedImportRow | null {
  const result: Partial<MappedImportRow> = {}

  for (const { sourceColumn, targetField } of mappings) {
    if (targetField === "ignore") continue
    const raw = row[sourceColumn]
    if (raw == null || raw === "" || raw === "nan" || raw === "None") continue

    switch (targetField) {
      case "title":
        result.title = String(raw).trim()
        break
      case "romance":
      case "couple_dynamics":
      case "fantasy_nobility":
      case "action_adventure":
      case "adult_content":
      case "protagonist":
      case "humor":
      case "drama":
      case "tragedy":
      case "mu_rating":
      case "ap_rating":
      case "cmx_rating":
      case "user_score":
      case "ia_eval":
      case "ia_eval_normalized":
      case "calc_score":
      case "predicted_score":
      case "final_score":
        result[targetField] = normalizeScore(raw) ?? undefined
        break
      case "mu_votes":
      case "ap_votes":
      case "cmx_votes":
      case "total_chapters":
      case "chapters_read":
        result[targetField] = parseInteger(raw) ?? undefined
        break
      case "observation_adjustment":
        result.observation_adjustment = parseBrazilianNumber(raw) ?? undefined
        break
      case "publication_status":
        result.publication_status = normalizePublicationStatus(raw) ?? undefined
        break
      case "personal_status":
        result.personal_status = normalizePersonalStatus(raw) ?? undefined
        break
      case "synopsis_quality":
        result.synopsis_quality = normalizeSynopsisQuality(raw) ?? undefined
        break
    }
  }

  if (!result.title) return null
  return result as MappedImportRow
}
