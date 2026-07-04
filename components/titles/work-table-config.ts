import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"

export type WorkColumnGroup = "basico" | "notas" | "criterios"

export interface WorkColumnDef {
  key: string
  label: string
  configLabel?: string
  /** Texto explicativo exibido na tooltip do cabeçalho (abaixo do título). */
  description?: string
  align?: "left" | "right" | "center"
  locked?: boolean
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
}

export type WorkColumnNamespace = "titles" | "favorites" | "ranking" | "recommendations"
export const DEFAULT_WORK_COLUMN_NAMESPACE: WorkColumnNamespace = "titles"

// Versionamento per-namespace. Bump quando mudar NAMESPACE_HIDDEN do namespace
// pra que usuários existentes recebam os novos defaults sem precisar resetar.
//   - titles v4 → v5: oculta chapters_progress e ai_status do default
//   - favorites v4 → v5: oculta publication_status, ai_status, updated_at,
//     chapters_progress do default
//   - favorites v5 → v6: oculta também a coluna "fav" (redundante: tudo aqui
//     já é favorito)
//   - ranking, recommendations: sem mudança de default, mantêm v4
// favorites v7 → v8: adiciona a coluna "Prioridade" (decision) visível por padrão.
// Bump em todos os namespaces ao aposentar as colunas legado N.IA/Pr/Final
// (limpa configs salvos que referenciavam as colunas removidas).
// Bump em todos ao adicionar a coluna "Interesse IA (previsão)" (synopsis_pred)
// oculta por padrão — sem o bump, configs salvos a exibiriam vazia ("—").
// ranking v7 → v9: /ranking migrou do sistema próprio (ranking-table-config.ts,
// já removido) para este. Pulamos v8 de propósito: a chave gerada seria
// `ranking_col_config_v8`, IDÊNTICA à do sistema antigo — v9 garante clean slate.
const NAMESPACE_STORAGE_VERSION: Record<WorkColumnNamespace, string> = {
  titles: "v8",
  favorites: "v10",
  ranking: "v9",
  recommendations: "v6",
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
  { key: "fav", label: "Fav", configLabel: "Favorito", description: "Indica se a obra está marcada como favorita.", align: "center", group: "basico" },
  { key: "title", label: "Título", locked: true, group: "basico" },
  { key: "publication_status", label: "Pub.", configLabel: "Publicação", description: "Status de publicação da obra na fonte (em andamento, concluída, hiato, cancelada).", align: "center", group: "basico" },
  { key: "personal_status", label: "Status", configLabel: "Status pessoal", description: "Seu status de leitura para a obra (pra ler, lendo, concluída, etc.).", align: "center", group: "basico" },
  { key: "chapters_total", label: "Caps.", configLabel: "Capítulos totais", description: "Número total de capítulos da obra, quando conhecido.", align: "center", group: "basico" },
  { key: "chapters_read", label: "Lidos", configLabel: "Capítulos lidos", description: "Quantos capítulos você já marcou como lidos.", align: "center", group: "basico" },
  { key: "chapters_progress", label: "% Lido", configLabel: "% lido", description: "Progresso de leitura: capítulos lidos ÷ total de capítulos.", align: "center", group: "basico" },
  { key: "year", label: "Ano", description: "Ano de lançamento/início da publicação.", align: "center", group: "basico" },
  { key: "synopsis_q", label: "Sinopse", configLabel: "Interesse na sinopse", description: "O quanto a sinopse te interessou (♥ a ♥♥♥♥), informado na triagem/avaliação.", align: "center", group: "basico" },
  // Prioridade — âncora na Prevista (que já embute o Alinhamento calibrado) +
  // Veredito IA quando há. Default visível em /favorites; opcional nos demais namespaces.
  { key: "decision", label: "Prioridade", configLabel: "Prioridade", description: "Quão provável que você goste — número único pra decidir o que ler primeiro. Ancorado na Nota Prevista (que já embute o Alinhamento calibrado) e ajustado pelo Veredito IA quando existe. É um score de PRIORIDADE, não uma previsão de nota.", align: "center", group: "notas" },
  // Novo (Fase 1.5): expected_score é o L1 que substitui o trio N.IA/N.Pr/N.Final
  { key: "expected_score", label: "Prevista", configLabel: "Nota Prevista", description: "Nota que o modelo prevê que você daria à obra (0–10). É a âncora calibrada — um Ridge L1 que substituiu o antigo trio Nota.IA / Nota.Pr / Nota.Final.", align: "center", group: "notas" },
  { key: "personal_fit", label: "Alinh.", configLabel: "Alinhamento", description: "O quanto a obra combina com o seu perfil de gosto (fit_score). Quanto maior, mais alinhada às suas preferências de atributos e tags.", align: "center", group: "notas" },
  { key: "platform_avg", label: "N.M", configLabel: "Nota.M", description: "Nota.M — média ponderada das notas das plataformas externas (AniList, MAL, etc.), na escala 0–10. Pondera mais as fontes com mais votos.", align: "center", group: "notas" },
  { key: "total_votes", label: "Votos", configLabel: "Votos", description: "Total de votos/avaliações somados nas plataformas externas. Quanto maior, mais confiável é a Nota.M.", align: "center", group: "notas" },
  { key: "alignment_score", label: "Veredito", configLabel: "Veredito IA", description: "Re-rank do consultor IA (0–100), gerado sob demanda. Reordena as recomendações ('Recomendar com IA', 'Próxima leitura', 'Recomendar do ranking') e ajusta a Prioridade. A maioria das obras fica sem valor até passar pelo Rankear.", align: "center", group: "notas" },
  // Previsão de interesse na sinopse (Interesse IA). Dado só é mesclado em
  // /favorites (vem do getRanking); nas demais telas fica vazio ("—").
  { key: "synopsis_pred", label: "Prev. IA", configLabel: "Interesse IA (previsão)", description: "A previsão da IA de quanto a sinopse vai te interessar (♥ a ♥♥♥♥), com base no seu perfil de gosto. Diferente da coluna \"Sinopse\" (Interesse na sinopse), que é o valor que VOCÊ informou. Só preenchida em obras que passaram pela estimativa (feature Paga).", align: "center", group: "notas" },
  { key: "ai_status", label: "IA", configLabel: "Status da avaliação IA", description: "Estágio da avaliação por IA: pendente de atributos, pendente de Veredito IA, avaliado ou pulado.", align: "center", group: "basico" },
  { key: "updated_at", label: "Atual.", configLabel: "Atualizado em", description: "Quando o registro da obra foi atualizado pela última vez.", align: "center", group: "basico" },
  { key: "last_read_at", label: "Últ. leitura", configLabel: "Última leitura", description: "Data da última vez que você leu algum capítulo desta obra.", align: "center", group: "basico" },
  ...CRITERION_SLUGS.map((slug) => ({
    key: `crit_${slug}`,
    label: CRITERIA_INFO[slug]?.emoji ?? slug,
    configLabel: `${CRITERIA_INFO[slug]?.emoji ?? ""} ${CRITERIA_INFO[slug]?.name ?? slug}`.trim(),
    align: "center" as const,
    group: "criterios" as const,
  })),
  { key: "actions", label: "", align: "center", locked: true, group: "basico" },
]

