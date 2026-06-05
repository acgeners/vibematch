/**
 * Visibilidade do A/B de modelo na UI (cliente).
 *
 * Quando `false`, os botões de Haiku ficam ocultos — o Haiku se mostrou pior
 * nesta rubrica (infla tragédia/adult pro neutro 5, drift conservador nos
 * positivos e confiança menor). Todo o código do A/B continua no lugar
 * (override `haiku`, componente de comparação): isto controla SÓ a visibilidade.
 *
 * Volte para `true` pra reexibir "Reavaliar com Haiku 4.5" (review form) e
 * "Comparar com Haiku 4.5" (página da obra).
 */
export const SHOW_HAIKU_AB: boolean = false
