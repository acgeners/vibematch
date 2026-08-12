/**
 * Audita o status de publicação gravado contra o que o MangaUpdates diz HOJE.
 *
 * Nasceu do segundo viés do `mapStatus` (corrigido em 2026-08-12): `complete` era o primeiro
 * teste e rodava sobre o texto INTEIRO, então uma linha de temporada encerrada
 * (`S1: 40 Chapters (Complete)`) arrastava a obra INTEIRA para `Completed` — no sentido mais
 * caro, porque obra concluída some das listas de quem acompanha.
 *
 * 🔴 **Separa as DUAS causas, e essa é a razão de existir.** Uma divergência entre o banco e o
 * MU pode ser:
 *
 *   • **parsing** — o texto de hoje, lido pela regra ANTIGA, dá o status gravado; lido pela
 *     regra NOVA, dá outro. A obra nunca esteve certa.
 *   • **envelhecimento** — as duas regras concordam entre si e discordam do banco. O texto
 *     mudou desde a última busca; ninguém errou.
 *
 * Juntar as duas num número só produziria "N obras erradas" sem dizer o que fazer com elas:
 * a primeira classe é dívida do código já paga, a segunda é rotina de curadoria.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — o modo `--execute` GRAVA `publication_status_id`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/auditar-status-publicacao.ts
 *   ... --status=Completed        (default: todos menos Hiatus, já auditado pelo backfill)
 *   ... --execute
 */
import { createClient } from "@supabase/supabase-js"
import { fetchMangaUpdatesById, mapStatus } from "@/lib/external/mangaupdates"

const EXECUTE = process.argv.includes("--execute")
const statusArg = process.argv.find((a) => a.startsWith("--status="))?.split("=")[1]
const INTERVALO_MS = 150

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
const sb = createClient(url, key)
const alvo = url.includes("127.0.0.1") || url.includes("localhost") ? "LOCAL" : "NUVEM"

/** A regra ANTES do fix — só para atribuir a CAUSA, nunca para decidir o status. */
function mapStatusAntigo(status: string | undefined): string {
  if (!status) return "Unknown"
  const s = status.toLowerCase()
  if (s.includes("complete")) return "Completed"
  if (s.includes("hiatus")) return "Hiatus"
  if (s.includes("cancel") || s.includes("axed")) return "Cancelled"
  if (s.includes("ongoing") || s.includes("continuing")) return "Ongoing"
  return "Unknown"
}

async function main() {
  console.log(`\n[auditar-status-publicacao] alvo=${alvo} ${EXECUTE ? "(EXECUTANDO)" : "(dry-run)"}`)

  const { data: statusRows, error: se } = await sb.from("publication_status").select("id, status, slug")
  if (se) throw new Error(`publication_status: ${se.message}`)
  const nomePorId = new Map((statusRows ?? []).map((r) => [r.id, r.status as string]))
  const idPorNome = new Map((statusRows ?? []).map((r) => [r.status as string, r.id as number]))
  const hiatusId = (statusRows ?? []).find((r) => r.slug === "hiatus")?.id

  // Pagina: o select corta em 1000 linhas sem avisar, e uma auditoria que enxerga metade do
  // catálogo relata "tudo certo" sobre o que não olhou.
  const obras: Array<{ id: string; title: string; muId: string; statusAtual: string }> = []
  for (let from = 0; ; from += 1000) {
    let q = sb
      .from("works")
      .select("id, title, publication_status_id, work_external_ids(source, external_id, is_rejected)")
      .eq("is_archived", false)
      .range(from, from + 999)
    if (statusArg) q = q.eq("publication_status_id", idPorNome.get(statusArg) ?? -1)
    else if (hiatusId) q = q.neq("publication_status_id", hiatusId)
    const { data, error } = await q
    if (error) throw new Error(`works: ${error.message}`)
    if (!data?.length) break
    for (const w of data) {
      const ids = (w.work_external_ids ?? []) as Array<{ source: string; external_id: string; is_rejected: boolean }>
      const mu = ids.find((i) => i.source === "mangaupdates" && !i.is_rejected)?.external_id
      if (mu) obras.push({ id: w.id, title: w.title, muId: mu, statusAtual: nomePorId.get(w.publication_status_id) ?? "?" })
    }
    if (data.length < 1000) break
  }

  console.log(`${obras.length} obras a conferir${statusArg ? ` (status=${statusArg})` : " (todas menos Hiatus)"}\n`)

  const porParsing: Array<{ t: string; de: string; para: string; head: string; id: string }> = []
  const porIdade: Array<{ t: string; de: string; para: string; head: string; id: string }> = []
  let falhou = 0

  for (let i = 0; i < obras.length; i++) {
    const o = obras[i]
    const d = await fetchMangaUpdatesById(Number(o.muId))
    if (!d) { falhou++; await new Promise((r) => setTimeout(r, INTERVALO_MS)); continue }

    const novo = d.publicationStatus
    if (novo !== "Unknown" && novo !== o.statusAtual) {
      const antigo = mapStatusAntigo(d.statusText)
      const head = (d.statusText ?? "").split("\n").slice(0, 2).join(" ").trim().slice(0, 78)
      const linha = { t: o.title, de: o.statusAtual, para: novo, head, id: o.id }
      // A regra antiga reproduz o que está gravado ⇒ foi ela que errou.
      if (antigo === o.statusAtual) porParsing.push(linha)
      else porIdade.push(linha)
    }
    if ((i + 1) % 100 === 0) console.log(`  … ${i + 1}/${obras.length}`)
    await new Promise((r) => setTimeout(r, INTERVALO_MS))
  }

  const bloco = (titulo: string, arr: typeof porParsing) => {
    console.log(`\n=== ${titulo}: ${arr.length} ===`)
    for (const l of arr) console.log(`  ${l.de} → ${l.para}  ${l.t.slice(0, 40)}\n      ${JSON.stringify(l.head)}`)
  }
  bloco("PARSING — a regra antiga produzia o status gravado", porParsing)
  bloco("ENVELHECIMENTO — as duas regras concordam, o banco é que está velho", porIdade)
  console.log(`\nMU não respondeu: ${falhou}`)

  const todas = [...porParsing, ...porIdade]
  if (!EXECUTE) {
    console.log(`\nDry-run. ${todas.length} obras mudariam. Para gravar, acrescente --execute\n`)
    return
  }
  let ok = 0
  for (const l of todas) {
    const { error } = await sb.from("works").update({ publication_status_id: idPorNome.get(l.para) }).eq("id", l.id)
    if (error) console.log(`  ✗ ${l.t.slice(0, 40)}: ${error.message}`)
    else ok++
  }
  console.log(`\n✅ ${ok}/${todas.length} obras atualizadas.`)
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1) })
