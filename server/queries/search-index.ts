import "server-only"
import { SETTINGS_GROUPS } from "@/app/curation/settings/sections"
import { buildPreferencesGroups } from "@/app/preferences/sections"
import type { Role } from "@/lib/plans/roles"

/**
 * O índice da busca global — tudo que NÃO é obra.
 *
 * Obras vêm do servidor sob demanda (`searchWorkSuggestions`, o mesmo do `/catalog`). O resto —
 * páginas, seções de Configurações e de Preferências — é dado ESTÁTICO que já existe nos
 * registries do app, então é montado aqui e vai inteiro pro cliente: buscar "comix" ou
 * "embedding" responde na tecla, sem ida ao banco.
 *
 * ⚠️ Isto nasceu de um buraco no desenho: a 1ª versão da busca só indexava título de obra e os
 * destinos de topo, então procurar "Comix" ou "Embeddings" — que são SEÇÕES dentro de
 * Configurações — não achava nada. As 14 seções sempre estiveram descritas em
 * `SETTINGS_GROUPS`; faltava alguém perguntar a elas.
 *
 * ⚠️ O índice vai COMPLETO pro cliente, com o papel mínimo em cada entrada, e a filtragem
 * acontece lá (mesmo padrão da barra superior, que também embarca o NAV inteiro). O que
 * protege as rotas é o gate do `middleware.ts`, não a ausência do nome no bundle — e os
 * títulos das seções não são segredo. Não colocar aqui nada que seja.
 */

export type SearchKind = "config" | "pref" | "page"

export interface SearchEntry {
  /** Único dentro do índice — vira o `value` do CommandItem. */
  id: string
  kind: SearchKind
  title: string
  /** Frase curta abaixo do título; também entra no casamento da busca. */
  description: string
  /** "Configurações › Fontes externas" — dá o contexto que o título sozinho não dá. */
  crumb: string | null
  href: string
  /** Papel mínimo que alcança a entrada. */
  minRole: Role
  /**
   * Exige SESSÃO, não só papel.
   *
   * ⚠️ Sem isto, `/reading` e `/account` apareceriam para o visitante: o papel de um anônimo
   * TAMBÉM é `leitor` (fail-closed em `getCurrentRole`), então `minRole: "leitor"` sozinho não
   * distingue "qualquer usuário" de "qualquer pessoa". O que falta ao anônimo não é
   * permissão, é identidade — mesma armadilha de `useCanWriteOwnState`.
   */
  requiresSession: boolean
  /** Nome de ícone (string serializável; o registry de ícones vive no client). */
  iconName: string
}

/**
 * Páginas do app. Espelha a barra superior + o menu do avatar + a console — a busca não pode
 * oferecer destino que a navegação não tem, nem esquecer os que ela tem.
 */
