/**
 * BACKFILL de `work_synopses`: aplica no passado as duas regras que agora valem no
 * gravador — LIMPEZA (`cleanSynopsisText`) e DEDUP POR SIGNIFICADO (`dedupeByMeaning`).
 *
 * Por que existe: as regras moravam só na fronteira "acabei de buscar nas fontes"
 * (`mergeData`). Tudo depois comparava por igualdade exata e nunca relimpava, e o
 * `enrichComixDataForWork` gravava direto, por fora. Medido em 2026-07-24: 55% das
 * linhas do Comix com markdown/links crus, 314 linhas com bloco "Original Novel:", e
 * 232 pares de sinopses quase-idênticas convivendo como itens separados.
 *
 * Custo: ZERO IA — é tudo determinístico, roda offline sobre o texto já salvo.
 *
 * Preserva `id` e `created_at` das linhas que sobrevivem (update no lugar, não
 * delete+insert): as linhas são referenciadas por posição em nada, mas trocar o id à
 * toa apagaria a única pista de quando cada sinopse entrou.
 *
 * Uso:
 *   npm run backfill:synopses                 # DRY-RUN (padrão) — só relata
 *   npm run backfill:synopses -- --apply      # escreve
 *   npm run backfill:synopses -- --limit=20   # amostra
 *   npm run backfill:synopses -- --work=<id>  # uma obra só
 *   npm run backfill:synopses -- --samples=8  # quantos diffs imprimir
 *
 * ⚠️ Rode `node scripts/backup-db.mjs` antes: escreve em massa e o banco não tem
 * backup em nuvem.
 *
 * Efeito colateral esperado: `works.canonical_synopsis` de quem mudou fica DEFASADA
 * (o gate é o `canonical_synopsis_inputs_hash`, que passa a não bater). O script NÃO
 * re-consolida — isso chama LLM e custa dinheiro. Ele só conta quantas obras entram
 * na fila do painel "Consolidar sinopses" em /curation/settings.
 */
import { createClient } from "@supabase/supabase-js"
import { config } from "dotenv"
import { cleanSynopsisText, dedupeByMeaning, synopsisDuplicateScore } from "../lib/synopsis-text"

config({ path: ".env.local" })

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0") || null
const ONLY_WORK = args.find((a) => a.startsWith("--work="))?.split("=")[1] ?? null
const SAMPLES = Number(args.find((a) => a.startsWith("--samples="))?.split("=")[1] ?? "5")

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

interface SynopsisRow {
  id: string
  work_id: string
  source: string | null
  text: string | null
  is_primary: boolean | null
  position: number | null
}

/**
 * Lê TODAS as linhas. Pagina e confere contra `count: "exact"`: o `select` do
 * Supabase corta em 1000 sem avisar, e um backfill que processa 43% do alvo
 * termina "com sucesso".
 */
