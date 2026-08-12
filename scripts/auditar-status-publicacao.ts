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
 * ⚠️ O `--execute` PERSISTE `publication_status_note` de toda obra visitada, não só das que
 * mudam de status. O texto do MU é fato da obra: buscá-lo para descartar obriga a repetir a
 * rede quando a obra entrar em hiato — a 1ª versão fez exatamente isso com 590 obras.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — o `--execute` GRAVA `publication_status_id` e as 3 colunas de hiato.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/auditar-status-publicacao.ts
 *   ... --status=Completed   (default: todos menos Hiatus, já coberto pelo backfill)
 *   ... --execute
 */
import { createClient } from "@supabase/supabase-js"
import { fetchMangaUpdatesById } from "@/lib/external/mangaupdates"
import { hiatusFieldsFor } from "@/lib/external/hiatus-kind"

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

  /** Toda obra visitada — o texto do MU é fato da obra e não deve ser jogado fora.
   *  🔴 A 1ª versão deste script buscava o statusText de 590 obras e descartava: gravava só
   *  `publication_status_id`. Resultado medido depois — 590 obras Completed com nota NULA,
   *  tendo o texto passado pela memória do processo. Uma que entrasse em hiato depois
   *  precisaria de rede de novo para ser classificada. */
  const notas: Array<{ id: string; fields: ReturnType<typeof hiatusFieldsFor> }> = []
  const porParsing: Array<{ t: string; de: string; para: string; head: string; id: string }> = []
  const porIdade: Array<{ t: string; de: string; para: string; head: string; id: string }> = []
  let falhou = 0

  for (let i = 0; i < obras.length; i++) {
    const o = obras[i]
    const d = await fetchMangaUpdatesById(Number(o.muId))
    if (!d) { falhou++; await new Promise((r) => setTimeout(r, INTERVALO_MS)); continue }

    const novo = d.publicationStatus
    // O status que vale é o do MU (é ele que decide a linha abaixo), então as colunas de
    // hiato saem já coerentes com ele — e não com o que ainda está gravado.
    notas.push({ id: o.id, fields: hiatusFieldsFor(d.statusText, novo === "Unknown" ? o.statusAtual : novo) })
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
  const comNota = notas.filter((n) => n.fields.publication_status_note).length
  if (!EXECUTE) {
    console.log(`\nDry-run. ${todas.length} obras mudariam de status; ${comNota} teriam a nota gravada.`)
    console.log(`Para gravar, acrescente --execute\n`)
    return
  }

  // 1) A NOTA de toda obra visitada. Vai primeiro porque não depende de nada e é o dado que
  //    a execução anterior perdeu.
  const mudouStatus = new Map(todas.map((l) => [l.id, idPorNome.get(l.para)]))
  let okNota = 0
  for (const n of notas) {
    if (!n.fields.publication_status_note) continue
    // Quem também muda de status leva tudo num UPDATE só — duas escritas na mesma linha
    // fariam o trigger de hiato rodar contra o status intermediário (o antigo), que é
    // exatamente o estado que não vale.
    const patch: Record<string, unknown> = { ...n.fields }
    const novoStatusId = mudouStatus.get(n.id)
    if (novoStatusId) patch.publication_status_id = novoStatusId
    const { error } = await sb.from("works").update(patch).eq("id", n.id)
    if (error) console.log(`  ✗ nota ${n.id}: ${error.message}`)
    else okNota++
  }

  // 2) As que mudam de status mas não tinham nota (o MU respondeu sem texto).
  let okStatus = 0
  const semNota = todas.filter((l) => !notas.find((n) => n.id === l.id && n.fields.publication_status_note))
  for (const l of semNota) {
    const { error } = await sb.from("works").update({ publication_status_id: idPorNome.get(l.para) }).eq("id", l.id)
    if (error) console.log(`  ✗ ${l.t.slice(0, 40)}: ${error.message}`)
    else okStatus++
  }

  console.log(`\n✅ ${okNota} notas gravadas · ${todas.length} status corrigidos (${okStatus} sem nota).`)
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1) })