const PAGES: Array<Omit<SearchEntry, "kind" | "crumb">> = [
  { id: "page-home", title: "Início", description: "a vitrine do catálogo", href: "/", minRole: "leitor", requiresSession: false, iconName: "Home" },
  { id: "page-titles", title: "Catálogo", description: "todas as obras, com filtros e busca", href: "/catalog", minRole: "leitor", requiresSession: false, iconName: "BookOpen" },
  { id: "page-ranking", title: "Ranking", description: "obras ordenadas pelo seu gosto", href: "/ranking", minRole: "leitor", requiresSession: false, iconName: "Trophy" },
  { id: "page-recs", title: "Recomendações", description: "consultor de IA e histórico de rodadas", href: "/recommendations", minRole: "leitor", requiresSession: false, iconName: "Wand2" },
  { id: "page-sobre", title: "Sobre a SatorIA", description: "a marca, o método e os 4 passos", href: "/about", minRole: "leitor", requiresSession: false, iconName: "Info" },
  { id: "page-guia", title: "Guia do app", description: "como usar, do zero", href: "/guide", minRole: "leitor", requiresSession: false, iconName: "BookOpenText" },

  { id: "page-leitura", title: "Acompanhamento", description: "o que você está lendo e o ritmo de cada obra", href: "/reading", minRole: "leitor", requiresSession: true, iconName: "BookMarked" },
  { id: "page-favorites", title: "Favoritos", description: "suas listas e grupos", href: "/favorites", minRole: "leitor", requiresSession: true, iconName: "Heart" },
  { id: "page-fila", title: "Suas notas de IA", description: "Veredito IA e previsão de Interesse, por obra", href: "/my-ai-scores", minRole: "leitor", requiresSession: true, iconName: "Clock" },
  { id: "page-import", title: "Importar minha lista", description: "MyAnimeList, AniList, MangaUpdates, AnimePlanet", href: "/import", minRole: "leitor", requiresSession: true, iconName: "Upload" },
  { id: "page-conta", title: "Minha conta", description: "plano, saldo e identidade", href: "/account", minRole: "leitor", requiresSession: true, iconName: "UserCircle" },
  { id: "page-perfil", title: "Perfil de gosto", description: "o que a IA aprendeu sobre o que você gosta", href: "/account/taste-profile", minRole: "leitor", requiresSession: true, iconName: "Sparkles" },
  { id: "page-painel", title: "Painel", description: "a forma da sua biblioteca em números", href: "/dashboard", minRole: "leitor", requiresSession: true, iconName: "Gauge" },

  { id: "page-curadoria", title: "Curadoria do catálogo", description: "a console: o que precisa da sua decisão", href: "/curation", minRole: "curador", requiresSession: true, iconName: "Wrench" },
  { id: "page-aieval", title: "Curadoria da Obra", description: "fila de atributos para avaliar", href: "/curation/works", minRole: "curador", requiresSession: true, iconName: "Wrench" },
  { id: "page-aiusage", title: "Uso da API IA", description: "custo, tokens e chamadas por operação", href: "/curation/ai-usage", minRole: "curador", requiresSession: true, iconName: "Activity" },
  { id: "page-metrics", title: "Métricas do modelo", description: "acurácia da Nota Prevista", href: "/curation/model-metrics", minRole: "curador", requiresSession: true, iconName: "ChartNoAxesCombined" },
  { id: "page-new", title: "Nova obra", description: "criar do zero ou buscar dados nas fontes", href: "/catalog/new", minRole: "curador", requiresSession: true, iconName: "Plus" },
]

/**
 * Monta o índice. Chamado no layout raiz (que já é dinâmico), uma vez por request.
 *
 * `buildPreferencesGroups` recebe `("paid", true)` de propósito: queremos o índice COMPLETO,
 * com o papel mínimo marcado em cada entrada, e não o recorte de quem está pedindo. Passar o
 * papel real aqui faria o índice mudar de tamanho por usuário sem que a filtragem do cliente
 * soubesse — dois lugares decidindo a mesma coisa.
 */
export function buildSearchIndex(): SearchEntry[] {
  const pages: SearchEntry[] = PAGES.map((p) => ({ ...p, kind: "page", crumb: null }))

  const config: SearchEntry[] = SETTINGS_GROUPS.flatMap((g) =>
    g.sections.map((s) => ({
      id: `config-${s.id}`,
      kind: "config" as const,
      title: s.title,
      description: s.description,
      crumb: `Configurações › ${g.label}`,
      // `open` só é honrado em seção colapsável (`normalizeOpenId`); nas demais é
      // ignorado sem erro, então mandar sempre é seguro e abre a ferramenta direto.
      href: `/curation/settings?g=${g.id}&open=${s.id}`,
      minRole: "curador" as const,
      requiresSession: true,
      iconName: g.iconName,
    })),
  )

  const prefs: SearchEntry[] = buildPreferencesGroups("paid", true).flatMap((g) =>
    g.sections.map((s) => ({
      id: `pref-${g.id}-${s.id}`,
      kind: "pref" as const,
      title: s.title,
      description: s.description,
      crumb: `Preferências › ${g.label}`,
      href: `/preferences?g=${g.id}`,
      minRole: "leitor" as const,
      requiresSession: true,
      iconName: g.iconName,
    })),
  )

  return [...pages, ...config, ...prefs]
}
