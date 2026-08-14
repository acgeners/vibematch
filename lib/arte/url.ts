/**
 * O CONTRATO de URL do filtro de arte — dono único do nome do parâmetro e dos valores.
 *
 * 🔴 Fica FORA da família `min_<slug>`/`max_<slug>` de propósito. Aquela query string é
 * contrato dos 9 atributos e **fala pontos** — `getRanking`, os presets salvos
 * (`ranking_filter_presets` guarda a query CRUA), o `/favorites` e o diálogo de recomendação
 * leem os mesmos limiares sem saber que existe outra unidade. A estimativa de arte é
 * comprimida a ~0,49× a escala do rótulo: um `min_art=8` seria lido como "8 pontos" e
 * devolveria 56% do catálogo onde a taxa real é 75%. Filtro nenhum, sem erro, com resultado
 * plausível — exatamente o bug que `lib/ranking/criterion-unit.ts` documenta.
 *
 * Por isso o valor é DISCRETO (uma faixa, não um número): não tem unidade para confundir, e
 * um consumidor que não conheça o parâmetro simplesmente o ignora em vez de o interpretar
 * errado.
 *
 * ⚠️ Três páginas montam `RankingFilters` a partir da URL (`/ranking`, `/favorites`,
 * `/titles`). Uma 2ª cópia deste parse é como o filtro passa a valer numa e não na outra.
 */

export const ART_FILTER_PARAM = "art"

export type ArtFilter = "forte" | "sem_fraca"

/**
 * Os dois valores tratam "sem estimativa" ao CONTRÁRIO um do outro — ver `RankingFilters.artFilter`:
 *   "forte"     → só a faixa de cima; obra sem estimativa NÃO passa
 *   "sem_fraca" → esconde a faixa de baixo; obra sem estimativa PASSA
 */
export function parseArtFilter(raw: string | null | undefined): ArtFilter | undefined {
  return raw === "forte" || raw === "sem_fraca" ? raw : undefined
}

/**
 * A regra do filtro, num lugar só — porque a parte sutil dela é a ASSIMETRIA e ela regride
 * calada: trocada, o filtro devolve um recorte plausível e errado, sem erro nem log.
 *
 * | filtro      | faixa forte | media | fraca | SEM estimativa |
 * |-------------|-------------|-------|-------|----------------|
 * | (nenhum)    | passa       | passa | passa | passa          |
 * | "forte"     | passa       | não   | não   | **não**        |
 * | "sem_fraca" | passa       | passa | não   | **passa**      |
 *
 * O "sem estimativa" é o que muda de lado: um filtro POSITIVO que aceita desconhecido devolve
 * o que ninguém pediu; um filtro NEGATIVO que rejeita desconhecido apaga obra que nunca foi
 * medida — 2,4% do catálogo hoje, e 100% antes da semente do sinal.
 */
export function artFilterMatches(
  band: "forte" | "media" | "fraca" | null | undefined,
  filter: ArtFilter | undefined,
): boolean {
  if (!filter) return true
  if (filter === "forte") return band === "forte"
  return band !== "fraca"
}

/** Rótulos do controle e do chip. Descrevem uma ESTIMATIVA — não prometem a arte. */
export const ART_FILTER_LABELS: Record<ArtFilter, string> = {
  forte: "Arte provavelmente forte",
  sem_fraca: "Esconder arte provavelmente fraca",
}

/** Versão curta, para o chip de filtro ativo. */
export const ART_FILTER_CHIP_LABELS: Record<ArtFilter, string> = {
  forte: "Arte forte (est.)",
  sem_fraca: "Sem arte fraca (est.)",
}
