export const MAX_COMPARE_WORKS = 10

/**
 * Teto da SELEÇÃO em massa — quantas obras podem estar marcadas ao mesmo tempo.
 *
 * ⚠️ Não confunda com `MAX_COMPARE_WORKS`. Este é o teto do que as ações em LOTE
 * aguentam; aquele é o teto do que o drawer de comparação consegue mostrar lado
 * a lado. Até 2026-08-08 o /ranking usava o de comparar como teto da seleção e
 * recusava a 11ª marcação — o que fazia sentido quando a seleção só servia pra
 * comparar, e deixou de fazer quando ela passou a alimentar Favoritar, Veredito
 * IA e Prever Interesse. Hoje a seleção vai até aqui, e só o botão Comparar
 * desabilita acima de `MAX_COMPARE_WORKS`, dizendo por quê.
 *
 * O número vem do lote mais restrito: `SYNOPSIS_BATCH_MAX` do Interesse, que
 * TRUNCA silenciosamente o que passa disso (`ids.slice(0, MAX)`). Deixar a
 * seleção passar do teto do lote seria marcar 150 obras e processar 100 sem
 * nada acusar.
 */
export const MAX_SELECTION_WORKS = 100
