import type { HiatusKind } from "@/lib/external/hiatus-kind"

/**
 * Como o tipo de hiato se APRESENTA — glifo, rótulo e a frase que explica.
 *
 * 🔴 Dono único, e a razão é a de sempre neste projeto: são **três** superfícies consumindo o
 * mesmo estado (o badge de publicação, a banda da /leitura e o tooltip), e uma segunda cópia é
 * como a tabela diz "entre temporadas" e a /leitura chama a mesma obra de "Possível hiato".
 * Mesma armadilha do `LOW_BALANCE_USD` e do `STRONG_TAG_WEIGHT`.
 *
 * 🔴 **O sinal é FORMA, não cor.** Os dois tipos dividem o âmbar do status "Hiatus", e um
 * "âmbar mais escuro" para o segundo devolveria a distinção a quem enxerga cor com
 * dificuldade — além de virar ruído, já que 3 de cada 4 obras em hiato são do mesmo tipo. É a
 * régua que `components/ui/tag-stance-mark.tsx` já aplica aos dois níveis de tag.
 *
 * Os glifos são semânticos: `»` = há continuação anunciada; `—` = parou, sem continuação à
 * vista.
 */
/**
 * As três colunas que viajam juntas da query até o badge.
 *
 * ⚠️ Existe como tipo compartilhado porque são **6 fontes de dados diferentes** alimentando o
 * mesmo badge (vitrine, "Continue lendo", /painel, comparador, hero do login, fila de
 * avaliação) — e declarar a tripla à mão em cada uma é como uma delas ganha `hiatus_kind` sem
 * `publication_status_note` e o tooltip aparece sem a prova, só ali.
 */
export interface HiatusFields {
  hiatusKind: HiatusKind | null
  hiatusKindConfidence: "high" | "low" | null
  publicationStatusNote: string | null
}

/** As 3 colunas no `select` do PostgREST — uma string só, pelo mesmo motivo do tipo acima. */
export const HIATUS_SELECT_COLUMNS = "hiatus_kind, hiatus_kind_confidence, publication_status_note"

/** Linha crua do PostgREST → `HiatusFields`. */
export function hiatusFieldsFromRow(row: {
  hiatus_kind?: HiatusKind | null
  hiatus_kind_confidence?: "high" | "low" | null
  publication_status_note?: string | null
}): HiatusFields {
  return {
    hiatusKind: row.hiatus_kind ?? null,
    hiatusKindConfidence: row.hiatus_kind_confidence ?? null,
    publicationStatusNote: row.publication_status_note ?? null,
  }
}

export interface HiatusDisplay {
  /** Sobrevive onde o texto não cabe (coluna de tabela, `iconOnly` da /leitura). */
  glyph: string
  /** Sufixo do badge quando há largura. */
  label: string
  /** Título do tooltip. */
  title: string
  /** Uma frase dizendo o que a publicação fez. */
  description: string
}

const DISPLAY: Record<HiatusKind, HiatusDisplay> = {
  between_seasons: {
    glyph: "»",
    label: "entre temporadas",
    title: "Pausa entre temporadas",
    description: "A temporada fechou e a próxima está anunciada.",
  },
  mid_season: {
    glyph: "—",
    label: "interrompido",
    title: "Publicação interrompida",
    description: "Parou no meio de uma temporada, que seguia aberta.",
  },
}

/**
 * O que mostrar, ou `null` quando a tela **não deve afirmar**.
 *
 * 🔴 Confiança baixa devolve `null` de propósito. Medido em 2026-08-11: 5 obras decidem por
 * sinal indireto ("a temporada fechou e ninguém anunciou a próxima") e outras 5 não decidem.
 * Nessas, o badge fica no "Hiato" puro e a leitura vai só para o tooltip, redigida como
 * hipótese — pintar o glifo ali afirmaria com a mesma ênfase de um `S4: TBA` explícito.
 */
export function hiatusDisplay(
  kind: HiatusKind | null | undefined,
  confidence: "high" | "low" | null | undefined,
): HiatusDisplay | null {
  if (!kind || confidence !== "high") return null
  return DISPLAY[kind]
}

/**
 * A leitura da regra mesmo quando ela é fraca — só para o tooltip, nunca para o badge.
 * Devolve `null` só quando não há tipo nenhum.
 */
export function hiatusTooltip(
  kind: HiatusKind | null | undefined,
  confidence: "high" | "low" | null | undefined,
): { title: string; description: string } | null {
  if (!kind) return null
  const d = DISPLAY[kind]
  if (confidence === "high") return { title: d.title, description: d.description }
  // "Provavelmente" é o que separa o veredito da hipótese, e a diferença precisa estar na
  // FRASE — o tooltip não tem badge nem cor para carregá-la.
  return {
    title: `Provavelmente ${d.title.toLowerCase()}`,
    description:
      kind === "between_seasons"
        ? "A última temporada fechou, mas ninguém anunciou a próxima — a leitura é indireta."
        : "Há motivo declarado para a parada, mas o texto não detalha onde a publicação parou.",
  }
}
