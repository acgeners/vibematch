/**
 * "Esconder tags evitadas": o que vale em cada visita do /ranking e do /favorites.
 *
 * O parâmetro `hide_avoided` da URL manda quando existe (`strong`, `all` ou `off`). Sem ele, vale a
 * preferência da pessoa (`user_settings.hide_avoided_tags`, escolhida nas boas-vindas ou em
 * Preferências): ligada ⇒ `all`.
 *
 * `off` só existe por causa da preferência: com ela ligada, "sem parâmetro" já significa esconder,
 * então o botão "Não" precisa gravar um valor para desligar NESTA visita. Sem a preferência, o "Não"
 * continua limpando o parâmetro, como sempre.
 */

export type HideAvoidedMode = "off" | "strong" | "all"

/** O valor que desliga o filtro numa visita. Não corta nada: o tom do botão é o de "selecionado". */
export const HIDE_AVOIDED_OFF = "off"

export function resolveHideAvoided(param: string | null | undefined, preferHidden: boolean): HideAvoidedMode {
  if (param === "strong" || param === "all" || param === HIDE_AVOIDED_OFF) return param
  return preferHidden ? "all" : "off"
}

/** O que o botão "Não" grava na URL. */
export function hideAvoidedOffValue(preferHidden: boolean): string | null {
  return preferHidden ? HIDE_AVOIDED_OFF : null
}
