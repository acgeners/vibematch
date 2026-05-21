import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"

export type WorkColumnGroup = "basico" | "notas" | "criterios"

export interface WorkColumnDef {
  key: string
  label: string
  configLabel?: string
  align?: "left" | "right" | "center"
  locked?: boolean
  defaultHidden?: boolean
  group: WorkColumnGroup
}

export interface WorkColumnConfig {
  order: string[]
  hidden: string[]
  widths?: Record<string, number>
}

export const WORK_COLUMN_GROUP_LABELS: Record<WorkColumnGroup, string> = {
  basico: "Básico",
  notas: "Notas",
  criterios: "Critérios",
}

export type WorkColumnNamespace = "titles" | "favorites" | "ranking"
export const DEFAULT_WORK_COLUMN_NAMESPACE: WorkColumnNamespace = "titles"

function storageKeyFor(namespace: WorkColumnNamespace): string {
  return `${namespace}_col_config_v3`
}

function eventNameFor(namespace: WorkColumnNamespace): string {
  return `${namespace}-column-config-change`
}

// Kept for backwards compatibility with code that imports the original key name.
export const WORK_TABLE_COLUMN_CONFIG_STORAGE_KEY = storageKeyFor("titles")
export const WORK_TABLE_COLUMN_CONFIG_EVENT = eventNameFor("titles")

export const WORK_TABLE_COLUMNS: WorkColumnDef[] = [
  { key: "select", label: "", align: "center", locked: true, group: "basico" },
  { key: "title", label: "Título", locked: true, group: "basico" },
  { key: "publication_status", label: "Publicação", align: "center", group: "basico" },
  { key: "personal_status", label: "Pessoal", align: "center", group: "basico" },
  { key: "chapters", label: "Caps.", align: "center", group: "basico" },
  { key: "year", label: "Ano", align: "center", defaultHidden: true, group: "basico" },
  { key: "synopsis_q", label: "Sinopse", align: "center", defaultHidden: true, group: "basico" },
  { key: "calc_score", label: "Nota.IA", align: "center", group: "notas" },
  { key: "predicted_score", label: "Nota.Pr", align: "center", group: "notas" },
  { key: "final_score", label: "Nota.Final", align: "center", group: "notas" },
  { key: "platform_avg", label: "Nota.M", align: "center", defaultHidden: true, group: "notas" },
  { key: "total_votes", label: "Votos", align: "center", defaultHidden: true, group: "notas" },
  { key: "ai_status", label: "IA", align: "center", group: "basico" },
  ...CRITERION_SLUGS.map((slug) => ({
    key: `crit_${slug}`,
    label: CRITERIA_INFO[slug]?.emoji ?? slug,
    configLabel: `${CRITERIA_INFO[slug]?.emoji ?? ""} ${CRITERIA_INFO[slug]?.name ?? slug}`.trim(),
    align: "center" as const,
    defaultHidden: true,
    group: "criterios" as const,
  })),
  { key: "actions", label: "", align: "center", locked: true, group: "basico" },
]

const DEFAULT_COLUMN_KEYS = WORK_TABLE_COLUMNS.map((column) => column.key)

// Per-namespace defaults: /titles foca em geral; /favorites foca em granular.
const NAMESPACE_HIDDEN: Record<WorkColumnNamespace, string[]> = {
  // Visão geral: status, capítulos, ano, Nota.Final, Nota.M e Votos.
  titles: [
    "synopsis_q",
    "calc_score",
    "predicted_score",
    "ai_status",
    ...CRITERION_SLUGS.map((slug) => `crit_${slug}`),
  ],
  // Visão exploratória: critérios + todas as notas visíveis; ano e ai_status fora.
  favorites: ["synopsis_q", "year", "ai_status"],
  // Ranking: foco em comparar notas; sinopse, ano e ai_status fora; critérios visíveis.
  ranking: ["synopsis_q", "year", "ai_status"],
}

