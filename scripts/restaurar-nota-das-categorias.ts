/**
 * Devolve a nota às obras da DONA que têm as 7 categorias de gosto completas, a leitura liberada e
 * NENHUMA nota gravada (regra da Ana, 22/11/2026: "não é pra acontecer de ter nota das categorias e
 * não ter nota na obra"). A nota é a das categorias (`computeTasteUserScore`), a mesma conta do site.
 *
 * 🔴 ALVO: NUVEM — GRAVA no estado pessoal da dona. Rodado contra o local, que é réplica descartável,
 * o trabalho é jogado fora no próximo `db:pull`.
 *
 *   # ensaio (PADRÃO): imprime o plano e não grava nada
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/restaurar-nota-das-categorias.ts
 *
 *   # aplica (grava pelo mesmo escritor do app, com o histórico de notas, e marca o recálculo)
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/restaurar-nota-das-categorias.ts --execute
 *
 * ⚠️ US$0 de modelo. Só preenche nota VAZIA: nota que já existe não é tocada, nem quando difere da
 * média das categorias. O estado anterior é sempre `user_score = null`, e por isso não há cópia em
 * `.backups/` — o plano impresso é o registro.
 *
 * Por que existe: o histórico de notas (`prediction_ledger`) mostrou 4 obras com a nota dada e depois
 * apagada — o "Salvar" do formulário de status regravava a nota de quando a página abriu (corrigido em
 * `ratingPatchFrom`). Daqui para frente, quem garante a regra é o escritor do estado de leitura
 * (`restoreTasteLabels`, em `server/queries/user-work-state.ts`); este script cuida do que já estava
 * assim antes da garantia existir.
 */
import { createClient } from "@supabase/supabase-js"
import { computeTasteUserScore, TASTE_LABEL_KEYS } from "@/server/queries/pilot-taste"
import { getOwnerUserId } from "@/server/queries/current-user"
import { mirrorOwnerState } from "@/server/queries/user-work-state"
import { tasteLabelsToRestore } from "@/lib/ratings/taste-label-restore"
import type { UnlabeledState } from "@/lib/ratings/taste-label-restore"
// "nada a corrigir" tem de sair junto do funil — ver scripts/lib/funil.mjs.
import { criarFunil } from "./lib/funil.mjs"

const EXECUTAR = process.argv.includes("--execute")

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder do PostgREST de tabelas diferentes
async function pageAll<T>(build: () => any, order: string[]): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = build()
    for (const o of order) q = q.order(o, { ascending: true })
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

async function main() {
  console.log(`alvo: ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host} · ${EXECUTAR ? "EXECUTA" : "ensaio"}`)
  const ownerId = await getOwnerUserId()
  const funil = criarFunil("nota das categorias")

  const taste = await pageAll<Record<string, unknown>>(
    () => sb.from("pilot_taste_scores").select(["user_id", "work_id", ...TASTE_LABEL_KEYS].join(", ")),
    ["user_id", "work_id"],
  )
  const labelByWork = new Map<string, number | null>()
  let othersComplete = 0
  for (const t of taste) {
    const label = computeTasteUserScore(t as never)
    if (label == null) continue
    if (t.user_id === ownerId) labelByWork.set(t.work_id as string, label)
    else othersComplete++
  }
  funil.passo("obras da dona com as 7 categorias completas", labelByWork.size)

  const states = await pageAll<{ work_id: string; personal_status_id: number | null; chapters_read: number | null }>(
    () =>
      sb
        .from("user_work_state")
        .select("work_id, personal_status_id, chapters_read")
        .eq("user_id", ownerId)
        .is("user_score", null),
    ["user_id", "work_id"],
  )
  const unlabeled = states.filter((s) => labelByWork.has(s.work_id))
  funil.passo("sem nota gravada", unlabeled.length)

  const totals = new Map<string, number | null>()
  const ids = unlabeled.map((s) => s.work_id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("works").select("id, title, total_chapters").in("id", ids.slice(i, i + 100))
    if (error) throw new Error(error.message)
    for (const w of data ?? []) totals.set(w.id as string, (w.total_chapters as number | null) ?? null)
  }
  const rows: UnlabeledState[] = unlabeled.map((s) => ({
    workId: s.work_id,
    personalStatusId: s.personal_status_id,
    chaptersRead: s.chapters_read,
    totalChapters: totals.get(s.work_id) ?? null,
  }))
  const groups = tasteLabelsToRestore(rows, labelByWork)
  const plan = [...groups].flatMap(([label, workIds]) => workIds.map((id) => ({ id, label })))
  funil.passo("com a leitura liberada (a nota a gravar)", plan.length)
  if (othersComplete > 0) console.log(`(outras contas: ${othersComplete} obras com as 7 completas — fora deste script)`)

  if (plan.length === 0) {
    funil.nadaAFazer("nada a devolver.")
    return
  }
  funil.relatar()

  const { data: works } = await sb.from("works").select("id, title").in("id", plan.map((p) => p.id))
  const title = new Map((works ?? []).map((w) => [w.id as string, w.title as string]))
  for (const p of plan) console.log(`  ${String(p.label).padStart(4)}  ${title.get(p.id) ?? p.id}`)

  if (!EXECUTAR) {
    console.log("\nensaio: nada gravado. Rode com --execute para gravar.")
    return
  }

  for (const [label, workIds] of groups) {
    const r = await mirrorOwnerState(ownerId, workIds, { user_score: label })
    if (r.error) throw new Error(`gravando ${label}: ${r.error}`)
  }
  // A nota é rótulo da Nota Prevista. `markRecalcPending` é server-only: a RPC é a mesma que ele usa.
  const { error } = await sb.rpc("touch_recalc_pending")
  if (error) console.warn(`⚠ touch_recalc_pending falhou: ${error.message} — marque o recálculo à mão.`)
  console.log(`\n✓ ${plan.length} notas devolvidas; recálculo marcado.`)
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e)
  process.exit(1)
})
