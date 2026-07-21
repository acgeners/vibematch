/**
 * Abaixo disso a capa aparece serrilhada na página da obra. Metade das capas do
 * catálogo cai aqui (1.206 de 2.307), então vale sinalizar em vez de só ordenar.
 *
 * Mora neste módulo, e não junto de `measureCover`, porque `lib/server/covers/*`
 * é server-only e quem precisa do limiar são componentes de cliente.
 */
export const SMALL_COVER_WIDTH = 500
