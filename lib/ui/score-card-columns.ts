/**
 * Colunas dos dois cards de nota da página da obra ("Notas calculadas" × "Avaliações
 * externas").
 *
 * Os dois vivem no mesmo grid lado a lado, que ESTICA ambos à altura do mais alto — então
 * quem tem menos itens ganha um rodapé vazio do tamanho da diferença. Este helper decide,
 * pela CONTAGEM de cada lado, qual deles quebra em duas colunas pra que as alturas cheguem
 * perto.
 *
 * A decisão é por contagem, não por largura, de propósito: a largura entra só como GUARDA
 * na classe (container query `@sm`/`@md`), pra não espremer célula em card estreito. Se as
 * duas coisas decidissem "quantas colunas", divergiriam em silêncio — foi o que acontecia
 * antes, quando "Avaliações externas" era `@md:grid-cols-2` fixo: numa janela de ~1050px o
 * card fica com ~430px de conteúdo, o `@md` (448px) nunca dispara e 9 fontes desciam em
 * coluna única ao lado de 2 notas calculadas.
 *
 * "Parecida" = diferença de até 2 itens. Aí os dois ficam em coluna única mesmo sobrando
 * largura: quebrar 5 fontes em 2 colunas deixa buraco na última linha e encolhe as células
 * sem comprar equilíbrio de verdade. A partir de 3 itens de diferença a sobra passa a doer
 * mais que a quebra, e o lado mais longo abre.
 *
 * ⚠️ Linha de um card NÃO tem a altura da linha do outro (item de nota calculada ≈ 85px,
 * item de fonte externa ≈ 72px). O alvo aqui é "altura parecida", nunca igual — não
 * transforme isto num cálculo de pixels: as alturas mudam a cada ajuste de padding.
 */
export type ScoreCardColumns = {
  /** Colunas do card "Notas calculadas" (guarda em `@md`: célula tem descrição longa + selo w-14). */
  calc: 1 | 2
  /** Colunas do card "Avaliações externas" (guarda em `@sm`: célula é mais leve). */
  external: 1 | 2
}

/** Diferença de itens a partir da qual vale quebrar o card mais longo em duas colunas. */
export const SCORE_CARD_BALANCE_GAP = 3

export function balanceScoreCardColumns({
  calcCount,
  externalCount,
}: {
  calcCount: number
  externalCount: number
}): ScoreCardColumns {
  // Sem avaliações externas o card de notas fica sozinho (e limitado a max-w-3xl): não há
  // com quem equilibrar, então a única regra é não deixar a lista comprida à toa.
  if (externalCount <= 0) return { calc: calcCount >= 3 ? 2 : 1, external: 1 }

  const gap = externalCount - calcCount
  if (gap >= SCORE_CARD_BALANCE_GAP) return { calc: 1, external: 2 }
  if (-gap >= SCORE_CARD_BALANCE_GAP) return { calc: 2, external: 1 }
  return { calc: 1, external: 1 }
}
