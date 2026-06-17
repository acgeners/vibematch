import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"

export type RankingColumnGroup = "basico" | "notas" | "criterios"

export interface RankingColumnDef {
  key: string
  label: string
  configLabel?: string
  /** Texto explicativo exibido na tooltip do cabeçalho (abaixo do título). */
  description?: string
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
  criterios: "Atributos",
}

// Bump v3 → v4 to hide chapters_read by default and add missing columns.
// Bump v4 → v5 to add the "Decisão" column (default sort) next to "Prevista".
// Bump v5 → v6 to HIDE "decision" by default: a Prioridade agora é comunicada
// por TIERS (divisores), não por um número dentro da incerteza do modelo.
// Bump v6 → v7 to add "synopsis_pred" (Previsão de interesse na sinopse) HIDDEN
// by default — disponível no column picker, mas opt-in.
// Bump v7 → v8 to drop the legacy Nota.IA/Pr/Final columns (aposentados — os
// dados Pr/Final já eram null; calc_score vira só feature interna do expected).
// (§6 Bloco 1, 2026-06-16) Removidas as colunas decompostas "Perfil"
// (expected_baseline) e "Δ Qualidade" (expected_quality_adj): a arquitetura
// 2-stage foi aposentada (L0_QUALITY_ENABLED=false → qualityAdj sempre 0, e
// baseline ≈ expected). Eram colunas mortas/enganosas. Sem bump da key:
// normalizeRankingColumnConfig descarta as chaves removidas (preserva as prefs).
export const RANKING_TABLE_COLUMN_CONFIG_STORAGE_KEY = "ranking_col_config_v8"
export const RANKING_TABLE_COLUMN_CONFIG_EVENT = "ranking-column-config-change"

export const RANKING_TABLE_COLUMNS: RankingColumnDef[] = [
  { key: "rank", label: "#", configLabel: "Posição", description: "Posição da obra na ordenação atual da tabela.", defaultWidth: 48, align: "center", locked: true, group: "basico" },
  { key: "fav", label: "Fav", configLabel: "Favorito", description: "Indica se a obra está marcada como favorita.", defaultWidth: 44, align: "center", group: "basico" },
  { key: "title", label: "Título", defaultWidth: 280, locked: true, group: "basico" },
  { key: "pub", label: "Pub.", configLabel: "Publicação", description: "Status de publicação da obra na fonte (em andamento, concluída, hiato, cancelada).", defaultWidth: 100, align: "center", group: "basico" },
  { key: "per_status", label: "Status", configLabel: "Status pessoal", description: "Seu status de leitura para a obra (pra ler, lendo, concluída, etc.).", defaultWidth: 64, align: "center", group: "basico" },
  { key: "year", label: "Ano", description: "Ano de lançamento/início da publicação.", defaultWidth: 70, align: "center", group: "basico" },
  { key: "chapters", label: "Caps.", configLabel: "Capítulos totais", description: "Número total de capítulos da obra, quando conhecido.", defaultWidth: 70, align: "center", group: "basico" },
  { key: "chapters_read", label: "Lidos", configLabel: "Capítulos lidos", description: "Quantos capítulos você já marcou como lidos.", defaultWidth: 70, align: "center", group: "basico" },
  { key: "chapters_progress", label: "% Lido", configLabel: "% lido", description: "Progresso de leitura: capítulos lidos ÷ total de capítulos.", defaultWidth: 80, align: "center", group: "basico" },
  { key: "synopsis_q", label: "Sinopse", configLabel: "Interesse na sinopse", description: "O quanto a sinopse te interessou (♥ a ♥♥♥♥), informado na triagem/avaliação.", defaultWidth: 80, align: "center", group: "basico" },
  { key: "synopsis_pred", label: "Prev. Sinopse", configLabel: "Previsão de interesse na sinopse", description: "A previsão da IA de quanto a sinopse vai te interessar (♥ a ♥♥♥♥), com base no seu perfil de gosto. Diferente da coluna \"Sinopse\", que é o valor que VOCÊ informou. Só preenchida em obras que passaram pela estimativa (feature Paga).", defaultWidth: 110, align: "center", group: "basico" },
  { key: "ai_status", label: "IA", configLabel: "Status da avaliação IA", description: "Estágio da avaliação por IA: pendente de atributos, pendente de IA Rk, avaliado ou pulado.", defaultWidth: 80, align: "center", group: "basico" },
  { key: "updated_at", label: "Atual.", configLabel: "Atualizado em", description: "Quando o registro da obra foi atualizado pela última vez.", defaultWidth: 110, align: "center", group: "basico" },
  { key: "last_read_at", label: "Últ. leitura", configLabel: "Última leitura", description: "Data da última vez que você leu algum capítulo desta obra.", defaultWidth: 110, align: "center", group: "basico" },
  { key: "platform_avg", label: "N.M", configLabel: "Nota.M", description: "A nota que o público das plataformas externas (AniList, MAL, etc.) dá à obra, na escala 0–10. É a opinião geral dos leitores, não a sua.", defaultWidth: 88, align: "center", group: "notas" },
  { key: "total_votes", label: "Votos", configLabel: "Votos", description: "Quantas pessoas avaliaram a obra nas plataformas externas — uma medida de popularidade e de quanta gente sustenta a Nota.M.", defaultWidth: 88, align: "center", group: "notas" },
  // Prioridade — "quão provável que você goste". Âncora na Prevista (que já
  // embute o Alinhamento calibrado) + IA Rk quando há. Exibida 0–100 = Decisão×10
  // (absoluta). Obras quase-empatadas se separam pela ORDEM (fit + bandas), não
  // por inflar o número. (Sort default agora é Prevista → IA Rk → Alinhamento.)
  { key: "decision", label: "Prioridade", configLabel: "Prioridade", description: "Quão provável que você goste da obra — um número único (0–100) pra decidir o que ler primeiro. Quanto maior, mais a obra deveria estar no topo da sua fila. Não é uma previsão de nota: é o lugar dela na sua ordem de leitura.", defaultWidth: 100, align: "center", group: "notas" },
  // Novo (Fase 1.5): expected_score é o L1 que substitui o trio Nota.IA/Pr/Final
  { key: "expected", label: "Prevista", configLabel: "Nota Prevista", description: "A nota que estimamos que você daria à obra (0–10), juntando o seu gosto com a qualidade dela. É a referência principal do ranking. Calculada a partir das notas dos atributos da IA, do seu perfil de gosto e da nota do público.", defaultWidth: 100, align: "center", group: "notas" },
  { key: "personal_fit", label: "Alinh.", configLabel: "Alinhamento", description: "O quanto a obra combina com o seu perfil de gosto. Quanto maior, mais alinhada às suas preferências — independente de a obra ser boa ou popular. Calculado comparando as tags e os atributos da obra com as suas preferências.", defaultWidth: 110, align: "center", group: "notas" },
  { key: "alignment_score", label: "IA Rk.", configLabel: "IA Rk", description: "A opinião de um consultor de IA sobre o quanto esta obra é uma boa recomendação pra você (0–100), pensada caso a caso. É um segundo olhar mais fino que a Nota Prevista. Gerada por um LLM que analisa o seu perfil, a sinopse e os atributos da obra. A maioria das obras fica sem valor até você pedir o Rankear.", defaultWidth: 80, align: "center", group: "notas" },
  ...CRITERION_SLUGS.map((slug) => ({
    key: `crit_${slug}`,
    label: CRITERIA_INFO[slug]?.emoji ?? slug,
    configLabel: `${CRITERIA_INFO[slug]?.emoji ?? ""} ${CRITERIA_INFO[slug]?.name ?? slug}`.trim(),
    defaultWidth: 44,
    align: "center" as const,
    group: "criterios" as const,
  })),
]

