/**
 * TESTE CEGO do avaliador de capas.
 *
 *   # 1) gera a página (amostra aleatória, semente fixa → reproduzível)
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/blind-cover-test.ts
 *   → .local-experiments/blind-cover-test.html
 *
 *   # 2) você vota, baixa o JSON, e eu apuro
 *   npx tsx ... scripts/blind-cover-test.ts --apurar=<caminho do votos.json>
 *
 * O QUE ESTÁ SENDO MEDIDO
 *
 * O avaliador (`scoreCover`) JÁ ESTÁ EM PRODUÇÃO: toda obra nova tem a capa principal escolhida
 * por ele (`rankCoversByMeasuredQuality` → `fetchMultiSourceDetails`). A pergunta não é "vale a
 * pena ligar?", é "o que já está ligado acerta?".
 *
 * POR QUE CEGO E EM ORDEM ALEATÓRIA
 *
 * Qualquer rótulo contamina o voto: "atual", "proposta", o score, e até o NOME DA FONTE (quem já
 * sabe que o MangaUpdates entrega miniatura vai evitá-lo sem olhar). O voto tem que ser da IMAGEM,
 * não do que eu sei sobre ela.
 *
 * POR QUE TODAS AS CAPAS, E NÃO SÓ DUAS
 *
 * Mostrar "atual × proposta" é escolha forçada: esconde o caso em que a melhor capa é uma TERCEIRA,
 * que nenhum dos dois escolheu — e aí o erro do avaliador fica invisível. A tarefa real dele é
 * "escolher a melhor entre N", e o teste tem que imitar a tarefa real.
 *
 * POR QUE O BOTÃO "EMPATADAS"
 *
 * Sem ele, obra cujas capas são equivalentes vira voto no cara-ou-coroa — e esse ruído entra na
 * conta como erro do avaliador. Empate é uma resposta legítima e sai do denominador.
 *
 * O BASELINE
 *
 * Acerto absoluto não decide nada sozinho: com 2 capas o ACASO acerta 50%. Por isso a apuração
 * compara três escolhedores na MESMA amostra — o avaliador novo, a regra ANTIGA (prioridade por
 * fonte) e o acaso.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"
import { measureCover, scoreCover, type CoverMeasurement } from "@/lib/server/covers/measure-cover"

const N_AMOSTRA = 40
/**
 * Semente fixa: a amostra é reproduzível, e não dá pra "tentar de novo até dar bom".
 *
 * Trocada de 20260714 → 20260715 por um motivo específico e verificado: no sorteio anterior a capa
 * ATUAL caía na 1ª posição em 23 das 39 obras (esperado ~15). Simulei 20 mil sorteios e a média deu
 * 15,3 — batendo com a teoria, o que PROVA que o embaralhamento é uniforme; aquele sorteio era só um
 * evento de 1%. Mesmo assim não vale rodar o experimento nele: se a capa atual aparece em 1º em 59%
 * das obras e o humano tiver qualquer tendência a clicar na primeira, o voto contamina o resultado.
 * Trocar a semente é de graça; contaminar o experimento, não.
 */
const SEMENTE = 20260715

/** A ordem por fonte que existia ANTES — é o baseline a bater. */
const PRIORIDADE_ANTIGA: Record<string, number> = {
  mangaupdates: 0, anilist: 1, myanimelist: 2, kitsu: 3, comick: 4,
  animeplanet: 5, mangadex: 6, comix: 7, mangago: 8,
}

/** PRNG determinístico (mulberry32) — `Math.random()` tornaria a amostra irreproduzível. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const shuffle = <T,>(arr: T[], r: () => number): T[] => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Wilson: intervalo de confiança 95% honesto pra proporção com n pequeno (Wald mente aqui). */
function wilson(acertos: number, n: number): [number, number] {
  if (n === 0) return [0, 0]
  const z = 1.96, p = acertos / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)]
}

type Capa = { id: string; url: string; source: string; is_primary: boolean; m: CoverMeasurement | null; score: number }

