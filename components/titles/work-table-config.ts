import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { LABELS } from "@/lib/constants/ui-labels"
import { CRITERION_SLUGS } from "@/types/domain"

export type WorkColumnGroup = "basico" | "notas" | "criterios"

export interface WorkColumnDef {
  key: string
  label: string
  configLabel?: string
  /**
   * As 3 formas do cabeçalho (full → short → abbrev) para coluna que NÃO tem linha em
   * `ui_labels`. Sem elas o cabeçalho cai no rótulo estático, que é desenhado por outro
   * caminho e sai com tipografia diferente da dos vizinhos — medido na tela: "Real" em
   * caixa mista no meio de "N. PREV." e "N. EXT." em caixa alta.
   * ⚠️ O LABELS (gerado do banco) VENCE isto: no dia em que a coluna ganhar linha em
   * `ui_labels`, ela passa a mandar sozinha e este campo vira o valor morto que deve sair.
   */
  headerForms?: { full: string; short: string; abbrev: string }
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
// Bump em TODOS ao adicionar a coluna "O que a separa" (separator), visível por
// padrão só em /ranking. Sem o bump ela sairia VISÍVEL para quem já tem config
// salvo em qualquer namespace: `normalizeWorkColumnConfig` acrescenta coluna nova
// ao fim do `order`, e o `hidden` gravado obviamente não a menciona — mesmo modo
// de falha que a `synopsis_pred` teve, e nas outras telas ela ficaria só vazia.
// Bump em favorites/ranking/recommendations ao adicionar a coluna "Minha nota (Real)"
// (user_score), que nasce OCULTA nos três. `titles` NÃO é bumpado de propósito: lá ela é
// visível por padrão, e é justamente isso que dispensa o bump — config salvo não menciona
// coluna nova no `hidden`, então ela já apareceria. Bumpar ali só descartaria a ordem e as
// larguras que a pessoa ajustou, em troca de nada.
// Bump em titles/ranking/recommendations ao adicionar a coluna "Grupos de favoritos", que
// nasce OCULTA nos três — sem o bump, config salvo (que obviamente não a menciona no
// `hidden`) a exibiria, e ali ela sairia vazia em toda linha: só /favorites passa
// `groupsByWorkId`. `favorites` NÃO é bumpado de propósito, pelo mesmo motivo que o
// `user_score` não bumpou `titles`: lá ela nasce VISÍVEL, então config salvo já a mostra, e
// bumpar só jogaria fora a ordem e as larguras que a pessoa ajustou.
const NAMESPACE_STORAGE_VERSION: Record<WorkColumnNamespace, string> = {
  titles: "v10",
  favorites: "v12",
  ranking: "v12",
  recommendations: "v9",
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
  { key: "fav", label: LABELS.fav.abbrev, configLabel: LABELS.fav.full, description: LABELS.fav.tooltip_full, align: "center", group: "basico" },
  { key: "title", label: LABELS.title.abbrev, locked: true, group: "basico" },
  { key: "publication_status", label: LABELS.publication_status.abbrev, configLabel: LABELS.publication_status.short, description: LABELS.publication_status.tooltip_full, align: "center", group: "basico" },
  { key: "personal_status", label: LABELS.personal_status.abbrev, configLabel: LABELS.personal_status.full, description: LABELS.personal_status.tooltip_full, align: "center", group: "basico" },
  // Recorrência: em quantos grupos de favoritos a obra está. Fica entre as colunas "suas"
  // (favorito, status pessoal) porque é organização, não nota — e é NÚMERO, nunca chip
  // aceso: 36% das favoritas estão em 2+ grupos, e destaque em 1 de cada 3 linhas é o
  // alarme que ninguém lê. Só tem dado em /favorites, que é quem passa `groupsByWorkId`.
  // Rótulo literal (como `separator` e `user_score`): sem linha em `ui_labels`.
  {
    key: "groups",
    label: "Grupos",
    headerForms: { full: "Grupos de favoritos", short: "Grupos", abbrev: "GRP" },
    configLabel: "Grupos de favoritos",
    description:
      "Em quantos dos seus grupos de favoritos esta obra aparece. Passe o mouse para ver quais. Serve de desempate: entre obras de mesma Nota Prevista, é o sinal de que você já a fichou em mais de um recorte.",
    align: "center",
    group: "basico",
  },
  { key: "chapters_total", label: LABELS.chapters_total.abbrev, configLabel: LABELS.chapters_total.full, description: LABELS.chapters_total.tooltip_full, align: "center", group: "basico" },
  { key: "chapters_read", label: LABELS.chapters_read.abbrev, configLabel: LABELS.chapters_read.full, description: LABELS.chapters_read.tooltip_full, align: "center", group: "basico" },
  { key: "chapters_progress", label: LABELS.chapters_progress.abbrev, configLabel: LABELS.chapters_progress.short, description: LABELS.chapters_progress.tooltip_full, align: "center", group: "basico" },
  { key: "year", label: LABELS.year.abbrev, description: LABELS.year.tooltip_full, align: "center", group: "basico" },
  { key: "synopsis_q", label: LABELS.synopsis_q.abbrev, configLabel: LABELS.synopsis_q.full, description: LABELS.synopsis_q.tooltip_full, align: "center", group: "basico" },
  // Prioridade — âncora na Prevista (que já embute o Alinhamento calibrado) +
  // Veredito IA quando há. Default visível em /favorites; opcional nos demais namespaces.
  { key: "decision", label: LABELS.decision.short, configLabel: LABELS.decision.short, description: LABELS.decision.tooltip_full, align: "center", group: "notas" },
  // Arte — PERCENTIL, nunca a estimativa em pontos (comprimida a ~0,49× a escala do
  // rótulo, então um número em pontos convida à comparação errada com uma nota de
  // critério). Entrou nas listas em 2026-08-15 porque é um dos separadores mais fortes
  // entre obras empatadas: medido, separa 79,8% dos pares dentro dos grupos de mesma
  // Prioridade exibida, com 97,5% de cobertura. Vivia só na página da obra — ou seja,
  // exatamente onde não ajuda a ESCOLHER entre várias.
  { key: "art", label: "Arte", configLabel: "Arte (percentil)", description: "Posição da estimativa de arte no catálogo (0–100). É estimativa: a escala é comprimida e a precisão no topo é ~55%, então serve pra comparar obras entre si, não como nota. Vazia quando não há estimativa.", align: "center", group: "notas" },
  // Novo (Fase 1.5): expected_score é o L1 que substitui o trio N.IA/N.Pr/N.Final
  { key: "expected_score", label: LABELS.expected_score.short, configLabel: LABELS.expected_score.full, description: LABELS.expected_score.tooltip_full, align: "center", group: "notas" },
  // Sua nota (user_score), vinda do espelho de QUEM OLHA (`user_work_state`, via
  // `withPersonalState`) — não da linha compartilhada de `works`. Fica logo ao lado da
  // Prevista de propósito: é o par "Prevista / Real" que a prévia de hover e o cabeçalho
  // da obra já mostram juntos, e é o RÓTULO com que o Ridge da Prevista foi treinado.
  // Rótulo literal (como `separator`): não tem linha em `ui_labels`, então o cabeçalho
  // não troca full→short→abbrev por largura; se um dia tiver, migra pra LABELS.
  // ⚠️ Vazia em quem você ainda não avaliou: 211 de 988 obras (21,4%) tinham nota em
  // 2026-08-14 — por isso ela nasce OCULTA fora de /catalog (em /favorites são 7 de 126).
  {
    key: "user_score",
    label: "Real",
    headerForms: { full: "Minha nota (Real)", short: "Minha nota", abbrev: "Real" },
    configLabel: "Minha nota (Real)",
    description:
      "A nota que VOCÊ deu à obra, depois de ler — o rótulo com que a Nota Prevista é treinada. Fica vazia enquanto você não avaliar.",
    align: "center",
    group: "notas",
  },
  { key: "personal_fit", label: LABELS.personal_fit.abbrev, configLabel: LABELS.personal_fit.full, description: LABELS.personal_fit.tooltip_full, align: "center", group: "notas" },
  { key: "platform_avg", label: LABELS.platform_avg.abbrev, configLabel: LABELS.platform_avg.short, description: LABELS.platform_avg.tooltip_full, align: "center", group: "notas" },
  { key: "total_votes", label: LABELS.total_votes.short, configLabel: LABELS.total_votes.short, description: LABELS.total_votes.tooltip_full, align: "center", group: "notas" },
  { key: "alignment_score", label: LABELS.alignment_score.short, configLabel: LABELS.alignment_score.full, description: LABELS.alignment_score.tooltip_full, align: "center", group: "notas" },
  // Previsão de interesse na sinopse (Interesse IA). Dado só é mesclado em
  // /favorites (vem do getRanking); nas demais telas fica vazio ("—").
  { key: "synopsis_pred", label: LABELS.synopsis_pred.abbrev, configLabel: LABELS.synopsis_pred.full, description: LABELS.synopsis_pred.tooltip_full, align: "center", group: "notas" },
  // Herdada da view Faixas, que foi absorvida pela Lista agrupada. Mede o desvio
  // da obra contra as empatadas DO PRÓPRIO TIER, então só é renderizada com o
  // "Agrupar" ligado — sem tier não há grupo a que se referir. Ver `whyThisWork`.
  // Rótulo literal (como `RANK_COL`): não tem linha em `ui_labels`; se um dia
  // tiver, migra pra LABELS como as demais.
  {
    key: "separator",
    label: "O que a separa",
    configLabel: "O que a separa das outras",
    description:
      "A força que mais distancia esta obra das outras do mesmo tier, em desvios-padrão. Fica em branco quando nada passa de 1σ. Só aparece com o Agrupar ligado.",
    group: "notas",
  },
  { key: "ai_status", label: LABELS.ai_status.abbrev, configLabel: LABELS.ai_status.full, description: LABELS.ai_status.tooltip_full, align: "center", group: "basico" },
  { key: "updated_at", label: LABELS.updated_at.abbrev, configLabel: LABELS.updated_at.full, description: LABELS.updated_at.tooltip_full, align: "center", group: "basico" },
  { key: "last_read_at", label: LABELS.last_read_at.abbrev, configLabel: LABELS.last_read_at.full, description: LABELS.last_read_at.tooltip_full, align: "center", group: "basico" },
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

// Per-namespace defaults: /catalog foca em geral; /favorites foca em granular.
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
    // Só /favorites carrega a associação obra↔grupo; aqui sairia "—" em toda linha.
    "groups",
    "separator",
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
    "separator",
    "fav",
    // Medido em 2026-08-14: só 7 das 126 favoritas (5,6%) têm nota — a coluna viria
    // vazia em 19 de cada 20 linhas justamente na tela mais densa.
    "user_score",
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
    // Só /favorites carrega a associação obra↔grupo; aqui sairia "—" em toda linha.
    "groups",
    "decision",
    "user_score",
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
    // Só /favorites carrega a associação obra↔grupo; aqui sairia "—" em toda linha.
    "groups",
    "separator",
    "decision",
    // Recomendação é sobre o que você AINDA NÃO leu — a coluna seria vazia por desenho.
    "user_score",
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
  // 53 e não 44: o coração vem com o contorno do botão, e medido em 19/08/2026 na tela real
  // ele pede 52px. É o mesmo valor que `TIER_MODE_COLUMN_WIDTHS` já declara — os dois mapas
  // descrevem a MESMA célula, e divergiam em 9px.
  fav: 53,
  title: 360,
  publication_status: 130,
  personal_status: 110,
  groups: 76,
  chapters_total: 70,
  chapters_read: 70,
  chapters_progress: 80,
  year: 70,
  synopsis_q: 90,
  decision: 90,
  expected_score: 90,
  user_score: 80,
  personal_fit: 64,
  calc_score: 80,
  predicted_score: 80,
  final_score: 90,
  platform_avg: 80,
  // 80 e não 70: o conteúdo é "33,4K" (5 glifos, ~40px) e 70 só serve com a tabela em fator
  // ~1. Em qualquer tabela densa — inclusive no modo Agrupar, fator 0,85 — ele virava "33,…",
  // e esta é uma das duas forças que o separador compara.
  total_votes: 80,
  // 🔴 100 e não 70, e o que decide NÃO é a pílula (que pede 83) — é o botão **"Rankear"**,
  // que aparece nas obras SEM Veredito, ou seja a maioria da lista. Medido em 19/08/2026,
  // logada, na tela real: a célula pede **99,9px**. Com 70 o Veredito saía cortado em
  // **40/40 linhas do /ranking e 50/50 do /catalog** — a coluna da decisão, ilegível em toda
  // linha, sem corte visível, sem rolagem e sem erro. É o valor que `TIER_MODE_COLUMN_WIDTHS`
  // já declarava; o mapa global tinha ficado para trás.
  alignment_score: 100,
  synopsis_pred: 110,
  // Arte é um percentil de 2 dígitos: 70 é a largura das outras colunas numéricas. Estava sem
  // entrada e herdava o fallback de 100 — 30px a mais que nunca foram escolhidos, e que no
  // modo Agrupar saem da conta do separador.
  art: 70,
  // 🔴 Esta linha FALTAVA, e a coluna caía no fallback `?? 100` — largura menor que a trilha
  // + o ícone (144px medidos), então a FRASE ("8,8 a mais alta do grupo +1,2σ"), que é o
  // conteúdo da coluna, tinha −44px para caber e nunca era desenhada. O título também
  // truncava ("O QU…", precisa de 127px). Medido no browser em 17/08/2026: célula típica
  // 292px, pior caso 335px.
  // ⚠️ **Esta entrada não está em vigor em lugar nenhum, e é de propósito que ela fique.** A
  // coluna só é renderizada no modo Agrupar, e lá quem manda é `TIER_MODE_COLUMN_WIDTHS` (294,
  // medido). O valor aqui é a rede para o dia em que ela for usada fora do modo — sem a linha,
  // ela cairia no `?? 100` invisível que é o assunto do `coluna-declara-largura.test.ts`.
  separator: 355,
  ai_status: 80,
  updated_at: 110,
  last_read_at: 110,
  actions: 60,
  // 🔴 Os 9 critérios herdavam o `?? 100` — e aqui ele não deixava a coluna ESTREITA, deixava
  // as outras. Medido em 19/08/2026 no /ranking com as colunas padrão: cada um pede **24,4px**
  // (32,8 no 🔥, que carrega o 18+) e recebia 69,5 — servidos a **285%**. Somados, os nove
  // reivindicavam **900px de um orçamento de 2.076px (43%)**, e como a tabela é proporcional
  // sem piso, quem pagava eram Ano, Votos, Veredito e o Título.
  //
  // 48 é o valor que `work-table.tsx` já usava no PRÓPRIO fallback dele
  // (`?? (key.startsWith("crit_") ? 48 : 100)`) — os dois fallbacks descreviam a mesma célula
  // e discordavam, e o `/ranking` era o lado sem a exceção. Declarar aqui faz nenhum dos dois
  // importar.
  //
  // Derivado de `CRITERION_SLUGS` pelo mesmo motivo que `WORK_TABLE_COLUMNS` deriva: critério
  // novo no Supabase nasce com largura, não no fallback invisível.
  ...Object.fromEntries(CRITERION_SLUGS.map((slug) => [`crit_${slug}`, 48])),
}

/**
 * As colunas do MODO AGRUPAR da Lista (`/ranking` com tiers na tela).
 *
 * 🔴 **É uma trava de ORÇAMENTO, e o número é medido.** A tabela é `table-layout: fixed`,
 * proporcional e sem rolagem horizontal: cada coluna recebe `natural ÷ soma × largura`. Com as
 * 26 colunas que o seletor permite ligar, a soma é **3.066px** para ~1.500px de tela — **fator
 * 0,49**, ou seja *toda* coluna sai pela metade (Ano recebe 34px e vira "2…", Publicação 64px e
 * vira "✅ Cl"). Não é a coluna "O que a separa" que não cabe; é que **nenhuma cabe**, e ela só
 * torna o sintoma visível por ser a de maior conteúdo.
 *
 * 🔴 **A régua de quem entra: responde "destas empatadas, qual eu escolho?".** Ligar o Agrupar
 * troca a PERGUNTA da tela — de "meu catálogo em N colunas" para a escolha dentro de um tier.
 * Entram o eixo do tier (`decision`), o separador, o estado da obra (publicação, capítulos, ano,
 * arte), as notas que sustentam a escolha, e as **forças** que o separador compara
 * (`why-this-work.ts`: avaliação = `platform_avg` · alcance = `total_votes`).
 *
 * 🔴 **O status é o de PUBLICAÇÃO, não o seu** (escolha da Ana, 17/08/2026). Aqui a coluna
 * responde "dá pra começar agora?" — concluída · em andamento · hiato · cancelada —, que é o
 * mesmo eixo que o refino por mood pontua em `startabilityOf` e que a rodada de escolha dentro
 * do tier de fato usa. O `personal_status` que estava no lugar entrava `iconOnly` e é
 * quase-constante por CONSTRUÇÃO neste modo: o filtro padrão do `/ranking` já recorta a lista
 * em Untracked + Want to Read (`BASELINE_PERSONAL_STATUSES`), então a coluna gastava uma share
 * do orçamento para repetir "—" linha após linha.
 *
 * ⚠️ Ele custa **20px a mais** de largura natural que o `personal_status`, e essa conta hoje é
 * feita em `TIER_MODE_COLUMN_WIDTHS`, onde a coluna vale os **92px** que a pílula "⏸️ HIA »"
 * de fato pede — medidos, não herdados do mapa global.
 *
 * ⚠️ **Não existe coluna para a força "chance"** — ela só aparece na Bússola. Por isso o
 * conjunto tem 2 das 3 forças, e não 3: inventar uma coluna aqui seria criar dado novo dentro
 * de uma decisão de largura.
 *
 * 🔴 **`decision` e `expected_score` NÃO são redundantes, e a intuição erra o lado.** Dentro de
 * um tier o campo ORDENADO é o constante — os tiers são construídos por `displayTierKey` sobre
 * ele —, e o outro é justamente o que varia. Ordenando por Prioridade, ela sai "~8,5 ~8,5 ~8,5"
 * (o rótulo do divisor já diz isso) e quem separa as linhas é a Nota Prevista; ordenando por
 * Prevista, é o contrário. Tirar qualquer um dos dois apaga informação em metade das
 * ordenações.
 *
 * 🔴 **O ORÇAMENTO é a restrição, e quem o declara é `TIER_MODE_COLUMN_WIDTHS`** (logo abaixo),
 * cuja soma é exatamente a largura medida da tabela: cada coluna recebe na tela o número
 * escrito lá. O conjunto fecha com **11px de folga** sobre o que as células pedem, e é isso que
 * `tests/unit/ranking/modo-agrupar-colunas.test.ts` guarda — coluna nova aqui obriga a tirar
 * px de alguém, e o teste diz de quem sobrou.
 *
 * ⚠️ **A escolha do usuário não é apagada.** O modo IGNORA a config enquanto está ligado;
 * desligar o Agrupar devolve as colunas dele intactas (nada é gravado). Por isso o seletor
 * aparece DESABILITADO com a explicação, em vez de sumir — sumir faria a pessoa procurar um
 * controle que existe.
 */
export const TIER_MODE_COLUMN_KEYS = [
  // identidade
  "fav",
  "title",
  // o que a obra é — inclusive se dá para começá-la agora
  "publication_status",
  "chapters_total",
  "year",
  "art",
  // a decisão: o eixo do tier, e o que separa quem empatou nele
  "decision",
  "separator",
  // as notas que sustentam a escolha
  "expected_score",
  "synopsis_q",
  "synopsis_pred",
  "alignment_score",
  // as duas forças que o separador compara (a terceira, chance, não tem coluna)
  "platform_avg",
  "total_votes",
] as const

/**
 * A largura que a TABELA de fato recebe, medida no browser — e a régua deste modo.
 *
 * 🔴 **Toda largura daqui já foi calibrada contra "1.500px de container", e a tabela nunca
 * recebe isso.** Medido em 17/08/2026 com o app rodando: a **1500px de viewport a tabela mede
 * 1.442px** (o resto é o padding da página), e ela tem um **TETO de 1.502px** — a partir de
 * ~1.760px de janela o container para de crescer, então monitor maior não compra coluna. O
 * fator real a 1500 é **0,80**, não os 0,83 que a conta antiga usava.
 *
 * 🔴 **Os 24px de `px-3` do `<td>` também ficavam de fora da conta.** Somados, os dois erros
 * escondiam QUATRO truncamentos silenciosos na tela de 1500px — Ano em "20…", Votos em "33,…",
 * a pílula do Veredito cortada ao meio e a frase do separador nunca desenhada —, e o teste
 * aprovava todos, porque media contra um container que a página não tem.
 */
export const TIER_MODE_TABLE_WIDTH = 1442

/**
 * As larguras do MODO AGRUPAR, em px na largura de referência acima.
 *
 * 🔴 **A soma é exatamente `TIER_MODE_TABLE_WIDTH`, e isso é o que dá sentido aos números.**
 * A largura vira share (`natural ÷ soma × container`), então com a soma igual à tabela cada
 * coluna recebe na tela **exatamente** o número escrito aqui. Deixa de ser "um peso" e passa a
 * ser o pedido medido daquela célula.
 *
 * 🔴 **O mapa é PRÓPRIO porque o `DEFAULT_COLUMN_WIDTHS` é global.** Para dar ao separador os
 * 294px de que ele precisa era necessário tirar do `title`, que é o mesmo 360 do `/catalog` —
 * o modo estaria pagando a conta dele com a largura de outra tela. Aqui ele paga com a própria.
 *
 * **Como cada número foi obtido** (medido no browser, 40 linhas, filtro de publicação aberto):
 * clonando cada `<td>` num contêiner `width: max-content`. Medir no lugar não serve — a tabela
 * é `table-layout: fixed` com `overflow:hidden`, então o que se lê ali é a largura CONCEDIDA,
 * nunca a PEDIDA. Todo valor já inclui os 24px de padding do `td`.
 *
 * 🔴 **Todo valor é o teto ARREDONDADO PRA CIMA, e o sub-pixel não é preciosismo.** A 1ª
 * rodada usou o medido arredondado ao inteiro mais próximo, e `Caps.` pedia **49,2px** com
 * 49,0 concedidos: o `text-overflow` do navegador dispara em QUALQUER estouro, então 0,2px
 * viraram "2…" numa coluna de três dígitos. O mesmo em Arte e Média externa. Ao mexer aqui,
 * arredonde para cima e confira na tela — a diferença entre caber e truncar é décimo de pixel.
 *
 * Três não saem de `max-content`, e cada um tem motivo:
 * - `separator` = **294** — o degrau do container query da célula (270px de conteúdo) + 24. Um
 *   clone mede 24px ali, porque a barra é `absolute` e o `@container` não resolve fora da
 *   árvore; medir o pedido dela pelo clone daria "cabe em qualquer lugar".
 * - `title` = a SOBRA (**255**). Ele é o único que degrada bem — reticências num nome são
 *   esperadas —, então é ele que absorve o que resta depois de todo o resto receber o pedido.
 * - `total_votes` = **75** e não os 66 medidos: o pior caso da TELA era "16,2K", e o do
 *   CATÁLOGO é 193.712 votos ⇒ "193,7K". Coluna de número dimensionada pela amostra visível
 *   trunca no dia em que a obra popular aparece.
 *
 * ⚠️ **O orçamento fecha, mas sem folga: o título ficou em 255px e a mediana dele pede 275.**
 * Ou seja, mais da metade dos nomes trunca — o modo é ~20px curto para caber tudo com o
 * título inteiro. Os dois candidatos a ceder, se um dia isso incomodar, estão MEDIDOS: o
 * botão "Rankear" (−14px, virando ícone) e a frase do separador (−24px, voltando ao degrau
 * de 270). Nenhum dos dois foi feito porque os dois trocam um defeito visível por outro.
 *
 * ⚠️ **`alignment_score` = 100 é o botão "Rankear"**, não a pílula (que pede 83). Ele aparece
 * nas obras sem Veredito, que são a maioria desta lista, e botão cortado lê como quebrado. É a
 * maior peça isolada do orçamento depois do separador: virá-lo em ícone devolveria ~17px ao
 * título — decisão de UI, não de largura, e por isso não foi feita aqui.
 *
 * ⚠️ Abaixo de ~1.442px de tabela tudo encolhe junto e as células voltam a truncar. Isso é
 * degradação escolhida, não conserto pela metade: quem cede primeiro é a escada de degraus que
 * `SeparatorCell` já tem (sai a frase, depois o σ). O que este mapa garante é que **na largura
 * de referência nada é cortado**.
 */
export const TIER_MODE_COLUMN_WIDTHS: Record<string, number> = {
  select: 41,
  rank: 41,
  fav: 53,
  title: 255,
  publication_status: 92,
  chapters_total: 50,
  year: 58,
  art: 50,
  decision: 62,
  separator: 294,
  expected_score: 58,
  synopsis_q: 73,
  synopsis_pred: 90,
  alignment_score: 100,
  platform_avg: 50,
  total_votes: 75,
}

/**
 * As defs do modo Agrupar, na ordem declarada. Derivado de `WORK_TABLE_COLUMNS`, nunca uma 2ª
 * definição das colunas — chave que não existir some daqui em silêncio, e é isso que o teste
 * `tests/unit/ranking/modo-agrupar-colunas.test.ts` reprova.
 */
export function getTierModeColumns(): WorkColumnDef[] {
  const byKey = new Map(WORK_TABLE_COLUMNS.map((c) => [c.key, c]))
  return TIER_MODE_COLUMN_KEYS.map((k) => byKey.get(k)).filter((c): c is WorkColumnDef => Boolean(c))
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
//   - notas 0-10 com color coding (final, calc, predicted, expected, user_score, criterios)
//   - `personal_fit` (Alinhamento — percentil 0-100, célula própria)
//   - `total_votes` (count sem color coding — formatado como 1.5k/50k)
//   - `synopsis_q` (string de corações ♥-♥♥♥♥ pra interesse na sinopse informado)
//   - `synopsis_pred` (Interesse IA — previsão ♥-♥♥♥♥; dado só em /favorites)
const SCORE_COLUMN_KEYS = new Set<string>([
  "expected_score",
  "user_score",
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
