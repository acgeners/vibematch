import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"

export type RankingColumnGroup = "basico" | "notas" | "criterios" | "legado"

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
  legado: "Legado",
}

// Bump v3 → v4 to hide chapters_read by default and add missing columns.
// Bump v4 → v5 to add the "Decisão" column (default sort) next to "Prevista".
export const RANKING_TABLE_COLUMN_CONFIG_STORAGE_KEY = "ranking_col_config_v5"
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
  { key: "ai_status", label: "IA", configLabel: "Status da avaliação IA", description: "Estágio da avaliação por IA: pendente de atributos, pendente de IA Rk, avaliado ou pulado.", defaultWidth: 80, align: "center", group: "basico" },
  { key: "updated_at", label: "Atual.", configLabel: "Atualizado em", description: "Quando o registro da obra foi atualizado pela última vez.", defaultWidth: 110, align: "center", group: "basico" },
  { key: "last_read_at", label: "Últ. leitura", configLabel: "Última leitura", description: "Data da última vez que você leu algum capítulo desta obra.", defaultWidth: 110, align: "center", group: "basico" },
  { key: "platform_avg", label: "N.M", configLabel: "Nota.M", description: "Nota.M — média ponderada das notas das plataformas externas (AniList, MAL, etc.), na escala 0–10. Pondera mais as fontes com mais votos.", defaultWidth: 88, align: "center", group: "notas" },
  { key: "total_votes", label: "Votos", configLabel: "Votos", description: "Total de votos/avaliações somados nas plataformas externas. Quanto maior, mais confiável é a Nota.M.", defaultWidth: 88, align: "center", group: "notas" },
  // Nota Final — combina Prevista + Alinhamento + IA Rk. num único número de
  // prioridade. É o sort default; ajuda a escolher entre obras com Prevista parecida.
  { key: "decision", label: "Nota Final", configLabel: "Nota Final", description: "Combina Nota Prevista, Alinhamento e IA Rk num único número de prioridade (0–10). Serve pra decidir o que ler primeiro entre obras com Prevista parecida — é um score de PRIORIDADE, não uma previsão de nota. Ordenação padrão do ranking.", defaultWidth: 100, align: "center", group: "notas" },
  // Novo (Fase 1.5): expected_score é o L1 que substitui o trio Nota.IA/Pr/Final
  { key: "expected", label: "Prevista", configLabel: "Nota Prevista", description: "Nota que o modelo prevê que você daria à obra (0–10). É a âncora calibrada do ranking — um Ridge L1 que substituiu o antigo trio Nota.IA / Nota.Pr / Nota.Final.", defaultWidth: 100, align: "center", group: "notas" },
  { key: "expected_baseline", label: "Perfil", configLabel: "Prevista — Perfil", description: "Decomposição da Nota Prevista (etapa 1): a parte vinda só do seu perfil de gosto, antes de considerar a qualidade da obra.", defaultWidth: 90, align: "center", group: "legado" },
  { key: "expected_quality_adj", label: "Δ Qual.", configLabel: "Prevista — Δ Qualidade", description: "Decomposição da Nota Prevista (etapa 2): o ajuste aplicado pelas 8 dimensões de qualidade sobre a parte do perfil.", defaultWidth: 90, align: "center", group: "legado" },
  { key: "personal_fit", label: "Alinh.", configLabel: "Alinhamento", description: "O quanto a obra combina com o seu perfil de gosto (fit_score). Quanto maior, mais alinhada às suas preferências de atributos e tags.", defaultWidth: 110, align: "center", group: "notas" },
  // Legado — escondidos por padrão a partir do v2. Disponíveis via column picker
  // ou via preset "Legado". Vão ser removidos quando Fase 2 (consultor) ativar.
  { key: "final", label: "N.Final", configLabel: "Nota.Final (legado)", description: "[Legado] Mistura ponderada de Nota.IA e Nota.Pr. Substituída pela Nota Prevista no cutover da Fase 1.5; mantida só por compatibilidade.", defaultWidth: 100, align: "center", group: "legado" },
  { key: "calc", label: "N.IA", configLabel: "Nota.IA (legado)", description: "[Legado] Nota calculada a partir da avaliação da IA (soma ponderada dos atributos). Substituída pela Nota Prevista.", defaultWidth: 100, align: "center", group: "legado" },
  { key: "pred", label: "N.Pr", configLabel: "Nota.Pr (legado)", description: "[Legado] Predição por regressão sobre notas manuais. Substituída pela Nota Prevista.", defaultWidth: 100, align: "center", group: "legado" },
  { key: "alignment_score", label: "IA Rk.", configLabel: "IA Rk", description: "Re-rank do consultor IA (0–100), gerado sob demanda. Reordena as recomendações ('Recomendar com IA', 'Próxima leitura', 'Recomendar do ranking') e alimenta a Nota Final. A maioria das obras fica sem valor até passar pelo Rankear.", defaultWidth: 80, align: "center", group: "notas" },
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
//   - expected_baseline / expected_quality_adj: detalhe da decomposição;
//     interessante pra debug mas polui a view padrão
//   - calc/pred/final: legado escondido após cutover da Fase 1.5
//     (acessível via column picker / preset "legado")
//   - alignment_score: NÃO está aqui — continua ativo no fluxo de
//     recomendação, fica visível por padrão em /ranking
const LEGACY_HIDDEN_KEYS = ["calc", "pred", "final"] as const
const DEFAULT_COLUMN_CONFIG: RankingColumnConfig = {
  order: DEFAULT_COLUMN_KEYS,
  hidden: [
    "pub",
    "per_status",
    "chapters_read",
    "chapters_progress",
    "expected_baseline",
    "expected_quality_adj",
    ...LEGACY_HIDDEN_KEYS,
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

export type RankingColumnPreset = "padrao" | "compacto" | "notas" | "criterios" | "legado"

export const RANKING_COLUMN_PRESETS: Array<{ id: RankingColumnPreset; label: string }> = [
  { id: "padrao", label: "Padrão" },
  { id: "compacto", label: "Compacto" },
  { id: "notas", label: "Foco em notas" },
  { id: "criterios", label: "Foco em atributos" },
  { id: "legado", label: "Legado (N.IA/Pr/Final)" },
]

const CRITERION_KEYS = CRITERION_SLUGS.map((slug) => `crit_${slug}`)

// `padrao` agora reflete o novo default (sem legado, sem decomposição):
//   tudo do DEFAULT exceto as colunas explicitamente escondidas.
const PADRAO_VISIBLE = DEFAULT_COLUMN_KEYS.filter(
  (k) => !DEFAULT_COLUMN_CONFIG.hidden.includes(k),
)

const PRESET_VISIBLE_KEYS: Record<RankingColumnPreset, string[]> = {
  padrao: PADRAO_VISIBLE,
  compacto: ["rank", "title", "pub", "per_status", "decision", "expected", "personal_fit"],
  notas: [
    "rank", "title",
    "decision",
    "expected", "expected_baseline", "expected_quality_adj",
    "personal_fit", "alignment_score", "platform_avg", "total_votes",
  ],
  criterios: ["rank", "title", "expected", ...CRITERION_KEYS],
  // Pra debug/comparação: mostra TUDO incluindo legado + decomposição.
  legado: DEFAULT_COLUMN_KEYS.filter((k) => k !== "chapters_progress"),
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
