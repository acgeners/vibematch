import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"

export type WorkColumnGroup = "basico" | "notas" | "criterios" | "legado"

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
  criterios: "Atributos",
  legado: "Legado",
}

export type WorkColumnNamespace = "titles" | "favorites" | "ranking" | "recommendations"
export const DEFAULT_WORK_COLUMN_NAMESPACE: WorkColumnNamespace = "titles"

// Versionamento per-namespace. Bump quando mudar NAMESPACE_HIDDEN do namespace
// pra que usuários existentes recebam os novos defaults sem precisar resetar.
//   - titles v4 → v5: oculta chapters_progress e ai_status do default
//   - favorites v4 → v5: oculta publication_status, ai_status, updated_at,
//     chapters_progress do default
//   - ranking, recommendations: sem mudança de default, mantêm v4
const NAMESPACE_STORAGE_VERSION: Record<WorkColumnNamespace, string> = {
  titles: "v5",
  favorites: "v5",
  ranking: "v4",
  recommendations: "v4",
}

function storageKeyFor(namespace: WorkColumnNamespace): string {
  return `${namespace}_col_config_${NAMESPACE_STORAGE_VERSION[namespace]}`
}

function eventNameFor(namespace: WorkColumnNamespace): string {
  return `${namespace}-column-config-change`
}

// Kept for backwards compatibility with code that imports the original key name.
export const WORK_TABLE_COLUMN_CONFIG_STORAGE_KEY = storageKeyFor("titles")
export const WORK_TABLE_COLUMN_CONFIG_EVENT = eventNameFor("titles")