const DEFAULT_COLUMN_CONFIG_BY_NAMESPACE: Record<WorkColumnNamespace, WorkColumnConfig> = {
  titles: { order: DEFAULT_COLUMN_KEYS, hidden: NAMESPACE_HIDDEN.titles },
  favorites: { order: DEFAULT_COLUMN_KEYS, hidden: NAMESPACE_HIDDEN.favorites },
  ranking: { order: DEFAULT_COLUMN_KEYS, hidden: NAMESPACE_HIDDEN.ranking },
}

// Legado — alguns consumers ainda referenciam o default "global".
const DEFAULT_COLUMN_CONFIG: WorkColumnConfig = DEFAULT_COLUMN_CONFIG_BY_NAMESPACE.titles

const cachedRawColumnConfig: Map<WorkColumnNamespace, string | null> = new Map()
const cachedColumnConfig: Map<WorkColumnNamespace, WorkColumnConfig> = new Map()

export function normalizeWorkColumnConfig(
  value: Partial<WorkColumnConfig> | null | undefined
): WorkColumnConfig {
  const knownKeys = new Set(DEFAULT_COLUMN_KEYS)
  const order = [
    ...(value?.order ?? []).filter((key) => knownKeys.has(key)),
    ...DEFAULT_COLUMN_KEYS.filter((key) => !(value?.order ?? []).includes(key)),
  ]
  const hidden = (value?.hidden ?? []).filter((key) => {
    const column = WORK_TABLE_COLUMNS.find((item) => item.key === key)
    return column && !column.locked
  })
  const widths: Record<string, number> = {}
  for (const [key, w] of Object.entries(value?.widths ?? {})) {
    if (knownKeys.has(key) && typeof w === "number" && w > 0) {
      widths[key] = Math.round(w)
    }
  }
  return { order, hidden, widths }
}

// Default sizes per column key (px). Used when no user-set width exists.
export const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  select: 40,
  title: 360,
  publication_status: 130,
  personal_status: 110,
  chapters: 80,
  year: 70,
  synopsis_q: 90,
  calc_score: 80,
  predicted_score: 80,
  final_score: 90,
  platform_avg: 80,
  total_votes: 70,
  ai_status: 80,
  actions: 60,
}

export function getDefaultWorkColumnConfig(
  namespace: WorkColumnNamespace = DEFAULT_WORK_COLUMN_NAMESPACE,
): WorkColumnConfig {
  return DEFAULT_COLUMN_CONFIG_BY_NAMESPACE[namespace] ?? DEFAULT_COLUMN_CONFIG
}

export function getConfiguredWorkColumns(config: WorkColumnConfig): WorkColumnDef[] {
  const normalized = normalizeWorkColumnConfig(config)
  const hidden = new Set(normalized.hidden)
  const byKey = new Map(WORK_TABLE_COLUMNS.map((column) => [column.key, column]))
  return normalized.order
    .map((key) => byKey.get(key))
    .filter((column): column is WorkColumnDef => Boolean(column))
    .filter((column) => column.locked || !hidden.has(column.key))
}

export function readWorkColumnConfig(
  namespace: WorkColumnNamespace = DEFAULT_WORK_COLUMN_NAMESPACE,
): WorkColumnConfig {
  const fallback = getDefaultWorkColumnConfig(namespace)
  if (typeof window === "undefined") return fallback
  try {
    const stored = window.localStorage.getItem(storageKeyFor(namespace))
    if (!stored) {
      cachedRawColumnConfig.set(namespace, null)
      cachedColumnConfig.set(namespace, fallback)
      return fallback
    }
    if (stored === cachedRawColumnConfig.get(namespace)) {
      const cached = cachedColumnConfig.get(namespace)
      if (cached) return cached
    }
    const parsed = normalizeWorkColumnConfig(
      JSON.parse(stored) as Partial<WorkColumnConfig>
    )
    cachedRawColumnConfig.set(namespace, stored)
    cachedColumnConfig.set(namespace, parsed)
    return parsed
  } catch {
    cachedRawColumnConfig.set(namespace, null)
    cachedColumnConfig.set(namespace, fallback)
    return fallback
  }
}

