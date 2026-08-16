/**
 * As FAIXAS da estimativa de arte — cortes, rótulos e a função que classifica.
 *
 * ⚠️ Isto morava em `lib/art/model.ts` e saiu de lá por peso de bundle, não por organização:
 * o painel de filtros é `"use client"` e passou a precisar dos cortes para escrever
 * "Top 20%" no botão. Importar o módulo do modelo levaria junto `lib/ml/{ridge,logistic,
 * preprocessing}` — Ridge, StandardScaler e k-fold — para o bundle de uma tela que só quer
 * dois números. `model.ts` re-exporta tudo o que está aqui, então nenhum importador antigo
 * precisou mudar.
 */

/**
 * As faixas. Saem da MEDIÇÃO, não de gosto: no retrato de 2026-08-12 o topo 20% do estimador
 * concentra 55% de obras com arte ≥ 9 (2,1× a taxa base) e o fundo 20% concentra 65% com arte
 * ≤ 6,5 (2,6×). O meio de 60% é onde ele não tem opinião — e dizer isso é mais honesto do que
 * espremer três faixas iguais.
 *
 * 🔴 Dono ÚNICO dos cortes. Uma 2ª cópia é como o chip diz "fraca" e o filtro não a esconde.
 * Os rótulos do filtro (`ART_FILTER_SEGMENT_LABELS`, em `url.ts`) DERIVAM daqui o "20%" que
 * imprimem — escrito à mão lá, mudar o corte deixaria o botão mentindo em silêncio.
 *
 * 🔴 **A faixa é POSIÇÃO, e só. Decidido pela curadora em 2026-08-12, com o custo medido na
 * mesa.** Foi proposto exigir CRÍTICA EM TEXTO para uma obra ser "fraca", e a proposta foi
 * recusada em favor da cobertura. O que isso aceita, explicitamente:
 *
 * - das 190 obras na faixa "fraca", **113 (59,5%) têm crítica de arte em texto** — as outras
 *   77 estão ali por posição;
 * - **38 delas (20%) não têm NENHUMA tag de arte ou formato**, e é a ausência que as afunda:
 *   mangá P&B não tem `full-color` nem `webtoon-webcomic`, que são as duas tags de maior peso;
 * - caso de referência: **Chobits** — estimativa 6,67, percentil 5, faixa "fraca", com **38
 *   palavras de elogio, ZERO de crítica** e o digest dizendo "arte característica da CLAMP,
 *   elogiada como bonita e versátil".
 *
 * ⚠️ Logo, "fraca" quer dizer **"está no fundo da estimativa"**, NÃO "leitores reclamaram da
 * arte". Todo texto de UI que prometer a segunda coisa está mentindo — é por isso que o
 * rótulo é "Arte provavelmente fraca" e não "Arte fraca". Reabrir isto exige medir de novo,
 * não relembrar o caso Chobits: ele já foi pesado e a escolha foi consciente.
 */
export const ART_BAND_CUTOFFS = { fraca: 0.2, forte: 0.8 } as const

export type ArtBand = "fraca" | "media" | "forte"

/**
 * ⚠️ Os rótulos são de ESTIMATIVA e o texto tem que dizer isso — a escala é comprimida e a
 * precisão no topo é 55%, então "arte excelente" seria promessa que o dado não paga. Se a UI
 * precisar de nomes configuráveis, o lugar é `ui_labels` (Fase 3), nunca uma 2ª constante.
 *
 * 🔴 São o dono dos NOMES das faixas nas duas superfícies: o card da obra imprime estes
 * textos, e o tooltip do filtro no /ranking os reusa. Houve uma 2ª cópia (`ART_FILTER_LABELS`
 * em `url.ts`, com "Arte provavelmente forte" repetido palavra por palavra) que nasceu órfã —
 * nenhum componente a lia, e o teste que exigia a palavra "provavelmente" passava verde com o
 * texto fora da tela, porque lia o objeto em vez do render.
 */
export const ART_BAND_LABELS: Record<ArtBand, string> = {
  forte: "Arte provavelmente forte",
  media: "Sem destaque de arte",
  fraca: "Arte provavelmente fraca",
}

/** `null` (sem estimativa) devolve `null` — é um terceiro estado, nunca "media". */
export function artBandFromPercentile(percentile: number | null | undefined): ArtBand | null {
  if (percentile == null || !Number.isFinite(percentile)) return null
  if (percentile <= ART_BAND_CUTOFFS.fraca) return "fraca"
  if (percentile > ART_BAND_CUTOFFS.forte) return "forte"
  return "media"
}
