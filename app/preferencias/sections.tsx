import { Droplets, Heart, Palette, Scale, Sparkles, Trophy, Wand2 } from "lucide-react"
import type { SettingsGroup, SettingsSection } from "@/app/settings/sections"

// Registry das PREFERÊNCIAS pro console de duas camadas (mesmo modelo do /settings:
// sub-nav lista os grupos → clicar empilha os cards dos itens). Montado por request
// porque "Regras livres (IA)" só existe no plano Pago. Um accent por grupo.
//
// EIXO ADMIN: apesar do nome, boa parte desta tela NÃO é preferência pessoal — pesos
// e cores moram em `formula_config`/`score_weights`, que são GLOBAIS (mudar ali muda
// o ranking de todos). O servidor já bloqueia (ensureAdmin nas actions), e aqui a UI
// acompanha: o não-admin não vê controle que ele não pode salvar. Só sobra o que é
// mesmo dele (tags, regras, filtros salvos — tabelas com user_id). Quando a Fase 2
// tornar essas configs per-user, isto volta a ser visível pra todos.

/** Grupo default quando não há `?g=`. */
export const PREFERENCES_DEFAULT_GROUP_ID = "ranking"

export function buildPreferencesGroups(plan: string, isAdmin: boolean): SettingsGroup[] {
  const rankingSections: SettingsSection[] = [
    {
      id: "ranking",
      title: "Filtros do Ranking",
      description: isAdmin
        ? "Nº de obras exibidas, nota mínima padrão e seus filtros salvos."
        : "Seus conjuntos de filtros salvos do Ranking.",
      help: isAdmin
        ? "Controla o recorte do Ranking: quantas obras exibir (top-N), a nota mínima padrão e os conjuntos de filtros que você salvou. Não muda como as notas são calculadas — só o que aparece na lista."
        : "Os conjuntos de filtros que você salvou no Ranking. O top-N e a nota mínima padrão são configuração global do catálogo — só o administrador ajusta.",
      icon: Trophy,
    },
    {
      id: "tag-preferences",
      title: "Tags que amo / evito",
      description:
        "Declare gostos por grupo, subgrupo ou tag. As selecionadas sobem pro topo e viram prior do seu perfil.",
      help: "Marque tags como amadas ou evitadas — por grupo, subgrupo ou tag individual (a tag sobrepõe o subgrupo). As selecionadas ficam destacadas no topo; dá pra dar ênfase forte (2×) numa seleção. Isso vira um prior do seu perfil de gosto (ajusta o ranking no próximo Recalcular) e habilita o filtro de evitadas.",
      icon: Heart,
    },
  ]
  if (plan === "paid") {
    rankingSections.push({
      id: "preference-rules",
      title: "Regras e preferências livres (IA)",
      description:
        "Orientações em texto livre pro consultor IA (Recomendar / Deep Dive / Desempatar / Chat). Não altera o ranking padrão.",
      help: "Escreva orientações em linguagem natural que o consultor de IA passa a considerar ao Recomendar, no Deep Dive, no Veredito IA e no Chat (ex.: “priorize worldbuilding denso”, “evite finais abruptos”). É um guia qualitativo — não mexe na fórmula nem no ranking determinístico.",
      icon: Wand2,
      chips: [{ kind: "cadence", label: "Plano Pago" }],
    })
  }

  const groups: SettingsGroup[] = [
    {
      id: "ranking",
      label: "Ranking & gostos",
      hint: "o que molda as recomendações",
      info: "Ajusta como o ranking é montado e declara seus gostos. Os filtros definem o que aparece; as tags amadas/evitadas viram prior do seu perfil. No plano Pago, as regras livres orientam o consultor de IA.",
      icon: Trophy,
      iconName: "Trophy",
      accent: "indigo",
      sections: rankingSections,
    },
    {
      id: "pesos",
      label: "Pesos",
      hint: "importância de cada critério",
      info: "Quanto cada eixo pesa. Os pesos dos critérios entram na fórmula da IA; os pesos pós-leitura ponderam sua avaliação manual.",
      icon: Scale,
      iconName: "Scale",
      accent: "violet",
      sections: [
        {
          id: "weights",
          title: "Pesos dos critérios",
          description:
            "Quanto cada critério IA vale na fórmula. Positivos amplificam, negativos penalizam.",
          help: "Define o peso de cada critério que a IA avalia na fórmula da Nota.IA. Positivos amplificam; negativos (drama, tragédia) só penalizam acima do limiar. Se os pesos automáticos estiverem ligados, os valores inferidos por Ridge sobre seu histórico substituem os manuais.",
          icon: Scale,
        },
        {
          id: "post-reading",
          title: "Pesos pós-leitura",
          description:
            "Importância de cada eixo na sua avaliação manual (salva neste navegador).",
          help: "Pondera cada eixo da sua avaliação pós-leitura (a nota que você dá depois de ler). É uma preferência pessoal salva neste navegador, separada dos pesos que a IA usa.",
          icon: Sparkles,
        },
      ],
    },
    {
      id: "cores",
      label: "Cores",
      hint: "percentis das notas e atributos",
      info: "Percentis que definem as faixas de cor. Ajuste pra que verde/amarelo/vermelho reflitam o que você considera bom, médio e ruim.",
      icon: Palette,
      iconName: "Palette",
      accent: "amber",
      sections: [
        {
          id: "score-colors",
          title: "Cores das notas",
          description:
            "Percentis que definem as cores das notas agregadas (Nota Prevista / Nota.Calc).",
          help: "Define os percentis que separam as faixas de cor das notas agregadas (Nota Prevista e Nota.Calc). Ajuste pra que verde/amarelo/vermelho reflitam o que você considera bom, médio e ruim no seu catálogo.",
          icon: Palette,
        },
        {
          id: "criterion-colors",
          title: "Cores dos atributos",
          description:
            "Percentis por atributo (opcional). Cada um colorido pela própria distribuição.",
          help: "Opcional: define percentis de cor por atributo individual, cada um colorido pela sua própria distribuição. Se desligado, os atributos herdam as faixas das notas agregadas.",
          icon: Droplets,
        },
      ],
    },
  ]

  // "Pesos" e "Cores" são 100% config global (formula_config / score_weights).
  return isAdmin ? groups : groups.filter((g) => g.id !== "pesos" && g.id !== "cores")
}

// ── Helpers parametrizados (os grupos são montados por request, então recebem
//    a lista como argumento — diferente do /settings, que tem registry estático). ──

export function normalizeGroupId(
  groups: SettingsGroup[],
  raw: string | string[] | undefined,
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && groups.some((g) => g.id === value) ? value : null
}

export function findGroup(groups: SettingsGroup[], id: string): SettingsGroup | null {
  return groups.find((g) => g.id === id) ?? null
}

export function findSection(groups: SettingsGroup[], id: string): SettingsSection | null {
  return groups.flatMap((g) => g.sections).find((s) => s.id === id) ?? null
}

/** Grupo que contém uma seção — resolve deep-links antigos (`?s=<item>`). */
export function groupIdOfSection(groups: SettingsGroup[], sectionId: string): string | null {
  return groups.find((g) => g.sections.some((s) => s.id === sectionId))?.id ?? null
}
