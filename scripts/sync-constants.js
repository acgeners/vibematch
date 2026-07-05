// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Sync script: lê tabelas do Supabase e regera arquivos de constantes.
 *
 * Uso: npm run sync-constants
 *
 * Arquivos gerados:
 *   lib/constants/criteria.ts          ← criteria (IA) + publication_status + personal_status + source
 *   lib/constants/post-reading-criteria.ts ← criteria (User)
 *   lib/constants/tag-groups.ts        ← tag_group
 *   lib/constants/ui-labels.ts         ← ui_labels (LABELS: nomes + tooltips por campo)
 *   lib/external/types.ts              ← ExternalSourceId de source.slug
 *   lib/import/mapper.ts               ← aliases de critérios de criteria
 *   lib/import/normalizer.ts           ← mapas de normalização de status
 */

const { createClient } = require("@supabase/supabase-js")
const fs = require("fs")
const path = require("path")

// `node` pelado NÃO carrega .env.local (só o Next carrega). Sem isto as vars ficam
// undefined e o script cai no fallback → PROJETO ERRADO. dotenv não sobrescreve
// vars já presentes no shell, então é seguro.
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local") })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://obwlwukwovetgjqdpizd.supabase.co"
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const ROOT = path.resolve(__dirname, "..")

// Slugs cujos connectors estão implementados em lib/external/index.ts (SEARCH_CONNECTORS).
// Mantenha em sincronia ao adicionar/remover connector.
const IMPLEMENTED_CONNECTOR_SLUGS = [
  "anilist",
  "mangaupdates",
  "comick",
  "kitsu",
  "myanimelist",
  "mangadex",
  "animeplanet",
  "comix",
]

const CODE_ONLY_SOURCES = [
  { slug: "anilist", name: "AniList" },
  { slug: "mangaupdates", name: "Manga Updates" },
  { slug: "kitsu", name: "Kitsu" },
  { slug: "myanimelist", name: "MyAnimeList" },
  { slug: "mangadex", name: "MangaDex" },
  { slug: "comick", name: "ComicK" },
  { slug: "animeplanet", name: "Anime Planet" },
]

function write(relPath, content) {
  const full = path.resolve(ROOT, relPath)
  fs.writeFileSync(full, content, "utf-8")
  console.log(`  ✓ ${relPath}`)
}

