import {
  BookOpen,
  Brain,
  Database,
  FileText,
  Gauge,
  Layers,
  MessageSquareText,
  Sparkles,
  Tags,
  Wand2,
} from "lucide-react"
import type { ConsoleGroup, ConsoleSection } from "@/components/console/console-registry"
import {
  findSection as findSectionIn,
  firstSectionId,
  normalizeSectionId as normalizeSectionIdIn,
} from "@/components/console/console-registry"

// Registry das seções do console /settings. A metadata de navegação (grupos,
// cards, seletor) sai daqui; o CORPO de cada painel vive no switch em page.tsx.
// Grupos por NATUREZA, ordenados por frequência de uso. 1 accent por grupo.
export const SETTINGS_GROUPS: ConsoleGroup[] = [
  {
    label: "Calibração das notas",
    hint: "acurácia das notas previstas",
    info: "Ajusta a acurácia das notas previstas. A calibração automática recalcula MAEs e pseudo-votos (roda sozinha ao salvar uma obra); a de critérios IA audita e corrige vieses nos category_scores. Atualize os embeddings antes.",
    sections: [
      {
        id: "calibration",
        title: "Calibração automática",
        description:
          "MAEs e pseudo-votos são recalculados a partir dos dados reais sempre que um título é incluído ou alterado.",
        icon: Gauge,
        accent: "violet",
        chips: [
          { kind: "step", label: "Passo 2" },
          { kind: "cost", tier: "free", label: "Grátis" },
        ],
      },
      {
        id: "ai-calibration",
        title: "Calibração de critérios IA",
        description:
          "Auditoria por obra com auto-apply de sugestões e detecção de viés sistemático nos category_scores.",
        icon: Sparkles,
        accent: "violet",
        chips: [{ kind: "cadence", label: "Frequente" }],
        nav: { href: "/settings/calibration", label: "Abrir página de calibração" },
      },
    ],
  },
  {
    label: "Gerado por IA",
    hint: "derivados por modelo, cacheados por obra",
    info: "Artefatos que a IA produz e guarda por obra — embeddings (OpenAI), sinopse canônica, resumo e digest de reviews (Claude). Regeneram sozinhos quando sinopse, tags ou critérios mudam. Rode-os após adicionar ou alterar obras; consomem tokens.",
    // Na tab-strip vai pra 2ª linha (5 chips), deixando os outros 3 grupos
    // (2+1+2 = 5) na 1ª — split limpo de 5/5.
    stripRow: 2,
    sections: [
      {
        id: "embeddings",
        title: "Embeddings",
        panelTitle: "Embeddings das obras",
        description:
          "Representação vetorial via OpenAI para 'obras parecidas' e kNN predictor. Cacheado por obra — só re-embeda quando sinopse/tags/critérios mudam.",
        icon: Brain,
        accent: "cyan",
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
        icon: FileText,
        accent: "cyan",
        chips: [
          { kind: "cadence", label: "Independente" },
          { kind: "cost", tier: "low", label: "Haiku $" },
        ],
      },
      {
        id: "review-summary",
        title: "Resumo de reviews",
        description:
          "Resume as reviews externas de cada obra em um parágrafo de consenso via Haiku — mostrado na aba Notas & Avaliações.",
        icon: MessageSquareText,
        accent: "cyan",
        chips: [
          { kind: "cadence", label: "Independente" },
          { kind: "cost", tier: "low", label: "Haiku $" },
        ],
      },
      {
        id: "review-digest",
        title: "Digest de reviews",
        panelTitle: "Digest estruturado de reviews",
        description:
          "Destila as reviews num digest estruturado (Sonnet) que o consultor IA consome — consenso, traços salientes, alertas. Opt-in (custo Sonnet).",
        icon: Layers,
        accent: "cyan",
        chips: [
          { kind: "cadence", label: "Independente" },
          { kind: "cost", tier: "high", label: "Sonnet $$" },
        ],
      },
      {
        id: "on-create",
        title: "Comportamento na criação",
        description:
          "O que roda automaticamente ao criar uma obra via 'Buscar dados'. Desligado por padrão pra evitar custo de tokens não intencional.",
        icon: Wand2,
        accent: "cyan",
        chips: [{ kind: "cadence", label: "Preferência" }],
      },
    ],
  },
  {
    label: "Fontes externas (Comix)",
    hint: "a principal fonte de reviews",
    info: "Operação da Comix, a principal fonte de reviews. Resolve o hid das obras (habilita a coleta de reviews) e testa a conexão. Use quando obras novas estão sem reviews.",
    sections: [
      {
        id: "comix",
        title: "Comix",
        description:
          "A fonte principal de reviews. Resolve o hid das obras (pra habilitar reviews), permite preencher manualmente as não encontradas e testar a conexão.",
        icon: BookOpen,
        accent: "amber",
        chips: [{ kind: "cadence", label: "Quando faltam reviews" }],
      },
    ],
  },
  {
    label: "Avançado / manutenção",
    hint: "raro",
    info: "Tarefas raras de manutenção: consolidar/mesclar tags duplicadas e regenerar os arquivos de constantes a partir do banco (só quando o schema do DB muda). Recolhido por padrão.",
    advanced: true,
    sections: [
      {
        id: "tags",
        title: "Consolidação de tags",
        description: "Revise clusters semânticos propostos pela IA e mescle tags duplicadas.",
        icon: Tags,
        accent: "slate",
        chips: [{ kind: "cadence", label: "Ocasional" }],
        nav: { href: "/settings/tag-consolidation", label: "Abrir página de consolidação" },
      },
      {
        id: "sync",
        title: "Sincronização de constantes",
        description:
          "Regenera os arquivos locais de constantes a partir do Supabase. Só precisa quando o schema/tabelas de constantes do DB mudam.",
        icon: Database,
        accent: "slate",
        chips: [{ kind: "cadence", label: "Raro · dev" }],
      },
    ],
  },
]

/** Primeira seção — painel default quando um deep-link `?s=` aponta pra ela. */
export const DEFAULT_SECTION_ID = firstSectionId(SETTINGS_GROUPS)

export function normalizeSectionId(raw: string | string[] | undefined): string | null {
  return normalizeSectionIdIn(SETTINGS_GROUPS, raw)
}

export function findSection(id: string): ConsoleSection | null {
  return findSectionIn(SETTINGS_GROUPS, id)
}
