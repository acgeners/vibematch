import type { MixedEdition } from "@/lib/editions/mixed-edition"

/**
 * Classificação etária da obra — dono único da REGRA de exibição (migration 223, `work_age_rating`).
 *
 * Três faixas, na régua da classificação indicativa brasileira: "Livre a 14" · "16" · "18". A faixa
 * oficial de cada produto (Naver, Kakao, RIDI, KMAS…) é arredondada PARA CIMA (15 coreano ⇒ 16;
 * 19 coreano ⇒ 18), nunca para baixo.
 *
 * 🔴 **Versão com conteúdo explícito é 18, sempre** (decisão da curadora, 15/11/2026). Por isso o
 * 18+ efetivo (`works.is_adult`) VENCE a linha da tabela: a obra explícita mostra 18 mesmo que a
 * faixa oficial encontrada seja baixa. O inverso também vale pelo gate: faixa 18 na linha `obra`
 * liga o `adult_auto` (`official_rating`, `lib/tags/adult-classify.ts`), então "ocultar 18+" esconde
 * os dois — idade 18 e conteúdo explícito — por UMA coluna.
 *
 * Mixed: a versão adulta é 18 (é a explícita); a versão normal tem linha própria (`versao = 'normal'`)
 * ou fica sem classificação. A linha `obra` de uma mixed é ignorada.
 */
export const AGE_RATINGS = [14, 16, 18] as const
export type AgeRating = (typeof AGE_RATINGS)[number]

export const AGE_RATING_LABEL: Record<AgeRating, string> = { 14: "Livre a 14", 16: "16", 18: "18" }

export const AGE_RATING_VERSIONS = ["obra", "normal"] as const
export type AgeRatingVersion = (typeof AGE_RATING_VERSIONS)[number]

export interface AgeRatingRow {
  versao: AgeRatingVersion
  faixa: AgeRating | null
  /** Motivo do conflito. Enquanto não-nulo, a linha está na fila de revisão da curadoria. */
  conflito: string | null
  decidido_por: "auditoria" | "curadoria"
}

/** De onde vem a faixa exibida. */
export type AgeRatingOrigin = "conteudo_adulto" | "oficial" | "curadoria" | "sem"

export interface AgeRatingView {
  faixa: AgeRating | null
  origem: AgeRatingOrigin
  /** A linha tem conflito aberto — a faixa (se houver) é provisória. */
  pendente: boolean
}

export function parseAgeRating(value: unknown): AgeRating | null {
  const n = typeof value === "string" ? Number(value) : value
  return AGE_RATINGS.includes(n as AgeRating) ? (n as AgeRating) : null
}

export function parseAgeRatingRow(raw: Record<string, unknown>): AgeRatingRow | null {
  const versao = raw.versao
  if (versao !== "obra" && versao !== "normal") return null
  return {
    versao,
    faixa: parseAgeRating(raw.faixa),
    conflito: typeof raw.conflito === "string" && raw.conflito.trim() ? raw.conflito : null,
    decidido_por: raw.decidido_por === "curadoria" ? "curadoria" : "auditoria",
  }
}

const fromRow = (row: AgeRatingRow | undefined): AgeRatingView =>
  row?.faixa != null
    ? { faixa: row.faixa, origem: row.decidido_por === "curadoria" ? "curadoria" : "oficial", pendente: row.conflito != null }
    : { faixa: null, origem: "sem", pendente: row?.conflito != null }

/**
 * A faixa exibida para a versão aberta.
 *
 * - não-mixed: 18+ efetivo ⇒ 18; senão a linha `obra`; sem linha ⇒ sem classificação.
 * - mixed: versão R18 ⇒ 18; versão normal (ou nenhuma resolvida) ⇒ a linha `normal`.
 *
 * ⚠️ `isAdult` é o `works.is_adult` (com override). Override "não é 18+" numa obra com faixa oficial
 * 18 mostra 18 e fica visível — é conflito de propósito, vai para a fila.
 */
export function ageRatingFor(input: {
  isMixed: boolean
  isAdult: boolean
  activeEdition: MixedEdition | null
  rows: ReadonlyArray<AgeRatingRow>
}): AgeRatingView {
  if (input.isMixed) {
    if (input.activeEdition === "r18") return { faixa: 18, origem: "conteudo_adulto", pendente: false }
    return fromRow(input.rows.find((r) => r.versao === "normal"))
  }
  const row = input.rows.find((r) => r.versao === "obra")
  if (input.isAdult) {
    const view = fromRow(row)
    return { faixa: 18, origem: row?.faixa === 18 ? view.origem : "conteudo_adulto", pendente: view.pendente }
  }
  return fromRow(row)
}

/** Texto do tooltip do selo — diz de onde a faixa veio. */
export function ageRatingExplanation(view: AgeRatingView): string {
  const base =
    view.origem === "conteudo_adulto"
      ? "18: a versão tem conteúdo sexual explícito."
      : view.origem === "oficial"
        ? `${AGE_RATING_LABEL[view.faixa as AgeRating]}: classificação oficial da plataforma de origem (arredondada para cima).`
        : view.origem === "curadoria"
          ? `${AGE_RATING_LABEL[view.faixa as AgeRating]}: definida pela curadoria.`
          : "Sem classificação: nenhuma classificação oficial confiável foi encontrada para esta versão."
  return view.pendente ? `${base} Em revisão pela curadoria.` : base
}