function literalArray(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`
}

function literalMultilineArray(values) {
  return `[\n${values.map((value) => `  ${JSON.stringify(value)},`).join("\n")}\n]`
}

function withCodeOnlySources(sources) {
  const seen = new Set(sources.map((source) => source.slug).filter(Boolean))
  const extras = CODE_ONLY_SOURCES.filter((source) => !seen.has(source.slug))
  return [...sources, ...extras]
}

function constNameFromSlug(slug) {
  return String(slug ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function uniqueAliasLines(criteria) {
  const seen = new Set()
  const lines = []

  const add = (alias, slug) => {
    if (!alias || seen.has(alias)) return
    seen.add(alias)
    lines.push(`  ${JSON.stringify(alias)}: ${JSON.stringify(slug)},`)
  }

  for (const c of criteria) {
    add(c.emoji, c.slug)
    add(c.slug, c.slug)
    add(c.criteria, c.slug)
  }

  return lines.join("\n")
}

async function main() {
  if (!SUPABASE_KEY) {
    console.error("Defina SUPABASE_SERVICE_ROLE_KEY antes de rodar npm run sync-constants.")
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  console.log("Buscando dados do Supabase...")

  // Supabase has a hard cap (default 1000) enforced by PostgREST's db.max-rows
  // regardless of .limit(). Paginate explicitly via .range() for tables that
  // can exceed that cap (tags, genres).
  /**
   * @param {() => any} buildQuery
   * @param {number} [pageSize]
   * @returns {Promise<{ data: any[] | null, error: any }>}
   */
  async function fetchAllPaginated(buildQuery, pageSize = 1000) {
    /** @type {any[]} */
    const out = []
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await buildQuery().range(from, from + pageSize - 1)
      if (error) return { data: null, error }
      if (!data || data.length === 0) break
      out.push(...data)
      if (data.length < pageSize) break
    }
    return { data: out, error: null }
  }

  const [criteriaRes, pubStatusRes, persStatusRes, sourceRes, tagGroupRes, tagsRes, genresRes, tooltipsRes, uiLabelsRes] = await Promise.all([
    supabase.from("criteria").select("eval_type, slug, criteria, emoji, description, weight, key, ranges").order("id"),
    supabase.from("publication_status").select("id, status, slug, short, color, symbol").order("id"),
    supabase.from("personal_status").select("id, status, slug, color, symbol, comment").order("id"),
    supabase.from("source").select("slug, name").order("order", { ascending: true, nullsFirst: false }).order("name"),
    supabase.from("tag_group").select("id, slug, group, description, example").order("group"),
    fetchAllPaginated(() => supabase.from("tags").select("name, slug, tag_group_id").order("name")),
    fetchAllPaginated(() => supabase.from("genres").select("id, name, slug")),
    supabase.from("tooltips").select("item, value, stars, description, type"),
    supabase.from("ui_labels").select("field, category, name_full, name_short, name_abbrev, tooltip_full, tooltip_short, sort_order").order("sort_order", { ascending: true, nullsFirst: false }),
  ])

  /** @type {Array<[string, { data: any, error: any }]>} */
  const responses = [["criteria", criteriaRes], ["publication_status", pubStatusRes], ["personal_status", persStatusRes], ["source", sourceRes], ["tag_group", tagGroupRes], ["tags", tagsRes], ["genres", genresRes], ["tooltips", tooltipsRes], ["ui_labels", uiLabelsRes]]
  for (const [name, res] of responses) {
    if (res.error) { console.error(`Erro em ${name}:`, res.error.message); process.exit(1) }
  }

  const allCriteria   = criteriaRes.data
  const iaCriteria    = allCriteria.filter(c => c.eval_type === "IA")
  const userCriteria  = allCriteria.filter(c => c.eval_type === "User")
  const pubStatuses   = pubStatusRes.data
  const rawPersStatuses = persStatusRes.data
  const sources       = withCodeOnlySources(sourceRes.data)
  const tagGroups     = tagGroupRes.data
  const tooltipRows = tooltipsRes.data ?? []
  const tooltipCriteria = tooltipRows.filter((t) => t.type === "criteria")
  const tooltipSynopsis = tooltipRows.filter((t) => t.type === "synopsis")

  const PERSONAL_STATUS_ORDER = [
    "To read",
    "Reading",
    "Started",
    "Stalled",
    "On-hold",
    "Completed",
    "Hiatus",
    "Dropped"
  ]

  const persStatuses = [...rawPersStatuses].sort((a, b) => {
    const idxA = PERSONAL_STATUS_ORDER.indexOf(a.status)
    const idxB = PERSONAL_STATUS_ORDER.indexOf(b.status)
    return idxA - idxB
  })

  console.log(`  ${iaCriteria.length} critérios IA, ${userCriteria.length} critérios User`)
  console.log(`  ${pubStatuses.length} pub statuses, ${persStatuses.length} personal statuses, ${sources.length} sources`)
  console.log(`  ${tagGroups.length} tag groups`)

  // Valida cruzamento entre tabela `source` (DB) e SEARCH_CONNECTORS implementados.
  // Divergências não param o sync, mas indicam que alguém esqueceu de adicionar
  // entrada no DB OU remover connector do código.
  const dbSourceSlugs = new Set((sourceRes.data ?? []).map((s) => s.slug).filter(Boolean))
  const implementedSet = new Set(IMPLEMENTED_CONNECTOR_SLUGS)
  const dbWithoutConnector = [...dbSourceSlugs].filter((s) => !implementedSet.has(s))
  const connectorWithoutDb = IMPLEMENTED_CONNECTOR_SLUGS.filter((s) => !dbSourceSlugs.has(s))
  if (dbWithoutConnector.length > 0) {
    console.warn(`  ⚠ source no DB sem connector implementado: ${dbWithoutConnector.join(", ")}`)
  }
  if (connectorWithoutDb.length > 0) {
    console.warn(`  ⚠ connector implementado sem entrada na tabela source: ${connectorWithoutDb.join(", ")}`)
  }

  // ─────────────────────────────────────────────────────────────
  // 1. lib/constants/criteria.ts
  // ─────────────────────────────────────────────────────────────
  const criteriaInfoEntries = iaCriteria.map(c =>
    `  ${c.slug}: { name: ${JSON.stringify(c.criteria)}, emoji: ${JSON.stringify(c.emoji ?? "")}, description: ${JSON.stringify(c.description ?? "")} },`
  ).join("\n")

  const criteriaRubricsEntries = iaCriteria.map(c => {
    const ranges = (c.ranges || []).map(r => `      ${JSON.stringify(r)},`).join("\n")
    return `  ${c.slug}: {\n    title: ${JSON.stringify(c.criteria)},\n    ranges: [\n${ranges}\n    ],\n  },`
  }).join("\n")

  // Lookup texto→canonical para o normalizer de import (CSV/XLSX). Mapeia
  // status, slug e short (apenas pub) para o nome canônico.
  const pubLabelEntries = [...new Set(pubStatuses.flatMap(r => [
    r.short ? `  ${JSON.stringify(r.short)}: ${JSON.stringify(r.status)},` : null,
    r.slug ? `  ${JSON.stringify(r.slug)}: ${JSON.stringify(r.status)},` : null,
    `  ${JSON.stringify(r.status)}: ${JSON.stringify(r.status)},`,
  ].filter(Boolean)))].join("\n")

  const persLabelEntries = [...new Set(persStatuses.flatMap(r => [
    r.slug ? `  ${JSON.stringify(r.slug)}: ${JSON.stringify(r.status)},` : null,
    `  ${JSON.stringify(r.status)}: ${JSON.stringify(r.status)},`,
  ].filter(Boolean)))].join("\n")

  // Novos lookups por id — fonte da verdade após Fase 3.2 (UI passa a ler FKs).
  const pubByIdEntries = pubStatuses.map(r =>
    `  ${r.id}: { id: ${r.id}, status: ${JSON.stringify(r.status)}, slug: ${JSON.stringify(r.slug ?? "")}, short: ${JSON.stringify(r.short ?? "")}, color: ${JSON.stringify(r.color ?? "")}, symbol: ${JSON.stringify(r.symbol ?? "")} },`
  ).join("\n")

  const persByIdEntries = persStatuses.map(r =>
    `  ${r.id}: { id: ${r.id}, status: ${JSON.stringify(r.status)}, slug: ${JSON.stringify(r.slug ?? "")}, color: ${JSON.stringify(r.color ?? "")}, symbol: ${JSON.stringify(r.symbol ?? "")}, comment: ${JSON.stringify(r.comment ?? "")} },`
  ).join("\n")

  const platformLabelEntries = sources
    .filter(s => s.slug)
    .map(s => `  ${JSON.stringify(s.slug)}: ${JSON.stringify(s.name)},`)
    .join("\n")

  write("lib/constants/criteria.ts", `export const CRITERIA_INFO: Record<
  string,
  { name: string; emoji: string; description: string }
> = {
${criteriaInfoEntries}
}

export const CRITERIA_RUBRICS: Record<
  string,
  { title: string; ranges: string[]; note?: string }
> = {
${criteriaRubricsEntries}
}

export const PUBLICATION_STATUS_LABELS: Record<string, string> = {
${pubLabelEntries}
}

export const PERSONAL_STATUS_LABELS: Record<string, string> = {
${persLabelEntries}
}

export interface PublicationStatusInfo {
  id: number
  status: string
  slug: string
  short: string
  color: string
  symbol: string
}

export const PUBLICATION_STATUSES_BY_ID: Record<number, PublicationStatusInfo> = {
${pubByIdEntries}
}

export interface PersonalStatusInfo {
  id: number
  status: string
  slug: string
  color: string
  symbol: string
  comment: string
}

export const PERSONAL_STATUSES_BY_ID: Record<number, PersonalStatusInfo> = {
${persByIdEntries}
}

export const SYNOPSIS_QUALITY_LABELS: Record<string, string> = {
  "♥": "Fraca",
  "♥♥": "Regular",
  "♥♥♥": "Boa",
  "♥♥♥♥": "Ótima",
}

export const PLATFORM_LABELS: Record<string, string> = {
${platformLabelEntries}
}
`)

  // ─────────────────────────────────────────────────────────────
  // 2. lib/constants/post-reading-criteria.ts
  // ─────────────────────────────────────────────────────────────
  const userWithKey = userCriteria.filter(c => c.key)

  const weightsEntries = userWithKey
    .map(c => `  ${c.key}: ${Number(c.weight)},`)
    .join("\n")

  const weightLabelsEntries = userWithKey
    .map(c => `  ${c.key}: ${JSON.stringify(c.criteria)},`)
    .join("\n")

  const starHintEntries = userWithKey
    .map(c => {
      const ranges = Array.isArray(c.ranges) ? c.ranges : []
      const hints = [0, 1, 2, 3, 4].map((index) => ranges[index] ?? "")
      return `  ${c.key}: [\n${hints.map((hint) => `    ${JSON.stringify(hint)},`).join("\n")}\n  ],`
    })
    .join("\n")

  // criteria.description dos critérios User → tooltip nos nomes dos atributos.
  const criteriaDescEntries = userWithKey
    .map(c => `  ${c.key}: ${JSON.stringify(c.description ?? "")},`)
    .join("\n")

  // Legenda global de estrelas — tabela `tooltips` (linhas type='criteria').
  // `stars` no DB é string de glifos ("★★★"); deriva a contagem. `item` = rótulo.
  const starLegendEntries = [...tooltipCriteria]
    .map((t) => ({
      stars: (String(t.stars ?? "").match(/★/g) || []).length,
      value: Number(t.value),
      label: t.item,
      description: t.description ?? "",
    }))
    .filter((r) => r.stars >= 1 && Number.isFinite(r.value))
    .sort((a, b) => a.value - b.value)
    .map((r) => `  { stars: ${r.stars}, value: ${r.value}, label: ${JSON.stringify(r.label)}, description: ${JSON.stringify(r.description)} },`)
    .join("\n")

  // Legenda do "Interesse sinopse" — tabela `tooltips` (linhas type='synopsis').
  // `stars` = glifos de coração (exibidos direto). `item` = rótulo. Ordena pela
  // quantidade de corações.
  const synopsisLegendEntries = [...tooltipSynopsis]
    .map((t) => ({
      glyph: String(t.stars ?? ""),
      label: t.item,
      description: t.description ?? "",
      order: (String(t.stars ?? "").match(/[♥♡]/g) || []).length,
    }))
    .sort((a, b) => a.order - b.order)
    .map((r) => `  { glyph: ${JSON.stringify(r.glyph)}, label: ${JSON.stringify(r.label)}, description: ${JSON.stringify(r.description)} },`)
    .join("\n")

  write("lib/constants/post-reading-criteria.ts", `export const POST_READING_WEIGHT_STORAGE_KEY = "animedb:post-reading-weights"

export const POST_READING_STAR_VALUES = [2, 4, 6.5, 8, 10] as const
export type PostReadingStarValue = (typeof POST_READING_STAR_VALUES)[number]

export const DEFAULT_POST_READING_WEIGHTS = {
${weightsEntries}
} as const

export type PostReadingScoreField = keyof typeof DEFAULT_POST_READING_WEIGHTS

export const POST_READING_WEIGHT_LABELS: Record<PostReadingScoreField, string> = {
${weightLabelsEntries}
}

export const POST_READING_STAR_HINTS: Record<PostReadingScoreField, string[]> = {
${starHintEntries}
}

export const POST_READING_CRITERIA_DESCRIPTIONS: Record<PostReadingScoreField, string> = {
${criteriaDescEntries}
}

export interface PostReadingStarLegendEntry {
  stars: number
  value: number
  label: string
  description: string
}

export const POST_READING_STAR_LEGEND: PostReadingStarLegendEntry[] = [
${starLegendEntries}
]

export interface SynopsisInterestLegendEntry {
  glyph: string
  label: string
  description: string
}

export const SYNOPSIS_INTEREST_LEGEND: SynopsisInterestLegendEntry[] = [
${synopsisLegendEntries}
]

export function starsToPostReadingScore(stars: number): PostReadingStarValue {
  const index = Math.min(Math.max(Math.round(stars), 1), POST_READING_STAR_VALUES.length) - 1
  return POST_READING_STAR_VALUES[index]
}

export function scoreToPostReadingStars(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null
  let bestIndex = 0
  let bestDistance = Infinity
  POST_READING_STAR_VALUES.forEach((value, index) => {
    const distance = Math.abs(value - score)
    if (distance < bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
  })
  return bestIndex + 1
}

export function normalizePostReadingScore(score: number | null | undefined): PostReadingStarValue | null {
  const stars = scoreToPostReadingStars(score)
  return stars == null ? null : starsToPostReadingScore(stars)
}
`)

  // ─────────────────────────────────────────────────────────────
  // 3. lib/constants/tag-groups.ts
  // ─────────────────────────────────────────────────────────────
  const tagGroupIdEntries = tagGroups
    .filter(group => group.slug && group.id)
    .map(group => `  ${JSON.stringify(group.slug)}: ${JSON.stringify(group.id)},`)
    .join("\n")

  const tagGroupLabelEntries = tagGroups
    .filter(group => group.slug)
    .map(group => `  ${JSON.stringify(group.slug)}: ${JSON.stringify(group.group ?? group.slug)},`)
    .join("\n")

  const namedTagGroupExports = tagGroups
    .filter(group => group.slug && group.id)
    .map(group => `export const ${constNameFromSlug(group.slug)}_TAG_GROUP_ID = TAG_GROUP_IDS[${JSON.stringify(group.slug)}]`)
    .join("\n")

  write("lib/constants/tag-groups.ts", `export const TAG_GROUP_IDS = {
${tagGroupIdEntries}
} as const

export type TagGroupSlug = keyof typeof TAG_GROUP_IDS

export const TAG_GROUP_LABELS: Record<TagGroupSlug, string> = {
${tagGroupLabelEntries}
}

${namedTagGroupExports}
`)

  // ─────────────────────────────────────────────────────────────
  // 4. lib/constants/tags.ts  (tags por grupo para autocomplete)
  // ─────────────────────────────────────────────────────────────
  const allTags = (tagsRes.data ?? []).filter(t => t.name && t.name.trim())

  const tagGroupById = new Map(tagGroups.map(g => [g.id, g]))

  const genreNames = (genresRes.data ?? [])
    .map(g => g.name)
    .filter(Boolean)
    .map(name => name.trim())
    .sort((a, b) => a.localeCompare(b))

  const tagsByGroupSlug = new Map()
  for (const t of allTags) {
    const group = tagGroupById.get(t.tag_group_id)
    if (!group) continue
    const slug = group.slug
    if (!tagsByGroupSlug.has(slug)) tagsByGroupSlug.set(slug, { label: group.group ?? slug, values: [] })
    tagsByGroupSlug.get(slug).values.push(t.name.trim())
  }

  const genreNamesLiteral = genreNames.map(n => `  ${JSON.stringify(n)},`).join("\n")

  const tagGroupsLiteral = [...tagsByGroupSlug.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, { label, values }]) => {
      const valuesStr = values.map(v => `    ${JSON.stringify(v)},`).join("\n")
      return `  { groupSlug: ${JSON.stringify(slug)}, label: ${JSON.stringify(label)}, values: [\n${valuesStr}\n  ] },`
    })
    .join("\n")

  write("lib/constants/tags.ts", `// GENERATED by sync-constants — não editar manualmente

export const GENRE_NAMES: string[] = [
${genreNamesLiteral}
]

export const TAG_GROUPS_CATALOG: Array<{ groupSlug: string; label: string; values: string[] }> = [
${tagGroupsLiteral}
]
`)

  console.log(`  ${genreNames.length} gêneros, ${allTags.length - genreNames.length} outras tags em ${tagsByGroupSlug.size} grupos`)

  // ─────────────────────────────────────────────────────────────
  // 4b. lib/constants/ui-labels.ts  (nomes + tooltips soltos, por campo)
  // ─────────────────────────────────────────────────────────────
  const uiLabels = uiLabelsRes.data ?? []
  // `field` vira LABELS.<field> no código → precisa ser identificador JS válido.
  const isValidLabelKey = (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(k ?? ""))
  const invalidLabelKeys = uiLabels.filter((r) => !isValidLabelKey(r.field))
  if (invalidLabelKeys.length > 0) {
    console.warn(`  ⚠ ui_labels.field não é identificador JS válido (será pulado): ${invalidLabelKeys.map((r) => JSON.stringify(r.field)).join(", ")}`)
  }
  const labelEntries = uiLabels
    .filter((r) => isValidLabelKey(r.field) && r.name_full != null)
    .map((r) => {
      const props = [
        `full: ${JSON.stringify(r.name_full ?? "")}`,
        `short: ${JSON.stringify(r.name_short ?? r.name_full ?? "")}`,
        `abbrev: ${JSON.stringify(r.name_abbrev ?? r.name_short ?? r.name_full ?? "")}`,
        `tooltip_full: ${JSON.stringify(r.tooltip_full ?? "")}`,
        `tooltip_short: ${JSON.stringify(r.tooltip_short ?? "")}`,
      ]
      return `  ${r.field}: { ${props.join(", ")} },`
    })
    .join("\n")

  write("lib/constants/ui-labels.ts", `// GENERATED by sync-constants — não editar manualmente (fonte: tabela ui_labels).
// Renomear = editar a linha no Supabase (colunas name_*/tooltip_*) e rodar \`npm run sync-constants\`.
// LABELS.<field> = { full, short, abbrev, tooltip_full, tooltip_short }. field = nome da variável.
export const LABELS = {
${labelEntries}
} as const

export type LabelField = keyof typeof LABELS
`)
  console.log(`  ${uiLabels.length} campos de LABELS`)

  // ─────────────────────────────────────────────────────────────
  // 4. lib/external/types.ts  (ExternalSourceId only)
  // ─────────────────────────────────────────────────────────────
  const typesPath = path.resolve(ROOT, "lib/external/types.ts")
  let typesContent = fs.readFileSync(typesPath, "utf-8")

  const slugList = sources.filter(s => s.slug).map(s => `  | ${JSON.stringify(s.slug)}`).join("\n")
  const newExternalSourceId = `export type ExternalSourceId =\n${slugList}`

  typesContent = typesContent.replace(
    /export type ExternalSourceId =[\s\S]*?(?=\n\nexport|\n\/\/|$)/,
    newExternalSourceId
  )
  write("lib/external/types.ts", typesContent)

  // ─────────────────────────────────────────────────────────────
  // 5. lib/import/mapper.ts  (critérios de todas as eval_types)
  // ─────────────────────────────────────────────────────────────
  const allIaCriteria = allCriteria.filter(c => c.eval_type === "IA" || c.eval_type === "IArite")

  const criteriaAliasLines = uniqueAliasLines(allIaCriteria)

  const criteriaSlugCases = allIaCriteria
    .map(c => `      case ${JSON.stringify(c.slug)}:`)
    .join("\n")

  write("lib/import/mapper.ts", `import type { MappedImportRow, ImportColumnMapping } from "@/types/domain"
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
${criteriaAliasLines}

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
${criteriaSlugCases}
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
`)

  // ─────────────────────────────────────────────────────────────
  // 5. lib/import/normalizer.ts
  // ─────────────────────────────────────────────────────────────
  // publication_status: mapeia short, slug e status → status (canônico) para import.
  const pubMapEntries = []
  for (const r of pubStatuses) {
    if (r.short) pubMapEntries.push(`    ${JSON.stringify(r.short.toUpperCase())}: ${JSON.stringify(r.status)},`)
    if (r.slug) pubMapEntries.push(`    ${JSON.stringify(r.slug.toUpperCase())}: ${JSON.stringify(r.status)},`)
    pubMapEntries.push(`    ${JSON.stringify(r.status.toUpperCase())}: ${JSON.stringify(r.status)},`)
  }
  const pubMapStr = [...new Set(pubMapEntries)].join("\n")

  // personal_status: mapeia slug e status → status (canônico) para import.
  const persMapEntries = []
  for (const r of persStatuses) {
    if (r.slug) persMapEntries.push(`    ${JSON.stringify(r.slug.toLowerCase())}: ${JSON.stringify(r.status)},`)
    persMapEntries.push(`    ${JSON.stringify(r.status.toLowerCase())}: ${JSON.stringify(r.status)},`)
  }
  const persMapStr = [...new Set(persMapEntries)].join("\n")

  write("lib/import/normalizer.ts", `import type {
  PublicationStatus,
  PersonalStatus,
  SynopsisQuality,
} from "@/types/domain"

export function parseBrazilianNumber(value: unknown): number | null {
  if (value == null) return null
  const str = String(value)
    .trim()
    .replace(",", ".")
    .replace(/[^\\d.\\-]/g, "")
  if (str === "" || str === "-") return null
  const n = parseFloat(str)
  return isNaN(n) ? null : n
}

export function normalizeScore(value: unknown): number | null {
  const n = parseBrazilianNumber(value)
  if (n == null) return null
  return Math.max(0, Math.min(10, n))
}

export function normalizePublicationStatus(
  value: unknown
): PublicationStatus | null {
  if (value == null) return null
  const s = String(value).trim().toUpperCase()
  const map: Record<string, PublicationStatus> = {
${pubMapStr}
  }
  return map[s] ?? null
}

export function normalizePersonalStatus(
  value: unknown
): PersonalStatus | null {
  if (value == null) return null
  const s = String(value).trim().toLowerCase()
  const map: Record<string, PersonalStatus> = {
${persMapStr}
  }
  return map[s] ?? null
}

export function normalizeSynopsisQuality(
  value: unknown
): SynopsisQuality | null {
  if (value == null) return null
  const s = String(value).trim()
  const valid: SynopsisQuality[] = [${["♥", "♥♥", "♥♥♥", "♥♥♥♥"].map(v => JSON.stringify(v)).join(", ")}]
  return valid.includes(s as SynopsisQuality) ? (s as SynopsisQuality) : null
}

export function parseInteger(value: unknown): number | null {
  const n = parseBrazilianNumber(value)
  if (n == null) return null
  return Math.round(n)
}
`)

  // ─────────────────────────────────────────────────────────────
  // 6. types/domain.ts
  // ─────────────────────────────────────────────────────────────
  const domainPath = path.resolve(ROOT, "types/domain.ts")
  let domainContent = fs.readFileSync(domainPath, "utf-8")

  domainContent = domainContent.replace(
    /export const PUBLICATION_STATUSES = \[[\s\S]*?\] as const/,
    `export const PUBLICATION_STATUSES = ${literalArray(pubStatuses.map((r) => r.status))} as const`
  )
  domainContent = domainContent.replace(
    /export const PERSONAL_STATUSES = \[[\s\S]*?\] as const/,
    `export const PERSONAL_STATUSES = ${literalMultilineArray(persStatuses.map((r) => r.status))} as const`
  )
  domainContent = domainContent.replace(
    /export const PLATFORMS = \[[\s\S]*?\] as const/,
    `export const PLATFORMS = ${literalArray(sources.map((s) => s.slug).filter(Boolean))} as const`
  )
  domainContent = domainContent.replace(
    /export const CRITERION_SLUGS = \[[\s\S]*?\] as const/,
    `export const CRITERION_SLUGS = ${literalMultilineArray(iaCriteria.map((c) => c.slug))} as const`
  )
  write("types/domain.ts", domainContent)

  console.log("\nSync concluído! Arquivos atualizados:")
  console.log("  lib/constants/criteria.ts")
  console.log("  lib/constants/post-reading-criteria.ts")
  console.log("  lib/constants/tag-groups.ts")
  console.log("  lib/constants/tags.ts")
  console.log("  lib/constants/ui-labels.ts")
  console.log("  lib/external/types.ts")
  console.log("  lib/import/mapper.ts")
  console.log("  lib/import/normalizer.ts")
  console.log("  types/domain.ts")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
