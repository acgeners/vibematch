import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante: rota que um workflow do GitHub BATE tem que existir em `app/` — e não pode ser
 * um alias 308 do `redirects()`.
 *
 * 🔴 O que isto pega, medido em 2026-08-22: o `healthcheck.yml` batia em
 * `https://satoria.fly.dev/sobre` exigindo 200. A renomeação de rotas de 16/08 (`/sobre` →
 * `/about`) subiu no deploy de 19/08, e a partir dali a rota respondia **308**. Resultado: de
 * 19 a 21/08 o monitor mandou **12 e-mails de falha com o banco PERFEITO** — o log de cada um
 * trazia `HTTP 200 · {"ok":true,"works":1010}` no passo 1 e reprovava no passo 2.
 *
 * ⚠️ O caro não foi o falso alarme: foi ele mascarar o alarme REAL. Em 22/08 a quota de egress
 * do Supabase estourou de novo (402 em todo endpoint) e o app passou a servir páginas em 200
 * sem dado nenhum — e o e-mail dessa falha chegou visualmente idêntico aos 12 anteriores. É
 * "alarme que sempre toca não é lido" mordendo o próprio monitor.
 *
 * ⚠️ Nada acusava, e não tinha como: `scripts/smoke-producao.mjs` já usava `/about`, mas
 * **nenhum teste cobria `.github/workflows/`**. O workflow não é compilado, não é importado e
 * não roda na suíte — só no GitHub, 4×/dia, contra produção.
 *
 * A varredura DERIVA tudo: os workflows do disco, o host do `fly.toml` e os aliases do
 * `next.config.ts`. Lista fixa aqui não acharia o workflow nem a rota de amanhã, que é
 * justamente o caso.
 */

const DIR = ".github/workflows"
const FLY = readFileSync("fly.toml", "utf8")
const NEXT_CONFIG = readFileSync("next.config.ts", "utf8")

/** O host de produção, derivado do `fly.toml` — escrito à mão aqui, seria a 2ª régua pro mesmo fato. */
function hostDeProducao(): string {
  return FLY.match(/SITE_URL\s*=\s*"https?:\/\/([^"/]+)"/)?.[1] ?? ""
}

function workflows(): string[] {
  return existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)) : []
}

/**
 * As rotas que um texto de workflow de fato BATE.
 *
 * ⚠️ Linha de comentário fica de fora de propósito: o cabeçalho do `healthcheck.yml` cita
 * `/sobre` ao contar a falha de 31/07, e ali o nome antigo é o correto — era como a rota se
 * chamava. Congelar prosa histórica seria proteger a grafia, não o fato.
 *
 * 🔴 Pura, e não lendo o arquivo direto, porque o filtro de comentário PRECISA de caso
 * próprio: com os workflows de hoje ele é inalcançável (a prosa histórica cita `/sobre` sem a
 * URL completa), então removê-lo mantinha a suíte verde. Conferido com sonda.
 */
export function rotasDoTexto(conteudo: string, host: string): { rota: string; linha: number }[] {
  if (!host) return []
  const re = new RegExp(`https?://${host.replace(/\./g, "\\.")}(/[^\\s"')\`]*)?`, "g")
  const out: { rota: string; linha: number }[] = []
  conteudo.split("\n").forEach((linha, i) => {
    if (linha.trim().startsWith("#")) return
    for (const m of linha.matchAll(re)) {
      const rota = (m[1] ?? "/").split(/[?#]/)[0]!.replace(/\/+$/, "") || "/"
      out.push({ rota, linha: i + 1 })
    }
  })
  return out
}

/** A rota resolve a um `page.tsx`/`route.ts` real? Segmento dinâmico (`[id]`) conta. */
function existeEmApp(rota: string): boolean {
  let dir = "app"
  for (const seg of rota.split("/").filter(Boolean)) {
    if (!existsSync(dir)) return false
    const entradas = readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory())
    const escolhido = entradas.includes(seg) ? seg : entradas.find((e) => /^\[.+\]$/.test(e))
    if (!escolhido) return false
    dir = join(dir, escolhido)
  }
  return existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"))
}

/** Os `source:` do `redirects()` — quem cai neles responde 308, nunca 200. */
function aliasQueCobre(rota: string): string | null {
  const i = NEXT_CONFIG.indexOf("async redirects()")
  if (i < 0) return null
  for (const m of NEXT_CONFIG.slice(i).matchAll(/source:\s*"([^"]+)"/g)) {
    const src = m[1]!
    const base = src.replace(/\/:path\*$/, "")
    if (rota === base || (src.endsWith("/:path*") && rota.startsWith(`${base}/`))) return src
  }
  return null
}

const TODAS = workflows().flatMap((arquivo) =>
  rotasDoTexto(readFileSync(join(DIR, arquivo), "utf8"), hostDeProducao()).map((r) => ({
    ...r,
    arquivo,
  })),
)

describe("workflow do GitHub bate em rota que existe", () => {
  it(`a varredura enxerga alguma coisa (hoje ${TODAS.length} rotas em ${workflows().length} workflows)`, () => {
    // Sem isto os casos abaixo passam por VACUIDADE — é como uma rede vira capacidade
    // construída e desligada.
    expect(hostDeProducao()).not.toBe("")
    expect(workflows().length).toBeGreaterThan(0)
    expect(TODAS.length).toBeGreaterThan(0)
  })

  it("comentário não conta como rota batida — só linha executável", () => {
    const texto = [
      "# a rota antiga era https://x.dev/sobre, e aqui o nome velho é o CERTO",
      "          curl -sS https://x.dev/about",
      "   # curl https://x.dev/leitura   (desligado)",
    ].join("\n")
    expect(rotasDoTexto(texto, "x.dev")).toEqual([{ rota: "/about", linha: 2 }])
  })

  it("query string e barra final não viram rota diferente", () => {
    const texto = "curl https://x.dev/curation/settings?g=fontes\ncurl https://x.dev/"
    expect(rotasDoTexto(texto, "x.dev").map((r) => r.rota)).toEqual(["/curation/settings", "/"])
  })

  it("toda rota batida existe em app/", () => {
    const orfas = TODAS.filter((r) => !existeEmApp(r.rota)).map(
      (r) => `${r.arquivo}:${r.linha} bate em ${r.rota}, que não existe em app/`,
    )
    expect(orfas).toEqual([])
  })

  it("nenhuma rota batida é alias 308 do next.config.ts", () => {
    const alias = TODAS.map((r) => ({ ...r, src: aliasQueCobre(r.rota) }))
      .filter((r) => r.src)
      .map(
        (r) =>
          `${r.arquivo}:${r.linha} bate em ${r.rota}, que o next.config.ts redireciona ` +
          `(source: "${r.src}") — responde 308, e o workflow exige 200`,
      )
    expect(alias).toEqual([])
  })
})