async function amostra() {
  const sb = createAdminClient()
  const rows: Array<{ id: string; work_id: string; url: string; source: string; is_primary: boolean }> = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb
      .from("work_covers").select("id, work_id, url, source, is_primary").order("id").range(f, f + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...(data as typeof rows))
    if (data.length < 1000) break
  }
  const { count } = await sb.from("work_covers").select("*", { count: "exact", head: true })
  if (rows.length !== count) throw new Error(`paginação truncou: ${rows.length} de ${count}`)

  const { data: works } = await sb.from("works").select("id, title")
  const titulo = new Map((works ?? []).map((w) => [w.id as string, w.title as string]))

  const porObra = new Map<string, typeof rows>()
  for (const r of rows) porObra.set(r.work_id, [...(porObra.get(r.work_id) ?? []), r])

  // Elegíveis: 2+ capas. Obra de capa única não tem escolha a fazer — incluí-la seria acerto de graça.
  const elegiveis = [...porObra.entries()].filter(([, cs]) => cs.length >= 2)
  const r = rng(SEMENTE)
  const sorteadas = shuffle(elegiveis, r).slice(0, N_AMOSTRA)

  console.log(`${elegiveis.length} obras elegíveis (2+ capas) · sorteando ${sorteadas.length}\n`)

  const casos: Array<{ workId: string; work: string; capas: Capa[] }> = []
  for (const [workId, cs] of sorteadas) {
    const capas: Capa[] = await Promise.all(
      cs.map(async (c) => {
        const m = await measureCover(c.url).catch(() => null)
        return { id: c.id, url: c.url, source: c.source, is_primary: c.is_primary, m, score: m ? scoreCover(m) : -1 }
      }),
    )
    // Descarta capa morta: o voto é sobre QUALIDADE, não sobre disponibilidade.
    const vivas = capas.filter((c) => c.m != null)
    if (vivas.length < 2) continue
    casos.push({ workId, work: titulo.get(workId) ?? workId.slice(0, 8), capas: vivas })
    process.stdout.write(`\r  ${casos.length}/${sorteadas.length}`)
  }
  console.log("\n")

  // A ORDEM EXIBIDA é embaralhada por obra — e é ela que vai no gabarito, pra o voto (um índice
  // de exibição) poder ser mapeado de volta pra capa certa na apuração.
  const paginas = casos.map((c) => ({ ...c, exibicao: shuffle(c.capas, r) }))

  const gabarito = paginas.map((p) => ({
    workId: p.workId,
    work: p.work,
    exibicao: p.exibicao.map((c) => ({
      id: c.id, url: c.url, source: c.source, score: c.score,
      w: c.m!.width, h: c.m!.height, is_primary: c.is_primary,
    })),
  }))
  writeFileSync(".local-experiments/blind-gabarito.json", JSON.stringify(gabarito, null, 2))

  const card = (p: (typeof paginas)[number], i: number) => `
  <div class="obra" data-i="${i}">
    <div class="cab"><span class="num">${i + 1}/${paginas.length}</span> ${esc(p.work)}
      <span class="pend">— clique na MELHOR capa</span></div>
    <div class="capas">
      ${p.exibicao
        .map(
          (c, j) => `<div class="op" data-j="${j}"><img src="${esc(c.url)}" loading="lazy" alt=""></div>`,
        )
        .join("")}
      <button class="empate" data-i="${i}">empatadas /<br>não dá pra decidir</button>
    </div>
  </div>`

  const html = `<!doctype html><meta charset="utf-8">
<title>Teste cego — o avaliador de capas acerta?</title>
<style>
  body{font:14px/1.55 -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#0b0d10;color:#e6e8eb}
  h1{font-size:20px;margin:0 0 6px}
  .intro{background:#12151a;border:1px solid #242830;border-radius:10px;padding:14px 16px;margin-bottom:8px;max-width:900px}
  #barra{position:sticky;top:0;z-index:9;background:#12151a;border:1px solid #2f3540;border-radius:10px;
         padding:10px 14px;margin:14px 0;display:flex;gap:12px;align-items:center}
  #cont{font-weight:600}
  #btn{background:#16a34a;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer}
  #btn:disabled{background:#374151;cursor:not-allowed}
  .obra{background:#12151a;border:1px solid #242830;border-radius:10px;padding:12px 14px;margin-bottom:10px}
  .obra.votada{opacity:.42}
  .cab{font-weight:600;margin-bottom:10px}
  .num{background:#242830;padding:1px 8px;border-radius:99px;font-size:12px;color:#9aa3af;margin-right:6px}
  .pend{color:#9aa3af;font-weight:400;font-size:12px}
  .capas{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
  .op{cursor:pointer;border:3px solid transparent;border-radius:8px;padding:2px;transition:border-color .1s}
  .op:hover{border-color:#4b5563}
  .op.sel{border-color:#16a34a}
  /* 🔴 LARGURA FIXA, nao max-width. Com max-width o browser ENCOLHE todas pro mesmo tamanho, e
     uma capa de 275px fica visualmente IDENTICA a uma de 2160px — o teste mediria nada. Largura
     fixa faz a miniatura ser ESTICADA e aparecer borrada, que e exatamente como ela aparece no
     app. O julgamento tem que ver o que o usuario ve. */
  .op img{display:block;width:420px;height:auto;border-radius:5px;background:#1c1f26}
  .empate{background:#1c1f26;color:#9aa3af;border:1px dashed #3a4150;border-radius:8px;padding:24px 16px;
          cursor:pointer;font:inherit;font-size:13px;min-width:130px;align-self:center}
  .empate.sel{border-color:#16a34a;color:#86efac}
</style>
<h1>Teste cego — o avaliador de capas acerta?</h1>
<div class="intro">
  <b>Clique na melhor capa de cada obra.</b> As imagens estão em ordem aleatória e sem rótulo: você
  não sabe qual é a atual, qual o avaliador escolheu, nem de que fonte veio. É de propósito — saber
  qualquer uma dessas coisas contamina o voto.<br><br>
  Julgue como <b>capa</b>: arte de capa de verdade, boa resolução, enquadramento certo. Um painel
  interno grande <b>não</b> é uma boa capa. As imagens são exibidas todas na MESMA largura — se uma
  parecer borrada, é porque ela é pequena e está sendo esticada, igualzinho ao que acontece no app. Se forem equivalentes, use <b>"empatadas"</b> — chutar
  vira ruído e o ruído entra na conta como erro do avaliador.
</div>
<div id="barra">
  <span id="cont"></span>
  <button id="btn" disabled>Baixar votos</button>
  <span id="dica" style="color:#9aa3af;font-size:12px">→ me mande o arquivo</span>
</div>
${paginas.map(card).join("")}
<script>
  const N = ${paginas.length}
  const votos = {}
  const atualiza = () => {
    const n = Object.keys(votos).length
    document.getElementById("cont").textContent = n + " de " + N + " obras votadas"
    document.getElementById("btn").disabled = n < N
  }
  document.addEventListener("click", (e) => {
    const op = e.target.closest(".op")
    const emp = e.target.closest(".empate")
    if (!op && !emp) return
    const obra = e.target.closest(".obra")
    const i = +obra.dataset.i
    obra.querySelectorAll(".op, .empate").forEach((x) => x.classList.remove("sel"))
    if (op) { op.classList.add("sel"); votos[i] = +op.dataset.j }
    else { emp.classList.add("sel"); votos[i] = "empate" }
    obra.classList.add("votada")
    atualiza()
  })
  document.getElementById("btn").onclick = () => {
    const blob = new Blob([JSON.stringify(votos, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "blind-votos.json"
    a.click()
  }
  atualiza()
</script>`

  mkdirSync(".local-experiments", { recursive: true })
  writeFileSync(".local-experiments/blind-cover-test.html", html)
  console.log(`✅ ${paginas.length} obras · ${paginas.reduce((s, p) => s + p.exibicao.length, 0)} capas`)
  console.log(`→ .local-experiments/blind-cover-test.html   (abra e vote)`)
  console.log(`→ .local-experiments/blind-gabarito.json     (o gabarito — não abra antes de votar 🙂)`)
}

