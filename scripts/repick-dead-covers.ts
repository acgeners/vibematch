/**
 * Repesca a capa principal das obras cuja capa EXIBIDA está morta (link 403/404/DNS).
 *
 * 🔴 ALVO: NUVEM — este script GRAVA no catálogo (`work_covers.is_primary`). Rodá-lo contra o
 * local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *
 *   # ensaio (PADRÃO): imprime o plano e não grava nada
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/repick-dead-covers.ts
 *
 *   # aplica
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/repick-dead-covers.ts --execute
 *
 * ⚠️ US$0: só HTTP contra os CDNs de capa. Nenhuma chamada de modelo.
 *
 * ## Por que existe
 *
 * Medido em 15/08/2026 sobre as 988 obras com capa: **29 (2,9%) exibiam capa morta**, e em
 * **21** delas havia alternativa VIVA na própria `work_covers` — o app tinha a capa boa na mão
 * e desenhava o traço. **23 das 29 são `static.comix.to`**, que caiu inteiro no Cloudflare de
 * 11/08 (0 de 15 numa amostra respondem 200): o mesmo evento que o CLAUDE.md registra por ter
 * matado o fetch de reviews da Comix levou as capas junto, e ninguém percebeu porque nada
 * acusa — o `<img>` só não pinta.
 *
 * O `<CoverImage urls>` cai pra próxima capa no `onError`, mas isso conserta uma TELA por vez
 * (34 pontos de uso passam uma URL só). Consertar o DADO conserta as 34 de uma vez.
 */
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { measureCover, scoreCover } from "@/lib/server/covers/measure-cover"
import { pickCoverUrls } from "@/lib/work-derived"
// O dono da retenção de `.backups` é ÚNICO — ver scripts/lib/backups-retencao.mjs.
import { podar } from "./lib/backups-retencao.mjs"

const EXECUTAR = process.argv.includes("--execute")
const CONCORRENCIA = 24

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface CoverRow {
  id: string
  work_id: string
  url: string | null
  is_primary: boolean | null
  position: number | null
}

/**
 * ⚠️ Paginado obrigatoriamente: `work_covers` tem ~4,1 mil linhas e o `select` do PostgREST
 * corta em 1000 SEM avisar. Truncado aqui, obras inteiras sumiriam do plano e o script diria
 * "nada a fazer" — o erro que produz resultado.
 */
