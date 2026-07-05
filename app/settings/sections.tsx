import {
  BookOpen,
  Brain,
  Database,
  FileText,
  Gauge,
  MessageSquareText,
  Sparkles,
  Tags,
  Wand2,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { SettingsAccent } from "@/lib/settings-accent"

// Registry das seções do console /settings — modelo "tópico → pilha".
// A camada 2 (sub-nav) lista os GRUPOS; clicar num grupo empilha os cards dos
// seus itens no conteúdo. Um accent por grupo (cor = hierarquia, não decoração).
// A metadata de navegação sai daqui; o CORPO de cada card vive em page.tsx.

export type SettingsChip =
  | { kind: "step"; label: string }
  | { kind: "cadence"; label: string }
  | { kind: "cost"; tier: "free" | "low" | "high"; label: string }

export interface SettingsSection {
  id: string
  /** Título curto (card + busca). */
  title: string
  /** Título (mais descritivo) do cabeçalho do card. Cai pro `title` se ausente. */
  panelTitle?: string
  /** Frase curta, sempre visível no card. */
  description: string
  /** Explicação longa — mostrada no popover do ⓘ / ao clicar no título. */
  help: string
  icon: LucideIcon
  chips?: SettingsChip[]
  /** Ferramenta pesada: card mostra resumo; conteúdo completo abre num "expandir"
   *  inline (?open=<id>), sem navegar pra outra página. */
  collapsible?: boolean
}

export interface SettingsGroup {
  /** Slug do grupo — vira o `?g=` e o alvo da sub-nav. */
  id: string
  label: string
  /** Frase curta ao lado do rótulo. */
  hint: string
  /** Texto do tooltip (ⓘ) do grupo, se houver. */
  info?: string
  /** Ícone do tópico no cabeçalho do grupo (server). */
  icon: LucideIcon
  /** Nome do ícone (string serializável) pra sub-nav client. */
  iconName: string
  /** Uma cor por grupo. */
  accent: SettingsAccent
  sections: SettingsSection[]
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "notas",
    label: "Calibração das notas",
    hint: "acurácia das notas previstas",
    info: "Ajusta a acurácia das notas previstas. A calibração automática recalcula MAEs e pseudo-votos (roda sozinha ao salvar uma obra); a de critérios IA audita e corrige vieses nos category_scores. Atualize os embeddings antes.",
    icon: Gauge,
    iconName: "Gauge",
    accent: "violet",
    sections: [
      {
        id: "calibration",
        title: "Calibração automática",
        description:
          "MAEs e pseudo-votos são recalculados a partir dos dados reais sempre que um título é incluído ou alterado.",
        help: "Recalcula os MAEs (o erro médio da Nota Prevista) e os pseudo-votos bayesianos a partir de todas as obras que já têm nota manual. Roda sozinha sempre que você salva ou altera uma obra; o botão aqui força o recálculo na hora. Depende dos Embeddings estarem atualizados — o kNN usa a vizinhança vetorial das obras.",
        icon: Gauge,
        chips: [
          { kind: "step", label: "Passo 2" },
          { kind: "cost", tier: "free", label: "Grátis" },
        ],
      },
      {
        id: "ai-calibration",
        title: "Calibração de critérios IA",
        panelTitle: "Calibração de critérios IA",
        description:
          "Auditoria por obra com auto-apply de sugestões e detecção de viés sistemático nos category_scores.",
        help: "Percorre obra a obra os 9 atributos que a IA atribuiu (category_scores), confronta com as reviews e o contexto externo e sugere correções, que podem ser aplicadas automaticamente. Também detecta viés sistemático — quando a IA puxa um critério pra cima ou pra baixo no catálogo inteiro (ex.: subestimar “drama”).",
        icon: Sparkles,
        chips: [{ kind: "cadence", label: "Frequente" }],
        collapsible: true,
      },
    ],
  },
  {
    id: "ia",
    label: "Gerado por IA",
    hint: "derivados por modelo, cacheados por obra",
    info: "Artefatos que a IA produz e guarda por obra — embeddings (OpenAI), sinopse canônica, resumo e digest de reviews (Claude). Regeneram sozinhos quando sinopse, tags ou critérios mudam. Rode-os após adicionar ou alterar obras; consomem tokens.",
    icon: Sparkles,
    iconName: "Sparkles",
    accent: "cyan",
    sections: [
      {
        id: "embeddings",
        title: "Embeddings",
        panelTitle: "Embeddings das obras",
        description:
          "Representação vetorial via OpenAI para 'obras parecidas' e kNN predictor. Cacheado por obra — só re-embeda quando sinopse/tags/critérios mudam.",
        help: "Cada obra é convertida num vetor pela OpenAI a partir da sinopse + tags + critérios. Esse vetor alimenta as “obras parecidas” e o kNN que a Calibração usa. É cacheado por obra: só re-embeda quando um desses inputs muda. É o Passo 1 — atualize antes de recalibrar.",
        icon: Brain,
        chips: [
          { kind: "step", label: "Passo 1" },
          { kind: "cost", tier: "low", label: "OpenAI ~$" },
        ],
      },
      {
        id: "synopsis-canonical",
        title: "Sinopse canônica",
        description:
          "Consolida múltiplas sinopses por obra em uma única canônica via Haiku — usada nos prompts de recomendação.",
        help: "Uma obra costuma ter várias sinopses (uma por fonte). Aqui o Haiku funde todas numa versão única e limpa, que passa a ser o texto oficial usado nos prompts de recomendação. Barato (Haiku) e independente das outras etapas.",
        icon: FileText,
        chips: [
          { kind: "cadence", label: "Independente" },
          { kind: "cost", tier: "low", label: "Haiku $" },
        ],
      },
      {
        id: "review-synthesis",
        title: "Síntese de reviews",
        panelTitle: "Síntese de reviews",
        description:
          "Transforma as reviews externas de cada obra em dois artefatos: um resumo curto (exibido no app) e um digest estruturado (consumido pela IA).",
        help: "Duas destilações das mesmas reviews externas. O Resumo (Haiku) é um parágrafo de consenso mostrado pra você na aba Notas & Avaliações. O Digest (Sonnet) é estruturado — consenso, divergências, traços salientes e alertas — e serve de insumo pro consultor de IA (Recomendar, Veredito IA, Deep Dive e Chat).",
        icon: MessageSquareText,
        chips: [
          { kind: "cadence", label: "Independente" },
          { kind: "cost", tier: "low", label: "Haiku $" },
          { kind: "cost", tier: "high", label: "Sonnet $$" },
        ],
      },
    ],
  },
  {
    id: "fontes",
    label: "Fontes externas",
    hint: "Comix — a principal fonte de reviews",
    info: "Operação da Comix, a principal fonte de reviews. Resolve o hid das obras (habilita a coleta de reviews) e testa a conexão. Use quando obras novas estão sem reviews.",
    icon: BookOpen,
    iconName: "BookOpen",
    accent: "amber",
    sections: [
      {
        id: "comix",
        title: "Comix",
        description:
          "A fonte principal de reviews. Resolve o hid das obras (pra habilitar reviews), permite preencher manualmente as não encontradas e testar a conexão.",
        help: "A Comix é a maior fonte de reviews do app, mas exige resolver o “hid” (o identificador interno) de cada obra pra habilitar a coleta. Aqui você resolve os hids pendentes, preenche à mão os que não casaram e roda um diagnóstico da conexão (FlareSolverr/Cloudflare) sem precisar abrir nenhuma obra.",
        icon: BookOpen,
        chips: [{ kind: "cadence", label: "Quando faltam reviews" }],
      },
    ],
  },
  {
    id: "avancado",
    label: "Avançado / Manutenção",
    hint: "preferências e tarefas raras",
    info: "Preferências de criação e tarefas raras de manutenção: comportamento ao criar obras, consolidar/mesclar tags duplicadas e regenerar os arquivos de constantes a partir do banco.",
    icon: Wrench,
    iconName: "Wrench",
    accent: "slate",
    sections: [
      {
        id: "on-create",
        title: "Comportamento na criação",
        description:
          "Liga/desliga as etapas de IA que rodam sozinhas ao salvar uma obra — Avaliação IA, Sinopse canônica, Inferência de tags, Resumo e Digest de reviews, o shadow de Interesse e os pesos automáticos.",
        help: "As chaves que controlam quando a IA gasta tokens sozinha. Avaliação IA, Sinopse canônica e Inferência de tags (Haiku) só rodam na CRIAÇÃO via “Buscar dados”. Resumo (Haiku) e Digest (Sonnet) de reviews rodam em QUALQUER save (criação e “Atualizar dados”) — desligá-los persiste as reviews sem a síntese paga, que você gera depois pela seção “Síntese de reviews”. O shadow de Interesse é um experimento A/B de dev que DOBRA o custo do Interesse na criação (fica desligado, salvo testes). Pesos automáticos é a mesma chave da Calibração automática: usa pesos inferidos do seu histórico e recalcula o catálogo ao alternar. Deixe desligado o que não quiser que dispare sem você pedir.",
        icon: Wand2,
        chips: [
          { kind: "cadence", label: "Preferência" },
          { kind: "cost", tier: "low", label: "Haiku $" },
          { kind: "cost", tier: "high", label: "Sonnet $$" },
        ],
      },
      {
        id: "tags",
        title: "Consolidação de tags",
        panelTitle: "Consolidação de tags",
        description: "Revise clusters semânticos propostos pela IA e mescle tags duplicadas.",
        help: "A IA agrupa tags parecidas em clusters semânticos (ex.: “colegial”, “escola” e “vida escolar”). Você revisa cada cluster e decide mesclar as duplicadas numa tag canônica, mantendo o vocabulário de tags enxuto e consistente.",
        icon: Tags,
        chips: [{ kind: "cadence", label: "Ocasional" }],
        collapsible: true,
      },
      {
        id: "sync",
        title: "Sincronização de constantes",
        description:
          "Regenera os arquivos locais de constantes a partir do Supabase. Só precisa quando o schema/tabelas de constantes do DB mudam.",
        help: "Regenera os arquivos de constantes do código (critérios, status, plataformas…) a partir das tabelas do Supabase. Só é necessário quando o schema do banco muda — é uma tarefa rara, de manutenção/dev.",
        icon: Database,
        chips: [{ kind: "cadence", label: "Raro · dev" }],
      },
    ],
  },
]

/** Grupo default (primeiro) quando não há `?g=`. */
export const DEFAULT_GROUP_ID = SETTINGS_GROUPS[0]?.id ?? ""

const ALL_SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.sections)

/** Valida o `?g` contra os ids de grupo conhecidos (null se inválido/ausente). */
export function normalizeGroupId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && SETTINGS_GROUPS.some((g) => g.id === value) ? value : null
}

/** Valida o `?open` contra ids de seção colapsável (null se inválido/ausente). */
export function normalizeOpenId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && ALL_SECTIONS.some((s) => s.id === value && s.collapsible) ? value : null
}

export function findGroup(id: string): SettingsGroup | null {
  return SETTINGS_GROUPS.find((g) => g.id === id) ?? null
}

export function findSection(id: string): SettingsSection | null {
  return ALL_SECTIONS.find((s) => s.id === id) ?? null
}

/** Grupo que contém uma seção — usado pra resolver deep-links antigos (`?s=<item>`). */
export function groupIdOfSection(sectionId: string): string | null {
  return SETTINGS_GROUPS.find((g) => g.sections.some((s) => s.id === sectionId))?.id ?? null
}

export function panelTitleOf(section: SettingsSection): string {
  return section.panelTitle ?? section.title
}
