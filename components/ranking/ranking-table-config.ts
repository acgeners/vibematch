import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"

export type RankingColumnGroup = "basico" | "notas" | "criterios"

export interface RankingColumnDef {
  key: string
  label: string
  configLabel?: string
  defaultWidth: number
  align?: "left" | "right" | "center"
  locked?: boolean
  group: RankingColumnGroup
}

export interface RankingColumnConfig {
  order: string[]
  hidden: string[]
}

export const RANKING_COLUMN_GROUP_LABELS: Record<RankingColumnGroup, string> = {
  basico: "Básico",
  notas: "Notas",
  criterios: "Critérios",
}

export const RANKING_TABLE_COLUMN_CONFIG_STORAGE_KEY = "ranking_col_config_v1"
export const RANKING_TABLE_COLUMN_CONFIG_EVENT = "ranking-column-config-change"

export const RANKING_TABLE_COLUMNS: RankingColumnDef[] = [
  { key: "rank", label: "#", defaultWidth: 48, align: "center", locked: true, group: "basico" },
  { key: "title", label: "Título", defaultWidth: 280, locked: true, group: "basico" },
  { key: "pub", label: "Pub.", defaultWidth: 100, align: "center", group: "basico" },
  { key: "per_status", label: "Status", defaultWidth: 64, align: "center", group: "basico" },
  { key: "year", label: "Ano", defaultWidth: 70, align: "center", group: "basico" },
  { key: "chapters", label: "Cap.", defaultWidth: 70, align: "center", group: "basico" },
  { key: "chapters_read", label: "Lidos", defaultWidth: 70, align: "center", group: "basico" },
  { key: "synopsis_q", label: "Sinopse", defaultWidth: 80, align: "center", group: "basico" },
  { key: "platform_avg", label: "Nota.M", defaultWidth: 88, align: "center", group: "notas" },
  { key: "total_votes", label: "Votos", defaultWidth: 88, align: "center", group: "notas" },
  { key: "final", label: "Nota.Final", defaultWidth: 100, align: "center", group: "notas" },
  { key: "final_confidence", label: "Conf.", configLabel: "Confiança da Nota.Final", defaultWidth: 96, align: "center", group: "notas" },
  { key: "calc", label: "Nota.IA", defaultWidth: 100, align: "center", group: "notas" },
  { key: "pred", label: "Nota.Pr", defaultWidth: 100, align: "center", group: "notas" },
  { key: "personal_fit", label: "Alinh.", configLabel: "Alinhamento com perfil", defaultWidth: 110, align: "center", group: "notas" },
  { key: "alignment_score", label: "IA Rk.", configLabel: "IA Re-rank (sob demanda)", defaultWidth: 80, align: "center", group: "notas" },
  ...CRITERION_SLUGS.map((slug) => ({
    key: `crit_${slug}`,
    label: CRITERIA_INFO[slug]?.emoji ?? slug,
    configLabel: `${CRITERIA_INFO[slug]?.emoji ?? ""} ${CRITERIA_INFO[slug]?.name ?? slug}`.trim(),
    defaultWidth: 56,
    align: "center" as const,
    group: "criterios" as const,
  })),
]

const DEFAULT_COLUMN_KEYS = RANKING_TABLE_COLUMNS.map((column) => column.key)
const DEFAULT_COLUMN_CONFIG: RankingColumnConfig = {
  order: DEFAULT_COLUMN_KEYS,
  hidden: [],
}
let cachedRawColumnConfig: string | null = null
let cachedColumnConfig: RankingColumnConfig = DEFAULT_COLUMN_CONFIG

export function normalizeRankingColumnConfig(
  value: Partial<RankingColumnConfig> | null | undefined
): RankingColumnConfig {
  const knownKeys = new Set(DEFAULT_COLUMN_KEYS)
  const order = [
    ...(value?.order ?? []).filter((key) => knownKeys.has(key)),
    ...DEFAULT_COLUMN_KEYS.filter((key) => !(value?.order ?? []).includes(key)),
  ]
  const hidden = (value?.hidden ?? []).filter((key) => {
    const column = RANKING_TABLE_COLUMNS.find((item) => item.key === key)
    return column && !column.locked
  })
  return { order, hidden }
}

export function getDefaultRankingColumnConfig(): RankingColumnConfig {
  return DEFAULT_COLUMN_CONFIG
}

