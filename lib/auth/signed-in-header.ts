/**
 * Cabeçalho que o middleware põe na REQUISIÇÃO repassada à página ("1" com sessão, "0" sem),
 * depois do `getUser()` que ele já faz em toda rota. O layout raiz o lê para a barra superior
 * nascer no estado certo: sem ele, quem está logado via "Entrar" e só "Catálogo" até a chamada
 * do navegador voltar (medido em 17/11/2026 em /preferences e /my-list).
 *
 * Só serve para DESENHO. Quem autoriza continua sendo o servidor, em cada action. O middleware
 * sempre sobrescreve o valor, então um cliente que mande o cabeçalho não muda nada.
 */
export const SIGNED_IN_HEADER = "x-satoria-signed-in"
