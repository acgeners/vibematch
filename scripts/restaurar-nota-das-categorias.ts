/**
 * Alinha a nota das obras da DONA à regra "as 7 categorias de gosto completas, com a leitura liberada, SÃO a
 * nota da obra" (Ana, 22/11/2026): preenche a nota vazia e troca a que difere. A nota é a das categorias
 * (`computeTasteUserScore`), a mesma conta do site.
 *
 * 🔴 ALVO: NUVEM — GRAVA no estado pessoal da dona. Rodado contra o local, que é réplica descartável,
 * o trabalho é jogado fora no próximo `db:pull`.
 *
 *   # ensaio (PADRÃO): imprime o plano e não grava nada
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/restaurar-nota-das-categorias.ts
 *   # ... --copiar    grava a cópia conferida do estado anterior em .backups/ e para aí
 *   # ... --execute   copia, grava pelo escritor do app, confere e marca o recálculo
 *
 * ⚠️ US$0 de modelo. Trocar uma nota existente carimba `label_changed_at` nas previsões dela (não descarta).
 * Preencher nota VAZIA de obra que já teve nota DESCARTA as previsões antigas dela (regra do ledger) — foi o
 * que a primeira execução, em 22/11, fez sem avisar e sem cópia; ver `desfazer-descarte-2026-11-22.ts`.
 * O `updated_at` volta ao que era: alinhar não é atividade da pessoa, e a `/reading` o usa como estimativa.
 *
 * Daqui para frente quem garante a regra é o escritor do estado de leitura (`writeByTasteLabel`).
 */
import { createClient } from "@supabase/supabase-js"
import { computeTasteUserScore, TASTE_LABEL_KEYS } from "@/server/queries/pilot-taste"
import { getOwnerUserId } from "@/server/queries/current-user"
import { mirrorOwnerState } from "@/server/queries/user-work-state"
import { tasteLabelsToApply } from "@/lib/ratings/taste-label-restore"
import { criarFunil } from "./lib/funil.mjs"
import { copiarNotas } from "./lib/copia-notas.mjs"

const EXECUTAR = process.argv.includes("--execute")
const COPIAR = EXECUTAR || process.argv.includes("--copiar")
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

interface State {
  work_id: string
  user_score: number | null
  personal_status_id: number | null
  chapters_read: number | null
  updated_at: string
}

async function main() {
  console.log(`alvo: ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host} · ${EXECUTAR ? "EXECUTA" : COPIAR ? "copia" : "ensaio"}`)
  const ownerId = await getOwnerUserId()
  const funil = criarFunil("nota das categorias")

  const taste = await pageAll<Record<string, unknown>>(
    () => sb.from("pilot_taste_scores").select(["user_id", "work_id", ...TASTE_LABEL_KEYS].join(", ")).eq("user_id", ownerId),
    ["user_id", "work_id"],
  )
  const labelByWork = new Map<string, number | null>()
  for (const t of taste) {
    const label = computeTasteUserScore(t as never)
    if (label != null) labelByWork.set(t.work_id as string, label)
  }
  funil.passo("obras da dona com as 7 categorias completas", labelByWork.size)

  const states = (
    await pageAll<State>(
      () => sb.from("user_work_state").select("work_id, user_score, personal_status_id, chapters_read, updated_at").eq("user_id", ownerId),
      ["user_id", "work_id"],
    )
  ).filter((s) => labelByWork.has(s.work_id))
  funil.passo("com linha de estado", states.length)

  const works = new Map<string, { title: string; total: number | null }>()
  const ids = states.map((s) => s.work_id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("works").select("id, title, total_chapters").in("id", ids.slice(i, i + 100))
    if (error) throw new Error(error.message)
    for (const w of data ?? []) works.set(w.id as string, { title: w.title as string, total: (w.total_chapters as number | null) ?? null })
  }
  const plan = tasteLabelsToApply(
    states.map((s) => ({
      workId: s.work_id,
      personalStatusId: s.personal_status_id,
      chaptersRead: s.chapters_read,
      totalChapters: works.get(s.work_id)?.total ?? null,
      score: s.user_score == null ? null : Number(s.user_score),
    })),
    labelByWork,
  )
  funil.passo("com a nota vazia ou diferente, e a leitura liberada (a gravar)", plan.length)
  if (plan.length === 0) {
    funil.nadaAFazer("nada a alinhar.")
    return
  }
  funil.relatar()
  for (const p of plan) console.log(`  ${p.previous ?? "vazia"} → ${p.label}   ${works.get(p.workId)?.title ?? p.workId}`)

  const planIds = plan.map((p) => p.workId)
  const { data: snaps, error: snapsError } = await sb
    .from("prediction_snapshots")
    .select("id, work_id, resolved_at, label_changed_at, discarded_at")
    .eq("user_id", ownerId)
    .in("work_id", planIds)
    .limit(1000)
  if (snapsError) throw new Error(snapsError.message)
  const vazias = new Set(plan.filter((p) => p.previous == null).map((p) => p.workId))
  console.log(
    `efeito nas previsões: ${snaps!.filter((s) => !vazias.has(s.work_id) && s.resolved_at && !s.label_changed_at).length} carimbadas como "nota editada" (seguem nas métricas) · ` +
      `${snaps!.filter((s) => vazias.has(s.work_id) && !s.discarded_at).length} descartadas`,
  )

  if (!COPIAR) {
    console.log("\nensaio: nada gravado.")
    return
  }
  const { tabelas } = await copiarNotas(sb, ownerId, planIds, "alinhar a nota às categorias")
  if (!EXECUTAR) return

  const porNota = new Map<number, string[]>()
  for (const p of plan) porNota.set(p.label, [...(porNota.get(p.label) ?? []), p.workId])
  for (const [label, workIds] of porNota) {
    const r = await mirrorOwnerState(ownerId, workIds, { user_score: label })
    if (r.error) throw new Error(`gravando ${label}: ${r.error}`)
  }
  for (const row of tabelas.user_work_state as State[]) {
    const { error } = await sb
      .from("user_work_state")
      .update({ updated_at: row.updated_at })
      .eq("user_id", ownerId)
      .eq("work_id", row.work_id)
    if (error) throw new Error(`devolvendo a data de ${row.work_id}: ${error.message}`)
  }
  const { data: depois, error } = await sb.from("user_work_state").select("work_id, user_score").eq("user_id", ownerId).in("work_id", planIds)
  if (error) throw new Error(error.message)
  const ruins = plan.filter((p) => Number(depois!.find((d) => d.work_id === p.workId)?.user_score) !== p.label)
  if (ruins.length > 0) throw new Error(`${ruins.length} notas não ficaram como o plano: ${ruins.map((r) => r.workId).join(", ")}`)
  const { error: rpcError } = await sb.rpc("touch_recalc_pending")
  if (rpcError) console.warn(`⚠ touch_recalc_pending falhou: ${rpcError.message} — marque o recálculo à mão.`)
  console.log(`\n✓ ${plan.length} notas alinhadas e conferidas; recálculo marcado.`)
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e)
  process.exit(1)
})