export function getConfiguredRankingColumns(config: RankingColumnConfig): RankingColumnDef[] {
  const normalized = normalizeRankingColumnConfig(config)
  const hidden = new Set(normalized.hidden)
  const byKey = new Map(RANKING_TABLE_COLUMNS.map((column) => [column.key, column]))
  return normalized.order
    .map((key) => byKey.get(key))
    .filter((column): column is RankingColumnDef => Boolean(column))
    .filter((column) => column.locked || !hidden.has(column.key))
}

export function readRankingColumnConfig(): RankingColumnConfig {
  if (typeof window === "undefined") return getDefaultRankingColumnConfig()
  try {
    const stored = window.localStorage.getItem(RANKING_TABLE_COLUMN_CONFIG_STORAGE_KEY)
    if (!stored) {
      cachedRawColumnConfig = null
      cachedColumnConfig = DEFAULT_COLUMN_CONFIG
      return cachedColumnConfig
    }
    if (stored === cachedRawColumnConfig) return cachedColumnConfig
    cachedRawColumnConfig = stored
    cachedColumnConfig = normalizeRankingColumnConfig(
      JSON.parse(stored) as Partial<RankingColumnConfig>
    )
    return cachedColumnConfig
  } catch {
    cachedRawColumnConfig = null
    cachedColumnConfig = DEFAULT_COLUMN_CONFIG
    return cachedColumnConfig
  }
}

export function subscribeRankingColumnConfig(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {}
  const sync = () => onStoreChange()
  window.addEventListener(RANKING_TABLE_COLUMN_CONFIG_EVENT, sync)
  window.addEventListener("storage", sync)
  return () => {
    window.removeEventListener(RANKING_TABLE_COLUMN_CONFIG_EVENT, sync)
    window.removeEventListener("storage", sync)
  }
}

export function writeRankingColumnConfig(config: RankingColumnConfig) {
  if (typeof window === "undefined") return
  const normalized = normalizeRankingColumnConfig(config)
  cachedColumnConfig = normalized
  cachedRawColumnConfig = JSON.stringify(normalized)
  window.localStorage.setItem(
    RANKING_TABLE_COLUMN_CONFIG_STORAGE_KEY,
    cachedRawColumnConfig
  )
  window.dispatchEvent(new CustomEvent(RANKING_TABLE_COLUMN_CONFIG_EVENT, { detail: normalized }))
}

export type RankingColumnPreset = "padrao" | "compacto" | "notas" | "criterios"

export const RANKING_COLUMN_PRESETS: Array<{ id: RankingColumnPreset; label: string }> = [
  { id: "padrao", label: "Padrão" },
  { id: "compacto", label: "Compacto" },
  { id: "notas", label: "Foco em notas" },
  { id: "criterios", label: "Foco em critérios" },
]

const CRITERION_KEYS = CRITERION_SLUGS.map((slug) => `crit_${slug}`)

const PRESET_VISIBLE_KEYS: Record<RankingColumnPreset, string[]> = {
  padrao: DEFAULT_COLUMN_KEYS,
  compacto: ["rank", "title", "pub", "per_status", "final", "calc", "pred"],
  notas: ["rank", "title", "final", "final_confidence", "personal_fit", "calc", "pred", "platform_avg", "total_votes"],
  criterios: ["rank", "title", "final", ...CRITERION_KEYS],
}

export function getPresetConfig(preset: RankingColumnPreset): RankingColumnConfig {
  const visible = new Set(PRESET_VISIBLE_KEYS[preset])
  const hidden = DEFAULT_COLUMN_KEYS.filter((key) => {
    if (visible.has(key)) return false
    const column = RANKING_TABLE_COLUMNS.find((item) => item.key === key)
    return column ? !column.locked : false
  })
  return normalizeRankingColumnConfig({ order: DEFAULT_COLUMN_KEYS, hidden })
}

export function getActivePreset(config: RankingColumnConfig): RankingColumnPreset | null {
  const normalized = normalizeRankingColumnConfig(config)
  const orderIsDefault =
    normalized.order.length === DEFAULT_COLUMN_KEYS.length &&
    normalized.order.every((key, index) => key === DEFAULT_COLUMN_KEYS[index])
  if (!orderIsDefault) return null
  const hiddenSet = new Set(normalized.hidden)
  for (const preset of RANKING_COLUMN_PRESETS) {
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

export function getColumnGroup(key: string): RankingColumnGroup | null {
  return RANKING_TABLE_COLUMNS.find((column) => column.key === key)?.group ?? null
}
