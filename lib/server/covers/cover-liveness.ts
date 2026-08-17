/**
 * "Esta capa ainda carrega?" — com TRÊS respostas, e a terceira é a que protege o dado.
 *
 * Mora aqui, e não dentro do `repick-dead-covers.ts`, porque aquele script roda `main()`
 * na importação: a régua ficava impossível de testar, e é justamente ela que decide se o
 * `--execute` sobrescreve a capa principal de uma obra.
 */

/**
 * 🔴 "não consegui perguntar" NÃO é "a capa morreu".
 *
 * Medido em 17/08/2026: uma rodada do `repick-dead-covers` acusou **98 obras com capa
 * morta**, todas em `uploads.mangadex.org`. As mesmas URLs, testadas uma a uma minutos
 * depois, responderam **200** — o que tinha caído era o DNS da máquina, esgotado pelos
 * ~1.000 lookups que o próprio script dispara com concorrência 24 (`ENOTFOUND` em 3ms,
 * enquanto `dig` resolvia o host normalmente).
 *
 * Com dois estados isso virava `false` = morta, e um `--execute` teria reescrito 98 capas
 * primárias BOAS — várias trocando CDN de verdade por thumbnail de 230px. É a pior forma
 * do erro que produz resultado: o relatório sai plausível e bem formatado, e destrói
 * exatamente o dado que o script existe pra proteger.
 */
export type EstadoDaCapa = "viva" | "morta" | "indeterminada"

const TIMEOUT_MS = 15_000

/** Assinaturas de arquivo de imagem, em hex, no começo do corpo. */
function pareceImagem(hex: string): boolean {
  return (
    hex.startsWith("ffd8ff") || // JPEG
    hex.startsWith("89504e47") || // PNG
    hex.startsWith("474946") || // GIF
    (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") || // RIFF…WEBP
    hex.slice(8, 16) === "66747970" // ftyp (AVIF/HEIC)
  )
}

const cache = new Map<string, Promise<EstadoDaCapa>>()

/** Só para testes: o cache é por processo e vazaria entre casos. */
export function limparCacheDeSondagem(): void {
  cache.clear()
}

/**
 * A capa carrega?
 *
 * 🔴 Decide pela ASSINATURA do arquivo, nunca pelo `content-type`: a Tappytoon devolve
 * `image` (sem a barra) num JPEG perfeitamente válido, e um `startsWith("image/")` reprovou
 * 2 capas boas na primeira medição. O header é o que o servidor ALEGA; os bytes são o fato.
 * Do outro lado, o Cloudflare devolve **200 em alguns casos e 403 com `text/html`** — daí
 * não bastar o status.
 *
 * ⚠️ **`morta` exige RESPOSTA do servidor.** Se o `fetch` LANÇA (DNS, conexão recusada,
 * TLS, timeout), o host não disse nada sobre esta capa e a resposta é `indeterminada` —
 * ver o 🔴 de `EstadoDaCapa`. Só um HTTP que chegou (não-ok, ou corpo que não é imagem)
 * autoriza chamar de morta.
 */
export function sondarCapa(url: string): Promise<EstadoDaCapa> {
  const emCache = cache.get(url)
  if (emCache) return emCache
  const p = (async (): Promise<EstadoDaCapa> => {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const ac = new AbortController()
        const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
        // GET e não HEAD: vários CDNs de capa devolvem 403/405 a HEAD mesmo servindo a imagem.
        const r = await fetch(url, {
          signal: ac.signal,
          headers: { "user-agent": "Mozilla/5.0", accept: "image/*,*/*" },
        })
        clearTimeout(t)
        if (!r.ok || !r.body) {
          await r.body?.cancel().catch(() => {})
          return "morta"
        }
        const leitor = r.body.getReader()
        const { value } = await leitor.read()
        await leitor.cancel().catch(() => {})
        const hex = [...(value ?? new Uint8Array()).slice(0, 12)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
        return pareceImagem(hex) ? "viva" : "morta"
      } catch {
        // Rede, não veredito. A 2ª tentativa cobre o soluço isolado; o que ela NÃO cobre é
        // o resolvedor cair de vez — e é esse caso que precisa sair daqui como
        // `indeterminada` em vez de virar uma acusação contra a capa.
        if (tentativa === 1) return "indeterminada"
      }
    }
    return "indeterminada"
  })()
  cache.set(url, p)
  return p
}
