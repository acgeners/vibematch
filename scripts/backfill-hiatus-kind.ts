/**
 * Backfill de `works.publication_status_note` + `works.hiatus_kind` (migration 183).
 *
 * O catálogo trata "Hiatus" como um estado só, mas ele cobre duas situações que levam a
 * decisões contrárias de leitura: pausa ENTRE TEMPORADAS (a temporada fechou, a próxima está
 * prometida) e publicação INTERROMPIDA no meio de uma temporada. Quem sabe a diferença é o
 * "Status in Country of Origin" do MangaUpdates — e esse texto **nunca foi persistido** no
 * catálogo: ele existia só durante o fetch e era despejado em `observations`, que mora em
 * `user_work_state` (pessoal). Logo, não há de onde reclassificar sem ir buscar.
 *
 * ⚠️ Por isso este backfill é de REDE, não de SQL. A API do MangaUpdates é pública e
 * gratuita — o custo é ~1 requisição por obra em hiato (97 em 2026-08-11, ~2 min com o
 * intervalo abaixo). Depois disto, afinar a regra e reclassificar é offline: o texto cru fica
 * guardado em `publication_status_note`.
 *
 * 🔴 Ele reescreve `publication_status_id` quando o MU discorda, e isso NÃO é escopo que
 * escapou. Medido antes de existir: das 97 obras que o catálogo dava como Hiatus, **13
 * (13,4%) já estavam `(Ongoing)` no MU** — o hiato acabou e ninguém atualizou. Gravar o tipo
 * de hiato dessas seria carimbar uma distinção sobre um estado que não existe mais; e o
 * trigger `trg_clear_hiatus_kind` zera o tipo justamente nesse caso, então sem corrigir o
 * status o backfill produziria 13 linhas com nota e sem classificação, sem explicar por quê.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA no catálogo. Rodá-lo contra o local, que é réplica
 *   descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/backfill-hiatus-kind.ts
 *   ... --execute
 *
 * Idempotente: reexecutar rebusca e regrava o mesmo valor. Sem `--execute` não escreve nada.
 */
import { createClient } from "@supabase/supabase-js"
import { classifyHiatus, hiatusFieldsFor } from "@/lib/external/hiatus-kind"
import { fetchMangaUpdatesById } from "@/lib/external/mangaupdates"

const EXECUTE = process.argv.includes("--execute")
/** Cortesia com uma API pública e gratuita — não há rate limit documentado, mas há um dono. */
const INTERVALO_MS = 150

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
const sb = createClient(url, key)

const alvo = url.includes("127.0.0.1") || url.includes("localhost") ? "LOCAL" : "NUVEM"

interface Alvo {
  id: string
  title: string
  muId: string
  statusAtual: string
}

async function carregarObrasEmHiato(): Promise<Alvo[]> {
  const { data: statusRows, error: statusErr } = await sb
    .from("publication_status")
    .select("id, status, slug")
  if (statusErr) throw new Error(`publication_status: ${statusErr.message}`)
  const hiatusId = statusRows?.find((r) => r.slug === "hiatus")?.id
  if (!hiatusId) throw new Error("publication_status não tem a linha 'hiatus'")

  // Pagina de propósito: o `select` do PostgREST corta em 1000 linhas sem avisar, e um
  // backfill que mira em menos obras do que existem termina "com sucesso" tendo feito parte
  // do trabalho — o modo de falha mais caro deste projeto.
  const obras: Alvo[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("works")
      .select("id, title, publication_status_id, work_external_ids(source, external_id)")
      .eq("publication_status_id", hiatusId)
      .range(from, from + 999)
    if (error) throw new Error(`works: ${error.message}`)
    if (!data?.length) break
    for (const w of data) {
      const ids = (w.work_external_ids ?? []) as Array<{ source: string; external_id: string }>
      const muId = ids.find((i) => i.source === "mangaupdates")?.external_id
      if (muId) obras.push({ id: w.id, title: w.title, muId, statusAtual: "Hiatus" })
    }
    if (data.length < 1000) break
  }
  return obras
}

