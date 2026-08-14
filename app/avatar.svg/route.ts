import { renderAvatar } from "@/lib/avatar/render"
import { sanitizeAvatarConfig } from "@/lib/avatar/url"

/**
 * Desenha o avatar montado a partir da query string.
 *
 * A imagem é DERIVADA da URL, e é isso que dispensa Storage, coluna nova e um arquivo
 * por usuário: `user_settings.avatar_url` guarda `/avatar.svg?estilo=…&cabelo=…`, e
 * todo consumidor (`components/layout/account-chip.tsx`, o card de /conta, qualquer
 * `<img>` futuro) continua recebendo uma URL comum.
 *
 * ⚠️ O nome do diretório é literalmente `avatar.svg`, e não é estética. O matcher do
 * `middleware.ts` exclui `.*\.(svg|png|…)$`, então esta rota não paga um refresh de
 * sessão a cada carregamento do chip. Movê-la para `/api/avatar` reintroduz esse custo
 * em toda navegação, em silêncio.
 *
 * 🔴 Todo parâmetro passa por `sanitizeAvatarConfig` ANTES do renderizador, que
 * interpola cor direto em atributo SVG. Como a resposta é `image/svg+xml` — documento
 * executável se alguém navegar até ele —, uma cor com aspas seria injeção de markup.
 * Entrada fora da régua não dá erro: vira o padrão, para que URL antiga siga desenhando.
 */
export function GET(request: Request): Response {
  const { searchParams } = new URL(request.url)
  const config = sanitizeAvatarConfig({
    estilo: searchParams.get("estilo"),
    cabelo: searchParams.get("cabelo"),
    pele: searchParams.get("pele"),
    olhos: searchParams.get("olhos"),
    fundo: searchParams.get("fundo"),
  })

  return new Response(renderAvatar(config), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // A URL determina a imagem INTEIRA, então ela nunca muda de conteúdo: trocar de
      // avatar troca de URL. Daí `immutable` — sem revalidação e sem custo por página.
      "cache-control": "public, max-age=31536000, immutable",
      // Defesa em profundidade sobre o sanitize: mesmo que algo escapasse, o SVG não
      // consegue buscar nem executar nada, e o browser não pode reinterpretar o tipo.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  })
}