export const WORK_TABLE_COLUMNS: WorkColumnDef[] = [
  { key: "select", label: "", align: "center", locked: true, group: "basico" },
  { key: "fav", label: "Fav", configLabel: "Favorito", align: "center", group: "basico" },
  { key: "title", label: "Título", locked: true, group: "basico" },
  { key: "publication_status", label: "Pub.", configLabel: "Publicação", align: "center", group: "basico" },
  { key: "personal_status", label: "Status", configLabel: "Status pessoal", align: "center", group: "basico" },
  { key: "chapters_total", label: "Caps.", configLabel: "Capítulos totais", align: "center", group: "basico" },
  { key: "chapters_read", label: "Lidos", configLabel: "Capítulos lidos", align: "center", group: "basico" },
  { key: "chapters_progress", label: "% Lido", configLabel: "% lido (capítulos lidos / total)", align: "center", group: "basico" },
  { key: "year", label: "Ano", align: "center", defaultHidden: true, group: "basico" },
  { key: "synopsis_q", label: "Sinopse", configLabel: "Interesse na sinopse", align: "center", defaultHidden: true, group: "basico" },
  // Novo (Fase 1.5): expected_score é o L1 que substitui o trio N.IA/N.Pr/N.Final
  { key: "expected_score", label: "Esperada", configLabel: "Nota esperada (L1 single Ridge — substitui N.IA/N.Pr/N.Final)", align: "center", group: "notas" },
  { key: "expected_baseline", label: "Perfil", configLabel: "Stage 1 da decomposição — contribuição do perfil (sem qualidade)", align: "center", defaultHidden: true, group: "legado" },
  { key: "expected_quality_adj", label: "Δ Qual.", configLabel: "Stage 2 da decomposição — ajuste pelas 8 dimensões de qualidade", align: "center", defaultHidden: true, group: "legado" },
  { key: "personal_fit", label: "Alinh.", configLabel: "Alinhamento com perfil (fit_score)", align: "center", group: "notas" },
  // Legado — escondidos por padrão após cutover Fase 1.5. Disponíveis via column
  // picker ou preset "Legado". Vão ser removidos quando Fase 2 (consultor) ativar.
  { key: "calc_score", label: "N.IA", configLabel: "[Legado] Nota.IA (calculada via avaliação da IA)", align: "center", defaultHidden: true, group: "legado" },
  { key: "predicted_score", label: "N.Pr", configLabel: "[Legado] Nota.Pr (predição por regressão)", align: "center", defaultHidden: true, group: "legado" },
  { key: "final_score", label: "N.Final", configLabel: "[Legado] Nota.Final (mistura ponderada de N.IA e N.Pr)", align: "center", defaultHidden: true, group: "legado" },
  { key: "platform_avg", label: "N.M", configLabel: "Nota.M (média ponderada das plataformas)", align: "center", defaultHidden: true, group: "notas" },
  { key: "total_votes", label: "Votos", configLabel: "Total de votos nas plataformas", align: "center", defaultHidden: true, group: "notas" },
  { key: "alignment_score", label: "IA Rk.", configLabel: "IA Re-rank (0-100) — score que ordena 'Recomendar com IA' / 'Próxima leitura' / 'Recomendar do ranking'", align: "center", defaultHidden: true, group: "notas" },
  { key: "ai_status", label: "IA", configLabel: "Status da avaliação IA", align: "center", group: "basico" },
  { key: "updated_at", label: "Atual.", configLabel: "Atualizado em", align: "center", group: "basico" },
  { key: "last_read_at", label: "Últ. leitura", configLabel: "Última leitura", align: "center", defaultHidden: true, group: "basico" },
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
// Legacy: N.IA/N.Pr/N.Final + decomposição (baseline/quality_adj) ficam
// escondidos por padrão em TODOS os namespaces após cutover Fase 1.5.
// IA Rk. saiu do bucket legacy — continua ativo no fluxo de recomendação
// e é exibido por default em /ranking e /recommendations.
const LEGACY_AND_DECOMP_HIDDEN = [
  "calc_score",
  "predicted_score",
  "final_score",
  "expected_baseline",
  "expected_quality_adj",
] as const

const NAMESPACE_HIDDEN: Record<WorkColumnNamespace, string[]> = {
  // Visão geral (filosofia: ENXUTA). Catálogo de gerenciamento — foco em
  // status, capítulos e Esperada. ai_status saiu do default (já há filtro
  // dedicado por ai_eval_status); chapters_progress sai por redundância com
  // chapters_read+total.
  titles: [
    "synopsis_q",
    "ai_status",
    "chapters_progress",
    "alignment_score",
    ...LEGACY_AND_DECOMP_HIDDEN,
    ...CRITERION_SLUGS.map((slug) => `crit_${slug}`),
  ],
  // Favoritos (filosofia: RICA — deep dive). Critérios visíveis; metadados
  // como publication_status, ai_status e updated_at saem do default por serem
  // pouco relevantes em obras já favoritadas.
  favorites: [
    "synopsis_q",
    "year",
    "publication_status",
    "ai_status",
    "updated_at",
    "chapters_read",
    "chapters_progress",
    ...LEGACY_AND_DECOMP_HIDDEN,
  ],
  // Ranking: foco em comparar notas; sinopse, ano e ai_status fora; critérios visíveis.
  // IA Rk. visível — quem chega aqui geralmente quer ver o re-rank IA.
  ranking: [
    "synopsis_q", "year", "ai_status", "chapters_read", "chapters_progress",
    ...LEGACY_AND_DECOMP_HIDDEN,
  ],
  // Recomendações: 9 critérios em destaque; resto enxuto.
  // IA Rk. visível — É a nota que ORDENA o próprio resultado da run.
  recommendations: [
    "synopsis_q",
    "year",
    "ai_status",
    "chapters_read",
    "chapters_progress",
    "total_votes",
    "updated_at",
    "last_read_at",
    ...LEGACY_AND_DECOMP_HIDDEN,
  ],
}

const DEFAULT_COLUMN_CONFIG_BY_NAMESPACE: Record<WorkColumnNamespace, WorkColumnConfig> = {
  titles: { order: DEFAULT_COLUMN_KEYS, hidden: NAMESPACE_HIDDEN.titles },
  favorites: { order: DEFAULT_COLUMN_KEYS, hidden: NAMESPACE_HIDDEN.favorites },
  ranking: { order: DEFAULT_COLUMN_KEYS, hidden: NAMESPACE_HIDDEN.ranking },
  recommendations: { order: DEFAULT_COLUMN_KEYS, hidden: NAMESPACE_HIDDEN.recommendations },
}

// Legado — alguns consumers ainda referenciam o default "global".
const DEFAULT_COLUMN_CONFIG: WorkColumnConfig = DEFAULT_COLUMN_CONFIG_BY_NAMESPACE.titles

const cachedRawColumnConfig: Map<WorkColumnNamespace, string | null> = new Map()
const cachedColumnConfig: Map<WorkColumnNamespace, WorkColumnConfig> = new Map()

const LOCKED_KEYS = new Set(WORK_TABLE_COLUMNS.filter((c) => c.locked).map((c) => c.key))

export function normalizeWorkColumnConfig(
  value: Partial<WorkColumnConfig> | null | undefined
): WorkColumnConfig {
  const knownKeys = new Set(DEFAULT_COLUMN_KEYS)
  // User-controlled order applies only to non-locked columns. Locked columns
  // are always placed at their canonical positions (select/title first,
  // actions last) regardless of stored order — this protects against stale
  // localStorage entries that predate columns being added.
  const userNonLocked = (value?.order ?? []).filter(
    (key) => knownKeys.has(key) && !LOCKED_KEYS.has(key)
  )
  const canonicalNonLocked = DEFAULT_COLUMN_KEYS.filter((key) => !LOCKED_KEYS.has(key))
  const remainingNonLocked = canonicalNonLocked.filter((key) => !userNonLocked.includes(key))
  const orderedNonLocked = [...userNonLocked, ...remainingNonLocked]
  const order: string[] = []
  let nonLockedIdx = 0
  for (const key of DEFAULT_COLUMN_KEYS) {
    if (LOCKED_KEYS.has(key)) {
      order.push(key)
    } else {
      order.push(orderedNonLocked[nonLockedIdx++])
    }
  }
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
  fav: 44,
  title: 360,
  publication_status: 130,
  personal_status: 110,
  chapters_total: 70,
  chapters_read: 70,
  chapters_progress: 80,
  year: 70,
  synopsis_q: 90,
  expected_score: 90,
  expected_baseline: 80,
  expected_quality_adj: 80,
  personal_fit: 64,
  calc_score: 80,
  predicted_score: 80,
  final_score: 90,
  platform_avg: 80,
  total_votes: 70,
  alignment_score: 70,
  ai_status: 80,
  updated_at: 110,
  last_read_at: 110,
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

// Colunas renderizáveis no heatmap. Inclui:
//   - notas 0-10 com color coding (final, calc, predicted, expected, criterios)
//   - `total_votes` (count sem color coding — formatado como 1.5k/50k)
//   - `synopsis_q` (string de corações ♥-♥♥♥♥ pra interesse na sinopse)
const SCORE_COLUMN_KEYS = new Set<string>([
  "expected_score",
  "expected_baseline",
  "expected_quality_adj",
  "final_score",
  "calc_score",
  "predicted_score",
  "platform_avg",
  "total_votes",
  "alignment_score",
  "synopsis_q",
  ...CRITERION_SLUGS.map((slug) => `crit_${slug}`),
])

export function isScoreColumn(key: string): boolean {
  return SCORE_COLUMN_KEYS.has(key)
}

export type WorkColumnPreset = "tudo" | "geral" | "notas" | "criterios" | "legado"

export const WORK_COLUMN_PRESETS: Array<{ id: WorkColumnPreset; label: string }> = [
  { id: "tudo", label: "Tudo" },
  { id: "geral", label: "Geral" },
  { id: "notas", label: "Notas" },
  { id: "criterios", label: "Atributos" },
  { id: "legado", label: "Legado" },
]

const PRESET_VISIBLE_KEYS: Record<WorkColumnPreset, string[]> = {
  tudo: WORK_TABLE_COLUMNS.filter((c) => !c.locked).map((c) => c.key),
  geral: WORK_TABLE_COLUMNS.filter((c) => !c.locked && c.group === "basico").map((c) => c.key),
  notas: WORK_TABLE_COLUMNS.filter((c) => !c.locked && c.group === "notas").map((c) => c.key),
  criterios: WORK_TABLE_COLUMNS.filter((c) => !c.locked && c.group === "criterios").map((c) => c.key),
  legado: WORK_TABLE_COLUMNS.filter((c) => !c.locked && c.group === "legado").map((c) => c.key),
}

function hiddenForVisible(visibleKeys: Iterable<string>): string[] {
  const visible = new Set(visibleKeys)
  return DEFAULT_COLUMN_KEYS.filter((key) => {
    if (visible.has(key)) return false
    const column = WORK_TABLE_COLUMNS.find((item) => item.key === key)
    return column ? !column.locked : false
  })
}

export function getPresetConfig(preset: WorkColumnPreset): WorkColumnConfig {
  return normalizeWorkColumnConfig({
    order: DEFAULT_COLUMN_KEYS,
    hidden: hiddenForVisible(PRESET_VISIBLE_KEYS[preset]),
  })
}

export function getPresetSetConfig(presets: Iterable<WorkColumnPreset>): WorkColumnConfig {
  const union = new Set<string>()
  for (const preset of presets) {
    for (const key of PRESET_VISIBLE_KEYS[preset]) union.add(key)
  }
  return normalizeWorkColumnConfig({
    order: DEFAULT_COLUMN_KEYS,
    hidden: hiddenForVisible(union),
  })
}

// Um preset está "ativo" quando todas as colunas que ele exporia estão visíveis.
export function getActivePresetSet(config: WorkColumnConfig): Set<WorkColumnPreset> {
  const normalized = normalizeWorkColumnConfig(config)
  const hiddenSet = new Set(normalized.hidden)
  const active = new Set<WorkColumnPreset>()
  for (const preset of WORK_COLUMN_PRESETS) {
    const keys = PRESET_VISIBLE_KEYS[preset.id]
    if (keys.length === 0) continue
    if (keys.every((key) => !hiddenSet.has(key))) active.add(preset.id)
  }
  return active
}