function apurar(caminho: string) {
  type Gab = {
    workId: string; work: string
    exibicao: Array<{ id: string; url: string; source: string; score: number; w: number; h: number; is_primary: boolean }>
  }
  const gabarito: Gab[] = JSON.parse(readFileSync(".local-experiments/blind-gabarito.json", "utf8"))
  const votos: Record<string, number | "empate"> = JSON.parse(readFileSync(caminho, "utf8"))

  const pct = (a: number, n: number) => (n ? ((a / n) * 100).toFixed(0) : "—")
  const ic = (a: number, n: number) => {
    const [lo, hi] = wilson(a, n)
    return `[${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%]`
  }

  let n = 0, empates = 0
  let acertoNovo = 0, acertoAntigo = 0, acertoAtual = 0, acasoEsperado = 0
  const erros: string[] = []
  // pareado: onde os dois DISCORDAM, quem venceu?
  let novoGanha = 0, antigoGanha = 0

  for (const [i, g] of gabarito.entries()) {
    const v = votos[String(i)]
    if (v === undefined) continue
    if (v === "empate") { empates++; continue }
    n++

    const humano = g.exibicao[v as number]
    const novo = g.exibicao.reduce((a, b) => (b.score > a.score ? b : a))
    const antigo = g.exibicao.reduce((a, b) =>
      (PRIORIDADE_ANTIGA[b.source] ?? 99) < (PRIORIDADE_ANTIGA[a.source] ?? 99) ? b : a,
    )
    const atual = g.exibicao.find((c) => c.is_primary) ?? g.exibicao[0]

    const okNovo = novo.id === humano.id
    const okAntigo = antigo.id === humano.id
    if (okNovo) acertoNovo++
    if (okAntigo) acertoAntigo++
    if (atual.id === humano.id) acertoAtual++
    acasoEsperado += 1 / g.exibicao.length

    if (okNovo && !okAntigo) novoGanha++
    if (!okNovo && okAntigo) antigoGanha++

    if (!okNovo) {
      erros.push(
        `  ${g.work.slice(0, 38).padEnd(40)}` +
          `você: [${humano.source}] ${humano.w}×${humano.h}   ` +
          `avaliador: [${novo.source}] ${novo.w}×${novo.h}`,
      )
    }
  }

  console.log(`\n${"═".repeat(74)}`)
  console.log(`  ${n} obras julgadas · ${empates} empates (fora do denominador)`)
  console.log("═".repeat(74))
  console.log(`\n  ${"escolhedor".padEnd(28)} ${"acerto".padStart(8)}   IC 95%`)
  console.log(`  ${"AVALIADOR (o que está no ar)".padEnd(28)} ${(pct(acertoNovo, n) + "%").padStart(8)}   ${ic(acertoNovo, n)}`)
  console.log(`  ${"regra ANTIGA (por fonte)".padEnd(28)} ${(pct(acertoAntigo, n) + "%").padStart(8)}   ${ic(acertoAntigo, n)}`)
  console.log(`  ${"capa que está no app hoje".padEnd(28)} ${(pct(acertoAtual, n) + "%").padStart(8)}   ${ic(acertoAtual, n)}`)
  console.log(`  ${"ACASO (chute)".padEnd(28)} ${(pct(acasoEsperado, n) + "%").padStart(8)}`)

  console.log(`\n  Pareado (só onde os dois discordam):`)
  console.log(`    avaliador certo, regra antiga errada : ${novoGanha}`)
  console.log(`    regra antiga certa, avaliador errado : ${antigoGanha}`)

  if (erros.length) {
    console.log(`\n  🔴 Onde o avaliador ERROU (${erros.length}):\n`)
    console.log(erros.join("\n"))
  }

  const [lo] = wilson(acertoNovo, n)
  console.log(`\n${"─".repeat(74)}`)
  if (lo >= 0.7) console.log("  ✅ o piso do intervalo é ≥70% — dá pra confiar e seguir com ele.")
  else if (wilson(acertoNovo, n)[1] < 0.6) console.log("  🔴 o TETO do intervalo é <60% — não dá pra confiar. Mexer ou desligar.")
  else console.log("  ⚠️  zona cinzenta — o intervalo não separa. Vale rodar mais 40 obras.")
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--apurar="))
  if (arg) apurar(arg.slice("--apurar=".length))
  else await amostra()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