async function lerTodasAsCapas(): Promise<CoverRow[]> {
  const out: CoverRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("work_covers")
      .select("id, work_id, url, is_primary, position")
      .order("id")
      .range(from, from + 999)
    if (error) throw new Error(`work_covers: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as CoverRow[]))
    if (data.length < 1000) break
  }
  return out
}

const cache = new Map<string, Promise<boolean>>()

/**
 * A capa carrega?
 *
 * 🔴 Decide pela ASSINATURA do arquivo, nunca pelo `content-type`: a Tappytoon devolve
 * `image` (sem a barra) num JPEG perfeitamente válido, e um `startsWith("image/")` reprovou
 * 2 capas boas na primeira medição. O header é o que o servidor ALEGA; os bytes são o fato.
 * Do outro lado, o Cloudflare devolve **200 em alguns casos e 403 com `text/html`** — daí não
 * bastar o status.
 */
function carrega(url: string): Promise<boolean> {
  const emCache = cache.get(url)
  if (emCache) return emCache
  const p = (async () => {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const ac = new AbortController()
        const t = setTimeout(() => ac.abort(), 15000)
        // GET e não HEAD: vários CDNs de capa devolvem 403/405 a HEAD mesmo servindo a imagem.
        const r = await fetch(url, {
          signal: ac.signal,
          headers: { "user-agent": "Mozilla/5.0", accept: "image/*,*/*" },
        })
        clearTimeout(t)
        if (!r.ok || !r.body) {
          await r.body?.cancel().catch(() => {})
          return false
        }
        const leitor = r.body.getReader()
        const { value } = await leitor.read()
        await leitor.cancel().catch(() => {})
        const h = [...(value ?? new Uint8Array()).slice(0, 12)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
        return (
          h.startsWith("ffd8ff") || // JPEG
          h.startsWith("89504e47") || // PNG
          h.startsWith("474946") || // GIF
          (h.startsWith("52494646") && h.slice(16, 24) === "57454250") || // RIFF…WEBP
          h.slice(8, 16) === "66747970" // ftyp (AVIF/HEIC)
        )
      } catch {
        if (tentativa === 1) return false
      }
    }
    return false
  })()
  cache.set(url, p)
  return p
}

async function emLotes<T, R>(itens: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < itens.length; i += n) {
    out.push(...(await Promise.all(itens.slice(i, i + n).map(fn))))
    process.stderr.write(`${Math.min(i + n, itens.length)}/${itens.length}\r`)
  }
  return out
}

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("FATAL: sem SUPABASE_SERVICE_ROLE_KEY — use --env-file=.env.local")
    process.exit(1)
  }
  console.log(`alvo: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(EXECUTAR ? "modo: EXECUTAR (grava)\n" : "modo: ensaio (--execute para gravar)\n")

  const capas = await lerTodasAsCapas()
  const porObra = new Map<string, CoverRow[]>()
  for (const c of capas) {
    const lista = porObra.get(c.work_id)
    if (lista) lista.push(c)
    else porObra.set(c.work_id, [c])
  }
  console.log(`${capas.length} capas em ${porObra.size} obras`)

  // ⚠️ A ordem vem do `pickCoverUrls`, o MESMO dono que a UI usa (e que casa com o
  // `order by is_primary desc, position asc` da RPC `find_similar_works`). Reimplementar a
  // ordenação aqui seria um 2º critério pro mesmo fato: o script repescaria com uma régua e
  // a tela mostraria com outra.
  const plano: {
    workId: string
    titulo: string
    de: { id: string; url: string } | null
    para: { id: string; url: string; largura: number | null }
    descartadas: (number | null)[]
  }[] = []
  const semSaida: { workId: string; titulo: string; capas: number }[] = []

  const trabalho = [...porObra.entries()]
  await emLotes(trabalho, CONCORRENCIA, async ([workId, linhas]) => {
    const urls = pickCoverUrls(linhas)
    if (urls.length === 0) return
    if (await carrega(urls[0])) return // a capa exibida está viva: nada a fazer

    const vivas: string[] = []
    for (const u of urls.slice(1)) if (await carrega(u)) vivas.push(u)
    if (vivas.length === 0) {
      semSaida.push({ workId, titulo: workId, capas: urls.length })
      return
    }

    // 🔴 A MELHOR viva, não a PRÓXIMA da ordem. Pegar a próxima promovia lixo: no ensaio
    // de 15/08 ela escolheu uma miniatura do Google Imagens (`encrypted-tbn0.gstatic.com`)
    // e um `i.pinimg.com` de 736px, tendo CDN de verdade na mesma lista. `scoreCover` é o
    // dono dessa régua (resolução ordena; compressão e proporção só penalizam) e já foi
    // calibrado contra as 2.307 capas do catálogo — reinventar aqui seria um 2º critério.
    const medidas = await Promise.all(
      vivas.map(async (u) => {
        const m = await measureCover(u).catch(() => null)
        // −1, e não 0, pra que "não deu pra medir" perca de qualquer capa medível e o
        // desempate caia na ordem original (o `reduce` abaixo mantém o primeiro no empate).
        // −2 pro cache do Google Imagens: essas URLs EXPIRAM, então promovê-la a principal
        // recria o defeito que este script existe pra consertar. Não é preferência de fonte
        // (a ordem por fonte já foi medida e reprovada em 2026-07-12) — é que `tbn` não é
        // fonte nenhuma, é um proxy temporário de uma. Só vale como desempate: uma capa
        // MEDÍVEL sempre ganha dela, e ela ainda ganha de não ter capa.
        const ehCacheDoGoogle = /(^|\.)encrypted-tbn\d*\.gstatic\.com$/.test(new URL(u).hostname)
        return {
          url: u,
          score: m ? scoreCover(m) : ehCacheDoGoogle ? -2 : -1,
          largura: m?.width ?? null,
        }
      }),
    )
    const melhor = medidas.reduce((a, b) => (b.score > a.score ? b : a))

    const atual = linhas.find((l) => l.is_primary) ?? null
    const nova = linhas.find((l) => l.url === melhor.url)!
    plano.push({
      workId,
      titulo: workId,
      de: atual ? { id: atual.id, url: atual.url! } : null,
      para: { id: nova.id, url: melhor.url, largura: melhor.largura },
      descartadas: medidas.filter((m) => m.url !== melhor.url).map((m) => m.largura),
    })
  })

  // ⚠️ Os títulos vêm SÓ agora, e só das obras afetadas (~30). Um `.in("id", …)` com as 990
  // estoura o comprimento da URL e o PostgREST devolve `Bad Request` — é a mesma armadilha
  // que este repo já documenta em `.in("id")` + embeds.
  const afetadas = [...plano.map((p) => p.workId), ...semSaida.map((s) => s.workId)]
  if (afetadas.length > 0) {
    const { data: obras, error: errObras } = await sb
      .from("works")
      .select("id, title")
      .in("id", afetadas)
    if (errObras) throw new Error(`works: ${errObras.message}`)
    const tituloPor = new Map((obras ?? []).map((w) => [w.id as string, w.title as string]))
    for (const p of plano) p.titulo = tituloPor.get(p.workId) ?? p.workId
    for (const s of semSaida) s.titulo = tituloPor.get(s.workId) ?? s.workId
  }

  plano.sort((a, b) => a.titulo.localeCompare(b.titulo))
  console.log(`\n\n${plano.length} obra(s) com capa morta E alternativa viva:\n`)
  for (const p of plano) {
    console.log(`  ${p.titulo}`)
    console.log(`    de:   ${p.de?.url ?? "(sem primária)"}`)
    console.log(`    para: ${p.para.url}  [${p.para.largura ?? "?"}px${
      p.descartadas.length ? `, preterindo ${p.descartadas.map((d) => `${d ?? "?"}px`).join(" / ")}` : ""
    }]`)
  }
  if (semSaida.length) {
    console.log(`\n${semSaida.length} obra(s) SEM nenhuma capa viva — precisam de capa nova:`)
    for (const s of semSaida.sort((a, b) => a.titulo.localeCompare(b.titulo))) {
      console.log(`  ${s.titulo}  (${s.capas} capa(s), todas mortas)`)
    }
  }

  if (!EXECUTAR) {
    console.log("\nensaio — nada gravado. Repita com --execute para aplicar.")
    return
  }
  if (plano.length === 0) {
    console.log("\nnada a gravar.")
    return
  }

  // Snapshot ANTES de escrever: é a única rede pra desfazer (o banco não tem PITR).
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = path.resolve(process.cwd(), ".backups", `repick-cover-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "plano.json"), JSON.stringify(plano, null, 2))
  console.log(`\nestado anterior salvo em ${path.relative(process.cwd(), dir)}/plano.json`)

  let ok = 0
  for (const p of plano) {
    // 🔴 Despromover ANTES de promover: `work_covers_one_primary` é UNIQUE parcial em
    // (work_id) WHERE is_primary — na ordem inversa o segundo update viola o índice e a obra
    // fica com a capa morta. Se o 2º passo falhar, a obra fica com ZERO primária, que é
    // estado válido (o `pickCoverUrls` cai pra `position`) e o re-run conserta.
    if (p.de) {
      const { error } = await sb.from("work_covers").update({ is_primary: false }).eq("id", p.de.id)
      if (error) {
        console.error(`  ✗ ${p.titulo}: despromover falhou — ${error.message}`)
        continue
      }
    }
    const { error } = await sb.from("work_covers").update({ is_primary: true }).eq("id", p.para.id)
    if (error) {
      console.error(`  ✗ ${p.titulo}: promover falhou — ${error.message}`)
      continue
    }
    ok++
  }
  console.log(`\n✅ ${ok}/${plano.length} obra(s) com capa principal repescada`)
  podar("repick-cover")
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