const DEFAULT_COLUMN_KEYS = RANKING_TABLE_COLUMNS.map((column) => column.key)
const LOCKED_KEYS = new Set(RANKING_TABLE_COLUMNS.filter((c) => c.locked).map((c) => c.key))

// Hidden por padrão a partir de v3:
//   - chapters_progress: tradição (igual v1)
//   - synopsis_q: pouco útil no contexto de ranking; reduz ruído
//   - alignment_score: NÃO está aqui — continua ativo no fluxo de
//     recomendação, fica visível por padrão em /ranking
const DEFAULT_COLUMN_CONFIG: RankingColumnConfig = {
  order: DEFAULT_COLUMN_KEYS,
  hidden: [
    // Prioridade: número escondido por padrão — a tabela separa por TIERS
    // (divisores), em vez de mostrar um decimal dentro da incerteza do modelo.
    "decision",
    "pub",
    "per_status",
    "chapters_read",
    "chapters_progress",
    // Previsão de interesse na sinopse: opt-in (disponível no column picker).
    "synopsis_pred",
    "ai_status",
    "updated_at",
    "last_read_at",
  ],
}
let cachedRawColumnConfig: string | null = null
let cachedColumnConfig: RankingColumnConfig = DEFAULT_COLUMN_CONFIG

export function normalizeRankingColumnConfig(
  value: Partial<RankingColumnConfig> | null | undefined
): RankingColumnConfig {
  const knownKeys = new Set(DEFAULT_COLUMN_KEYS)
  // Locked columns are pinned to their canonical positions; only non-locked
  // columns honor the user's stored order. This guards against stale storage
  // entries that predate columns being added/locked.
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
  { id: "criterios", label: "Foco em atributos" },
]

const CRITERION_KEYS = CRITERION_SLUGS.map((slug) => `crit_${slug}`)

// `padrao` agora reflete o novo default (sem legado, sem decomposição):
//   tudo do DEFAULT exceto as colunas explicitamente escondidas.
const PADRAO_VISIBLE = DEFAULT_COLUMN_KEYS.filter(
  (k) => !DEFAULT_COLUMN_CONFIG.hidden.includes(k),
)

const PRESET_VISIBLE_KEYS: Record<RankingColumnPreset, string[]> = {
  padrao: PADRAO_VISIBLE,
  compacto: ["rank", "title", "pub", "per_status", "expected", "personal_fit"],
  notas: [
    "rank", "title",
    "expected", "personal_fit", "alignment_score", "platform_avg", "total_votes",
  ],
  criterios: ["rank", "title", "expected", ...CRITERION_KEYS],
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