async function main() {
  console.log(`\n[backfill-hiatus-kind] alvo=${alvo} ${EXECUTE ? "(EXECUTANDO)" : "(dry-run)"}`)
  if (alvo === "LOCAL") {
    console.log("⚠️  O alvo é o banco LOCAL, que é réplica descartável — o próximo db:pull apaga isto.")
  }

  const obras = await carregarObrasEmHiato()
  console.log(`\n${obras.length} obras em Hiatus com id do MangaUpdates.\n`)

  const contagem = { between_seasons: 0, mid_season: 0, indeterminado: 0, semTexto: 0, saiuDoHiato: 0, falhou: 0 }
  const gravar: Array<{ id: string; title: string; fields: Record<string, unknown>; nota: string }> = []

  for (let i = 0; i < obras.length; i++) {
    const obra = obras[i]
    const detail = await fetchMangaUpdatesById(Number(obra.muId))
    if (!detail) {
      contagem.falhou++
      console.log(`  ✗ ${obra.title.slice(0, 44)} — MU não respondeu`)
      await new Promise((r) => setTimeout(r, INTERVALO_MS))
      continue
    }

    // O status do MU manda: ver o 🔴 do cabeçalho — 13,4% já tinham saído do hiato.
    const statusMu = detail.publicationStatus
    const fields: Record<string, unknown> = { ...hiatusFieldsFor(detail.statusText, statusMu) }

    // ⚠️ As categorias são EXCLUSIVAS. A 1ª versão somava as que saíram do hiato em
    // "indeterminado" (o `hiatus_kind` delas é null por definição) e o resumo passava a
    // misturar "o texto não decide" com "a pergunta não se aplica" — dois fatos diferentes
    // sob um número só, que é o tipo de relatório que faz decidir errado.
    if (statusMu !== "Hiatus" && statusMu !== "Unknown") {
      contagem.saiuDoHiato++
      fields.publication_status_id = await idDoStatus(statusMu)
    } else if (!detail.statusText) contagem.semTexto++
    else if (fields.hiatus_kind === "between_seasons") contagem.between_seasons++
    else if (fields.hiatus_kind === "mid_season") contagem.mid_season++
    else contagem.indeterminado++

    const c = classifyHiatus(detail.statusText)
    gravar.push({
      id: obra.id,
      title: obra.title,
      fields,
      nota: statusMu !== "Hiatus" ? `saiu do hiato → ${statusMu}` : `${c.kind ?? "indeterminado"} (${c.confidence}) — ${c.evidence}`,
    })

    if ((i + 1) % 20 === 0) console.log(`  … ${i + 1}/${obras.length}`)
    await new Promise((r) => setTimeout(r, INTERVALO_MS))
  }

  console.log("\n=== o que a regra concluiu ===")
  for (const g of gravar) console.log(`  ${g.title.slice(0, 44).padEnd(46)} ${g.nota}`)

  const emHiato = contagem.between_seasons + contagem.mid_season + contagem.indeterminado + contagem.semTexto
  console.log("\n=== resumo (categorias exclusivas) ===")
  console.log(`  seguem em hiato        : ${emHiato}`)
  console.log(`    pausa entre temporadas : ${contagem.between_seasons}`)
  console.log(`    interrompida no meio   : ${contagem.mid_season}`)
  console.log(`    indeterminado          : ${contagem.indeterminado}`)
  console.log(`    sem texto de status    : ${contagem.semTexto}`)
  console.log(`  JÁ NÃO estão em hiato  : ${contagem.saiuDoHiato}  (status corrigido junto)`)
  console.log(`  MU não respondeu       : ${contagem.falhou}`)

  if (!EXECUTE) {
    console.log(`\nDry-run. Para gravar:\n  npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/backfill-hiatus-kind.ts --execute\n`)
    return
  }

  let ok = 0
  for (const g of gravar) {
    const { error } = await sb.from("works").update(g.fields).eq("id", g.id)
    if (error) console.log(`  ✗ ${g.title.slice(0, 44)}: ${error.message}`)
    else ok++
  }
  console.log(`\n✅ ${ok}/${gravar.length} obras gravadas.`)
}

const cacheStatus = new Map<string, number>()
async function idDoStatus(nome: string): Promise<number | null> {
  if (cacheStatus.has(nome)) return cacheStatus.get(nome)!
  const { data } = await sb.from("publication_status").select("id").eq("status", nome).maybeSingle()
  if (data?.id) cacheStatus.set(nome, data.id)
  return data?.id ?? null
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : err)
  process.exit(1)
})
