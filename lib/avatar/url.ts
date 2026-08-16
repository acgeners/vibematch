// ============================================================================
// A fronteira de confiança do avatar montado.
//
// `user_settings.avatar_url` guarda UMA string, e ela tem exatamente três formas:
//
//   ""  ................. sem avatar (o chip cai no ícone)
//   /avatar.svg?…  ...... montado no /account — a rota redesenha a partir dos params
//   https://…  .......... imagem enviada, no bucket público `avatars`
//
// Manter tudo numa coluna só é o que permite chip, card e qualquer `<img>` futuro
// continuarem consumindo uma URL comum. Uma segunda coluna com a "configuração"
// seria um segundo dono do mesmo fato, e os dois divergiriam.
//
// 🔴 ESTE ARQUIVO É A DEFESA CONTRA INJEÇÃO. `renderAvatar` interpola as cores
// direto em atributos SVG, e a rota devolve `image/svg+xml` — que o browser executa
// como documento se alguém navegar até ele. Um `cabelo` com aspas fecharia o atributo
// e injetaria markup. Por isso a cor NUNCA chega ao renderizador sem passar por
// `/^[0-9a-fA-F]{6}$/`, e o estilo sem existir em `ESTILO_POR_ID`. Valor fora da
// régua não é erro: vira o padrão, silenciosamente, porque uma URL velha de uma
// paleta antiga tem que continuar desenhando alguém.
// ============================================================================

import { CONFIG_PADRAO, ESTILO_POR_ID } from "@/lib/avatar/render"
import type { AvatarConfig } from "@/lib/avatar/render"

export const AVATAR_ROTA = "/avatar.svg"

const HEX = /^[0-9a-fA-F]{6}$/

/** `"C9497E"` | `"#C9497E"` → `"#c9497e"`; qualquer outra coisa → `padrao`. */
function corValida(bruta: string | null | undefined, padrao: string): string {
  const limpa = (bruta ?? "").trim().replace(/^#/, "")
  return HEX.test(limpa) ? `#${limpa.toLowerCase()}` : padrao
}

/**
 * Aceita qualquer entrada e devolve uma config SEGURA de renderizar.
 * Nunca lança e nunca devolve campo fora da régua — é o único caminho até
 * `renderAvatar` a partir de dado externo.
 */
export function sanitizeAvatarConfig(
  bruta: Partial<Record<keyof AvatarConfig, string | null>>,
): AvatarConfig {
  const estilo = bruta.estilo ?? ""
  return {
    estilo: estilo in ESTILO_POR_ID ? estilo : CONFIG_PADRAO.estilo,
    cabelo: corValida(bruta.cabelo, CONFIG_PADRAO.cabelo),
    pele: corValida(bruta.pele, CONFIG_PADRAO.pele),
    olhos: corValida(bruta.olhos, CONFIG_PADRAO.olhos),
    fundo: corValida(bruta.fundo, CONFIG_PADRAO.fundo),
  }
}

/** config → a URL que vai pro banco. Cores sem `#`, que em query string vira `%23`. */
export function avatarConfigToUrl(config: AvatarConfig): string {
  const c = sanitizeAvatarConfig(config)
  const params = new URLSearchParams({
    estilo: c.estilo,
    cabelo: c.cabelo.slice(1),
    pele: c.pele.slice(1),
    olhos: c.olhos.slice(1),
    fundo: c.fundo.slice(1),
  })
  return `${AVATAR_ROTA}?${params}`
}

/** É um avatar montado por nós (e não um upload nem vazio)? */
export function isBuiltAvatarUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(`${AVATAR_ROTA}?`)
}

/**
 * URL do banco → config, pra reabrir o editor no estado em que a pessoa deixou.
 * É a razão de a configuração não precisar de coluna própria: ela ESTÁ na URL.
 */
export function parseAvatarUrl(url: string | null | undefined): AvatarConfig | null {
  if (!isBuiltAvatarUrl(url)) return null
  const params = new URLSearchParams(url!.slice(url!.indexOf("?") + 1))
  return sanitizeAvatarConfig({
    estilo: params.get("estilo"),
    cabelo: params.get("cabelo"),
    pele: params.get("pele"),
    olhos: params.get("olhos"),
    fundo: params.get("fundo"),
  })
}

/**
 * O que `user_settings.avatar_url` pode conter. Usado pelo schema do formulário.
 *
 * ⚠️ O campo de texto livre de URL SAIU do /account — hoje só o painel e o upload
 * escrevem aqui. A validação continua porque a action é um endpoint HTTP público
 * (ver [[project_use_server_public_endpoints]]): esconder o campo não fecha a porta.
 */
export function isValidAvatarUrl(valor: string): boolean {
  const v = valor.trim()
  if (v === "") return true
  if (isBuiltAvatarUrl(v)) return true
  try {
    const u = new URL(v)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}