export function subscribeWorkColumnConfig(
  onStoreChange: () => void,
  namespace: WorkColumnNamespace = DEFAULT_WORK_COLUMN_NAMESPACE,
) {
  if (typeof window === "undefined") return () => {}
  const sync = () => onStoreChange()
  const event = eventNameFor(namespace)
  window.addEventListener(event, sync)
  window.addEventListener("storage", sync)
  return () => {
    window.removeEventListener(event, sync)
    window.removeEventListener("storage", sync)
  }
}

export function writeWorkColumnConfig(
  config: WorkColumnConfig,
  namespace: WorkColumnNamespace = DEFAULT_WORK_COLUMN_NAMESPACE,
) {
  if (typeof window === "undefined") return
  const normalized = normalizeWorkColumnConfig(config)
  const serialized = JSON.stringify(normalized)
  cachedColumnConfig.set(namespace, normalized)
  cachedRawColumnConfig.set(namespace, serialized)
  window.localStorage.setItem(storageKeyFor(namespace), serialized)
  window.dispatchEvent(new CustomEvent(eventNameFor(namespace), { detail: normalized }))
}

// Score-type column keys (rendered in heatmap). Excludes total_votes since it's a count.
const SCORE_COLUMN_KEYS = new Set<string>([
  "final_score",
  "calc_score",
  "predicted_score",
  "platform_avg",
  ...CRITERION_SLUGS.map((slug) => `crit_${slug}`),
])

export function isScoreColumn(key: string): boolean {
  return SCORE_COLUMN_KEYS.has(key)
}

export type WorkColumnPreset = "lista" | "heatmap" | "tudo"

export const WORK_COLUMN_PRESETS: Array<{ id: WorkColumnPreset; label: string }> = [
  { id: "lista", label: "Lista padrão" },
  { id: "heatmap", label: "Heatmap padrão" },
  { id: "tudo", label: "Tudo" },
]

const PRESET_VISIBLE_KEYS: Record<WorkColumnPreset, string[]> = {
  lista: [
    "publication_status",
    "personal_status",
    "chapters",
    "year",
    "final_score",
    "platform_avg",
    "total_votes",
  ],
  heatmap: ["final_score", ...CRITERION_SLUGS.map((slug) => `crit_${slug}`)],
  tudo: WORK_TABLE_COLUMNS.filter((c) => !c.locked).map((c) => c.key),
}

export function getPresetConfig(preset: WorkColumnPreset): WorkColumnConfig {
  const visible = new Set(PRESET_VISIBLE_KEYS[preset])
  const hidden = DEFAULT_COLUMN_KEYS.filter((key) => {
    if (visible.has(key)) return false
    const column = WORK_TABLE_COLUMNS.find((item) => item.key === key)
    return column ? !column.locked : false
  })
  return normalizeWorkColumnConfig({ order: DEFAULT_COLUMN_KEYS, hidden })
}

export function getActivePreset(config: WorkColumnConfig): WorkColumnPreset | null {
  const normalized = normalizeWorkColumnConfig(config)
  const orderIsDefault =
    normalized.order.length === DEFAULT_COLUMN_KEYS.length &&
    normalized.order.every((key, index) => key === DEFAULT_COLUMN_KEYS[index])
  if (!orderIsDefault) return null
  const hiddenSet = new Set(normalized.hidden)
  for (const preset of WORK_COLUMN_PRESETS) {
    const expected = getPresetConfig(preset.id)
    const expectedHidden = new Set(expected.hidden)
    if (
      expectedHidden.size === hiddenSet.size &&
      [...expectedHidden].every((key) => hiddenSet.has(key))
    ) {
      return preset.id
    }
  }
  return null
}