async function loadAllSynopses(): Promise<SynopsisRow[]> {
  const rows: SynopsisRow[] = []
  for (let from = 0; ; from += 1000) {
    let query = supabase
      .from("work_synopses")
      .select("id, work_id, source, text, is_primary, position")
      .order("work_id")
      .order("position")
      .range(from, from + 999)
    if (ONLY_WORK) query = query.eq("work_id", ONLY_WORK)
    const { data, error } = await query
    if (error) throw new Error(`work_synopses select: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as SynopsisRow[]))
    if (data.length < 1000) break
  }

  if (!ONLY_WORK) {
    const { count, error } = await supabase
      .from("work_synopses")
      .select("*", { count: "exact", head: true })
    if (error) throw new Error(`work_synopses count: ${error.message}`)
    if (count != null && count !== rows.length) {
      throw new Error(`ABORTANDO: li ${rows.length} linhas mas a tabela tem ${count}.`)
    }
  }
  return rows
}

interface PlannedRow {
  id: string
  text: string
  isPrimary: boolean
  position: number
  /** Texto original — só pra imprimir o diff. */
  before: string
  source: string
}

/** Só pra AUDITORIA: quem foi apagado, quem o absorveu e com que score. */
interface DropAudit {
  workId: string
  source: string
  absorbedBySource: string
  score: number
  droppedText: string
  survivorText: string
}

interface WorkPlan {
  workId: string
  keep: PlannedRow[]
  dropIds: string[]
  /** Linhas cujo TEXTO muda (limpeza). */
  cleaned: number
  /** Linhas removidas por serem a mesma sinopse de outra. */
  dropped: number
  drops: DropAudit[]
}

/**
 * Mesma sequência do gravador (`dedupeSynopsisEntries` + `syncWorkSynopses`): ordena
 * (principal primeiro, depois position), limpa, deduplica pelo significado, renumera
 * e garante exatamente uma principal.
 */
function planWork(workId: string, rows: SynopsisRow[]): WorkPlan | null {
  const sorted = [...rows].sort((a, b) => {
    if (Boolean(a.is_primary) === Boolean(b.is_primary)) return (a.position ?? 0) - (b.position ?? 0)
    return a.is_primary ? -1 : 1
  })

  const cleanedRows = sorted
    .map((row) => ({ row, text: cleanSynopsisText(row.text) }))
    .filter((entry) => entry.text.length > 0)

  const kept = dedupeByMeaning(cleanedRows, (entry) => entry.text)
  const keptIds = new Set(kept.map((entry) => entry.row.id))
  const dropIds = sorted.filter((row) => !keptIds.has(row.id)).map((row) => row.id)

  // A principal sobrevive por construção (vem primeiro na ordenação e por isso vence
  // o dedup). Se a obra não tinha nenhuma, a posição 0 assume — mesma regra do
  // gravador, que não aceita obra sem principal.
  const primaryIdx = Math.max(0, kept.findIndex((entry) => entry.row.is_primary))

  const keep: PlannedRow[] = kept.map((entry, index) => ({
    id: entry.row.id,
    text: entry.text,
    isPrimary: index === primaryIdx,
    position: index,
    before: (entry.row.text ?? "").trim(),
    source: entry.row.source ?? "?",
  }))

  const cleaned = keep.filter((row) => row.text !== row.before).length
  const positionOrPrimaryChanged = keep.some((row) => {
    const original = sorted.find((r) => r.id === row.id)!
    return (original.position ?? 0) !== row.position || Boolean(original.is_primary) !== row.isPrimary
  })

  // Reconstrói QUEM absorveu cada apagada. A decisão continua sendo do lib
  // (`dedupeByMeaning`) — isto aqui é só o laudo, pra dar pra conferir os casos
  // rentes ao limiar antes de apagar linha de verdade.
  const drops: DropAudit[] = cleanedRows
    .filter((entry) => !keptIds.has(entry.row.id))
    .map((entry) => {
      const ranked = keep
        .map((survivor) => ({ survivor, score: synopsisDuplicateScore(survivor.text, entry.text) }))
        .sort((a, b) => b.score - a.score)[0]
      return {
        workId,
        source: entry.row.source ?? "?",
        absorbedBySource: ranked?.survivor.source ?? "?",
        score: ranked?.score ?? 0,
        droppedText: entry.text,
        survivorText: ranked?.survivor.text ?? "",
      }
    })

  if (!cleaned && !dropIds.length && !positionOrPrimaryChanged) return null
  return { workId, keep, dropIds, cleaned, dropped: dropIds.length, drops }
}

/**
 * Escreve na ordem que o índice parcial `work_synopses_one_primary` tolera: primeiro
 * apaga as sobras, depois ZERA todas as principais da obra, e só então marca a nova.
 * Marcar a nova antes de zerar a antiga viola o índice e o update volta com erro.
 */
async function applyPlan(plan: WorkPlan): Promise<void> {
  if (plan.dropIds.length) {
    const { error } = await supabase.from("work_synopses").delete().in("id", plan.dropIds)
    if (error) throw new Error(`delete ${plan.workId}: ${error.message}`)
  }

  const { error: demoteError } = await supabase
    .from("work_synopses")
    .update({ is_primary: false })
    .eq("work_id", plan.workId)
  if (demoteError) throw new Error(`demote ${plan.workId}: ${demoteError.message}`)

  for (const row of plan.keep) {
    const { error } = await supabase
      .from("work_synopses")
      .update({ text: row.text, position: row.position })
      .eq("id", row.id)
    if (error) throw new Error(`update ${row.id}: ${error.message}`)
  }

  const primary = plan.keep.find((row) => row.isPrimary)
  if (primary) {
    const { error } = await supabase
      .from("work_synopses")
      .update({ is_primary: true })
      .eq("id", primary.id)
    if (error) throw new Error(`primary ${primary.id}: ${error.message}`)
  }
}

function tail(text: string, n = 180): string {
  return text.length <= n ? text : `…${text.slice(-n)}`
}

async function main() {
  console.log(APPLY ? "MODO: APLICAR (escreve no banco)" : "MODO: DRY-RUN (não escreve) — use --apply pra valer")

  const rows = await loadAllSynopses()
  const byWork = new Map<string, SynopsisRow[]>()
  for (const row of rows) {
    const list = byWork.get(row.work_id) ?? []
    list.push(row)
    byWork.set(row.work_id, list)
  }
  console.log(`\nlinhas: ${rows.length} · obras: ${byWork.size}`)

  const plans: WorkPlan[] = []
  for (const [workId, list] of byWork) {
    const plan = planWork(workId, list)
    if (plan) plans.push(plan)
    if (LIMIT && plans.length >= LIMIT) break
  }

  const totalCleaned = plans.reduce((acc, p) => acc + p.cleaned, 0)
  const totalDropped = plans.reduce((acc, p) => acc + p.dropped, 0)
  console.log(
    `\nobras a mudar: ${plans.length}\n` +
      `  linhas com texto limpo:      ${totalCleaned}\n` +
      `  linhas removidas (duplicata): ${totalDropped}`
  )

  const withDiff = plans.filter((p) => p.keep.some((r) => r.text !== r.before))
  console.log(`\n--- amostra de ${Math.min(SAMPLES, withDiff.length)} diffs de texto ---`)
  for (const plan of withDiff.slice(0, SAMPLES)) {
    const row = plan.keep.find((r) => r.text !== r.before)!
    console.log(`\n[${plan.workId}] ${row.source} (${row.before.length} → ${row.text.length} chars)`)
    console.log(`  ANTES : ${JSON.stringify(tail(row.before))}`)
    console.log(`  DEPOIS: ${JSON.stringify(tail(row.text))}`)
  }

  // Auditoria das remoções: as arriscadas são as de score MAIS BAIXO (rentes ao
  // limiar). Se alguma delas for um texto de verdade diferente, o limiar é que está
  // errado — e é melhor descobrir aqui do que depois de apagar 300 linhas.
  const allDrops = plans.flatMap((p) => p.drops).sort((a, b) => a.score - b.score)
  const buckets = { "1.00 (idêntica/contida)": 0, "0.96–0.99": 0, "0.92–0.96": 0 }
  for (const d of allDrops) {
    if (d.score >= 0.999) buckets["1.00 (idêntica/contida)"]++
    else if (d.score >= 0.96) buckets["0.96–0.99"]++
    else buckets["0.92–0.96"]++
  }
  console.log(`\n--- ${allDrops.length} remoções por score ---`)
  console.table(buckets)

  console.log(`\n--- as ${Math.min(SAMPLES, allDrops.length)} remoções MAIS ARRISCADAS (menor score) ---`)
  for (const d of allDrops.slice(0, SAMPLES)) {
    console.log(`\n[${d.workId}] score=${d.score.toFixed(3)} · apaga ${d.source}, absorvida por ${d.absorbedBySource}`)
    console.log(`  APAGA  : ${JSON.stringify(tail(d.droppedText, 220))}`)
    console.log(`  MANTÉM : ${JSON.stringify(tail(d.survivorText, 220))}`)
  }

  if (!APPLY) {
    console.log(`\nNada foi escrito. Rode com --apply (e um backup) pra valer.`)
    return
  }

  let done = 0
  let failed = 0
  for (const plan of plans) {
    try {
      await applyPlan(plan)
      done++
      if (done % 25 === 0) console.log(`  … ${done}/${plans.length}`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${plan.workId}:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`\naplicado em ${done} obras${failed ? ` · ${failed} falharam` : ""}`)
  console.log(
    `\n⚠️ ${plans.length} obras ficam com \`canonical_synopsis\` DEFASADA (o hash dos inputs mudou).\n` +
      `   Re-consolidar chama LLM e custa — faça pelo painel "Consolidar sinopses" em /curation/settings quando quiser.`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