const DEFAULT_COLUMN_KEYS = WORK_TABLE_COLUMNS.map((column) => column.key)

// Per-namespace defaults: /titles foca em geral; /favorites foca em granular.
// Legacy: N.IA/N.Pr/N.Final ficam escondidos por padrão em TODOS os namespaces
// após cutover Fase 1.5. (As colunas decompostas Perfil/Δ Qualidade foram
// REMOVIDAS no §6 Bloco 2 — arquitetura 2-stage aposentada.)
// Veredito IA. saiu do bucket legacy — continua ativo no fluxo de recomendação
// e é exibido por default em /ranking e /recommendations.
const LEGACY_HIDDEN = [
  "calc_score",
  "predicted_score",
  "final_score",
] as const

const NAMESPACE_HIDDEN: Record<WorkColumnNamespace, string[]> = {
  // Visão geral (filosofia: ENXUTA). Catálogo de gerenciamento — foco em
  // status, capítulos e Esperada. ai_status saiu do default (já há filtro
  // dedicado por ai_eval_status); chapters_progress sai por redundância com
  // chapters_read+total.
  titles: [
    "fav",
    "decision",
    "chapters_read",
    "personal_fit",
    "synopsis_pred",
    "ai_status",
    "updated_at",
    "last_read_at",
    ...LEGACY_HIDDEN,
    ...CRITERION_SLUGS.map((slug) => `crit_${slug}`),
  ],
  // Favoritos (filosofia: RICA — deep dive). Critérios visíveis; metadados
  // como publication_status, ai_status e updated_at saem do default por serem
  // pouco relevantes em obras já favoritadas.
  favorites: [
    "fav",
    "personal_status",
    "chapters_read",
    "chapters_progress",
    "synopsis_pred",
    "ai_status",
    "updated_at",
    "last_read_at",
    ...LEGACY_HIDDEN,
  ],
  // Ranking: foco em comparar notas; sinopse, ano e ai_status fora; critérios visíveis.
  // Veredito IA. visível — quem chega aqui geralmente quer ver o re-rank IA.
  ranking: [
    "decision",
    "publication_status",
    "personal_status",
    "chapters_read",
    "chapters_progress",
    "synopsis_pred",
    "ai_status",
    "updated_at",
    "last_read_at",
    ...LEGACY_HIDDEN,
  ],
  // Recomendações: 9 critérios em destaque; resto enxuto.
  // Veredito IA. visível — É a nota que ORDENA o próprio resultado da run.
  recommendations: [
    "decision",
    "synopsis_q",
    "synopsis_pred",
    "year",
    "ai_status",
    "chapters_read",
    "chapters_progress",
    "total_votes",
    "updated_at",
    "last_read_at",
    ...LEGACY_HIDDEN,
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
  // `rank` só existe no /ranking (coluna "#" estrutural, prependada pelo
  // RankingTable — não é uma coluna selecionável do picker). Fica aqui só para
  // o RankingTable achar a largura padrão via este mapa compartilhado.
  rank: 48,
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
  decision: 90,
  expected_score: 90,
  personal_fit: 64,
  calc_score: 80,
  predicted_score: 80,
  final_score: 90,
  platform_avg: 80,
  total_votes: 70,
  alignment_score: 70,
  synopsis_pred: 110,
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
//   - `personal_fit` (Alinhamento — percentil 0-100, célula própria)
//   - `total_votes` (count sem color coding — formatado como 1.5k/50k)
//   - `synopsis_q` (string de corações ♥-♥♥♥♥ pra interesse na sinopse informado)
//   - `synopsis_pred` (Interesse IA — previsão ♥-♥♥♥♥; dado só em /favorites)
const SCORE_COLUMN_KEYS = new Set<string>([
  "expected_score",
  "personal_fit",
  "platform_avg",
  "total_votes",
  "alignment_score",
  "synopsis_q",
  "synopsis_pred",
  ...CRITERION_SLUGS.map((slug) => `crit_${slug}`),
])

export function isScoreColumn(key: string): boolean {
  return SCORE_COLUMN_KEYS.has(key)
}

export type WorkColumnPreset = "tudo" | "compacto" | "geral" | "notas" | "criterios"

export const WORK_COLUMN_PRESETS: Array<{ id: WorkColumnPreset; label: string }> = [
  { id: "tudo", label: "Tudo" },
  { id: "compacto", label: "Compacto" },
  { id: "geral", label: "Geral" },
  { id: "notas", label: "Notas" },
  { id: "criterios", label: "Atributos" },
]

// "tudo" e "compacto" são presets de conjunto EXATO (clicar substitui as colunas
// visíveis). "geral"/"notas"/"criterios" são toggles ADITIVOS por grupo (a união
// dos grupos ativos). Ver EXACT_SET_PRESETS + o handler do WorkColumnPicker.
export const EXACT_SET_PRESETS = new Set<WorkColumnPreset>(["tudo", "compacto"])

const PRESET_VISIBLE_KEYS: Record<WorkColumnPreset, string[]> = {
  tudo: WORK_TABLE_COLUMNS.filter((c) => !c.locked).map((c) => c.key),
  // Visão enxuta herdada do /ranking: status + as duas notas-âncora. `title` é
  // locked (sempre visível), então não precisa ser listado.
  compacto: ["publication_status", "personal_status", "expected_score", "personal_fit"],
  geral: WORK_TABLE_COLUMNS.filter((c) => !c.locked && c.group === "basico").map((c) => c.key),
  notas: WORK_TABLE_COLUMNS.filter((c) => !c.locked && c.group === "notas").map((c) => c.key),
  criterios: WORK_TABLE_COLUMNS.filter((c) => !c.locked && c.group === "criterios").map((c) => c.key),
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

// True quando `config` é IDÊNTICO ao default do namespace (estado inicial / após
// "Padrão"). Usado pra NÃO marcar nenhum preset na visualização padrão: o default
// é um recorte curado próprio, não um preset — mesmo que por acaso deixe um grupo
// inteiro visível (ex.: critérios), acender "Atributos" ali seria enganoso.
// Normaliza os dois lados porque o default cru carrega chaves legadas (calc_score
// etc.) que a normalização descarta.
export function isDefaultWorkColumnConfig(
  config: WorkColumnConfig,
  namespace: WorkColumnNamespace = DEFAULT_WORK_COLUMN_NAMESPACE,
): boolean {
  const a = normalizeWorkColumnConfig(config)
  const b = normalizeWorkColumnConfig(getDefaultWorkColumnConfig(namespace))
  if (a.order.length !== b.order.length) return false
  for (let i = 0; i < a.order.length; i++) {
    if (a.order[i] !== b.order[i]) return false
  }
  if (a.hidden.length !== b.hidden.length) return false
  const aHidden = new Set(a.hidden)
  return b.hidden.every((key) => aHidden.has(key))
}

// Um preset por GRUPO está "ativo" quando todas as colunas que ele exporia estão
// visíveis (modelo aditivo). Um preset de conjunto EXATO (tudo/compacto) só está
// ativo quando o conjunto visível é EXATAMENTE o dele — senão "Compacto" acenderia
// junto de "Tudo" (que também expõe as colunas dele).
export function getActivePresetSet(config: WorkColumnConfig): Set<WorkColumnPreset> {
  const normalized = normalizeWorkColumnConfig(config)
  const hiddenSet = new Set(normalized.hidden)
  const active = new Set<WorkColumnPreset>()
  for (const preset of WORK_COLUMN_PRESETS) {
    const keys = PRESET_VISIBLE_KEYS[preset.id]
    if (keys.length === 0) continue
    if (EXACT_SET_PRESETS.has(preset.id)) {
      const expected = new Set(getPresetConfig(preset.id).hidden)
      if (
        expected.size === hiddenSet.size &&
        [...expected].every((key) => hiddenSet.has(key))
      ) {
        active.add(preset.id)
      }
      continue
    }
    if (keys.every((key) => !hiddenSet.has(key))) active.add(preset.id)
  }
  return active
}
