/**
 * O que o jsdom não implementa e todo navegador implementa. Fica aqui, e não em cada teste, porque a
 * falta aparece DEPOIS do teste: `external-search.tsx` chama `scrollIntoView` dentro de um
 * `requestAnimationFrame`, e o erro estourava como "Errors 1 error" no rodapé da suíte com todos os
 * testes passando — o ruído que faz um erro real novo passar por ele.
 *
 * `??=`: teste que precisa espionar a chamada (`vi.fn()`) continua podendo trocar.
 */
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView ??= function scrollIntoView() {}
}
