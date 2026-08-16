import type { MoodExclusionKey, MoodPracticalDimension } from "@/lib/calculations/mood-refine"

/**
 * Como cada dimensão prática do refino se CHAMA na tela — dono único.
 *
 * 🔴 Existe porque os rótulos estavam escritos em DOIS lugares: o diálogo de refino
 * ("Mais alinhado") e o resumo do topo do comparador ("❤️ Mais alinhado"). Duas
 * cópias do mesmo nome, que divergiriam no primeiro ajuste de texto — a família
 * "dois critérios pro mesmo fato", aqui decidindo o que a pessoa lê sobre a própria
 * escolha.
 *
 * 🔴 **Nem toda dimensão é BIPOLAR, e forçar simetria mentiria.** "Mais popular" tem
 * um oposto útil ("mais de nicho"); "sinopse interessante" não tem — ninguém procura
 * uma sinopse que interessa menos. Quando `down` é `null`, o controle desenha só o
 * lado de priorizar (3 níveis em vez de 5), e a escala continua sendo a mesma
 * `AttributeWeight`. É mais honesto que oferecer um lado que não quer dizer nada.
 */
export interface MoodDimensionInfo {
  key: MoodPracticalDimension
  emoji: string
  /**
   * Nome NEUTRO da dimensão — o que ela mede, sem tomar lado ("Tamanho", "História").
   * É o rótulo da linha quando os dois lados aparecem como botões; sem ele o rótulo
   * teria que ser um dos lados, e a linha diria "Concluída [Em andamento|Concluída]".
   */
  name: string
  /** Lado +1/+2. */
  up: string
  /** Lado −1/−2, ou `null` quando a dimensão não tem oposto com sentido. */
  down: string | null
  /** Uma linha explicando o que a dimensão olha — vai no `title` do controle. */
  hint: string
}

export const MOOD_DIMENSION_INFO: Record<MoodPracticalDimension, MoodDimensionInfo> = {
  art: {
    key: "art",
    name: "Arte",
    emoji: "🎨",
    up: "Arte melhor",
    down: null,
    hint: "Posição da estimativa de arte no catálogo. Separa 80% das obras empatadas — é um dos sinais mais fortes aqui.",
  },
  publication: {
    key: "publication",
    name: "História",
    /* ⚠️ Não use ✅ aqui: no app ele É o símbolo do status "Completed"
       (`publication_status.symbol`), então o rótulo da DIMENSÃO passava a exibir o
       ícone de um dos LADOS — e ✅ ainda significa "certo/feito", o que sugeria que
       concluída é a resposta boa. O eixo é "tem linha de chegada?", e nenhum dos
       dois lados é o correto: quem quer maratonar prefere concluída, quem quer
       acompanhar lançamento prefere em andamento. */
    emoji: "🏁",
    up: "Já concluída",
    down: "Ainda em andamento",
    hint: "Dá pra começar agora sem ficar esperando? Concluída não tem espera; em hiato é o pior caso.",
  },
  alignment: {
    key: "alignment",
    name: "Alinhamento",
    emoji: "❤️",
    up: "Mais alinhado",
    down: null,
    hint: "O quanto as tags da obra batem com o seu perfil de gosto.",
  },
  synopsis: {
    key: "synopsis",
    name: "Sinopse",
    emoji: "📜",
    up: "Sinopse interessante",
    down: null,
    hint: "O seu Interesse na sinopse (♥ a ♥♥♥♥) — o seu, ou o previsto quando você ainda não deu.",
  },
  popularity: {
    key: "popularity",
    name: "Público",
    emoji: "📈",
    up: "Mais popular",
    down: "Mais de nicho",
    hint: "Volume de votos nas fontes externas. O lado negativo procura o que pouca gente leu.",
  },
  platform: {
    key: "platform",
    name: "Nota externa",
    emoji: "⭐",
    up: "Melhor avaliada fora",
    down: null,
    hint: "Média das notas nas fontes externas.",
  },
  reading: {
    key: "reading",
    name: "Leitura",
    emoji: "🔖",
    up: "Já comecei",
    down: "Ainda não comecei",
    hint: "Continuar algo que você já abriu, ou começar do zero. Obra já terminada ou largada fica de fora — não é nem um nem outro.",
  },
  recency: {
    key: "recency",
    name: "Lançamento",
    emoji: "🗓️",
    up: "Mais recente",
    down: "Mais antiga",
    hint: "Ano de início da publicação.",
  },
}

/** Ordem de exibição — as que mais separam obras empatadas primeiro (medido 2026-08-15). */
const MOOD_DIMENSION_ORDER_ALL: readonly MoodPracticalDimension[] = [
  "art",
  "popularity",
  "alignment",
  "synopsis",
  "publication",
  "reading",
  "platform",
  "recency",
] as const

/**
 * Dimensões com dois lados úteis → viram PAR de botões; as demais viram chip.
 * 🔴 Derivado de `down`, nunca duas listas escritas à mão: com listas paralelas,
 * declarar um `down` novo e esquecer de mover a dimensão faria o controle sumir de
 * um bloco sem aparecer no outro.
 */
export const BIPOLAR_DIMENSIONS = MOOD_DIMENSION_ORDER_ALL.filter(
  (k) => MOOD_DIMENSION_INFO[k].down != null,
)
export const UNIPOLAR_DIMENSIONS = MOOD_DIMENSION_ORDER_ALL.filter(
  (k) => MOOD_DIMENSION_INFO[k].down == null,
)

/** A ordem completa — para quem itera todas as dimensões. */
export const MOOD_DIMENSION_ORDER = MOOD_DIMENSION_ORDER_ALL

/** Rótulo do lado escolhido, para o resumo ("Priorizando …" / "Evitando …"). */
export function moodDimensionLabel(key: MoodPracticalDimension, weight: number): string {
  const info = MOOD_DIMENSION_INFO[key]
  const nome = weight > 0 ? info.up : (info.down ?? info.up)
  return `${info.emoji} ${nome}${Math.abs(weight) >= 2 ? "++" : ""}`
}

/**
 * Rótulos das categorias que podem ser EXCLUÍDAS da comparação ("Não mostrar").
 *
 * ⚠️ Agrupadas por dimensão porque é assim que a pessoa pensa ("da publicação, tire
 * hiato e cancelada"). A ordem dentro de cada grupo vai do que se exclui com mais
 * frequência para o menos — hiato e descartada primeiro, que foram os pedidos reais.
 */
export const MOOD_EXCLUSION_GROUPS: ReadonlyArray<{
  label: string
  emoji: string
  items: ReadonlyArray<{ key: MoodExclusionKey; label: string }>
}> = [
  {
    label: "Publicação",
    emoji: "🏁",
    items: [
      { key: "pub:hiatus", label: "Em hiato" },
      { key: "pub:cancelled", label: "Cancelada" },
      { key: "pub:ongoing", label: "Em andamento" },
      { key: "pub:concluded", label: "Concluída" },
    ],
  },
  {
    label: "Leitura",
    emoji: "🔖",
    items: [
      { key: "read:discarded", label: "Descartada" },
      { key: "read:finished", label: "Já terminada" },
      { key: "read:inProgress", label: "Em curso" },
      { key: "read:unstarted", label: "Não comecei" },
    ],
  },
]
