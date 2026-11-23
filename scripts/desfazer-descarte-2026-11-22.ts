/**
 * Desfaz os efeitos colaterais da 1ª execução de `restaurar-nota-das-categorias.ts` (22/11/2026, ~21:49 UTC):
 * ao devolver a nota de 4 obras, o ledger tratou 3 como "reavaliadas" e descartou as previsões delas — 3 linhas
 * de `prediction_ledger` e 24 de `prediction_snapshots`, todas válidas (resolvidas antes) e sem marca de
 * descarte até ali. E a data de *The Returned Villainess Vows to Stay Single*, que não tem `last_read_at`,
 * virou 22/11: a `/reading` a usa como estimativa de leitura.
 *
 * 🔴 ALVO: NUVEM — GRAVA. Uso único; rodar de novo não acha nada.
 *
 *   # ensaio (PADRÃO) · --copiar (cópia conferida em .backups/) · --execute (copia, grava e confere)
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/desfazer-descarte-2026-11-22.ts
 *
 * ⚠️ A hora exata da data anterior não foi guardada: o que se sabe é o dia (15/09). O valor devolvido é a hora
 * em que a nota dela foi registrada nesse dia. As notas devolvidas NÃO são tocadas.
 */
import { createClient } from "@supabase/supabase-js"
import { getOwnerUserId } from "@/server/queries/current-user"
import { criarFunil } from "./lib/funil.mjs"
import { copiarNotas } from "./lib/copia-notas.mjs"

const EXECUTAR = process.argv.includes("--execute")
const COPIAR = EXECUTAR || process.argv.includes("--copiar")
const INI = "2026-11-22T21:40:00Z"
const FIM = "2026-11-22T21:59:00Z"
const TITULOS = ["Lotuses Bloom on the Celestial Mountain", "The Demon King Wants Peace", "The Returned Villainess Vows to Stay Single"]
const SEM_DATA = "The Returned Villainess Vows to Stay Single"
const ESPERADO = { prediction_ledger: 3, prediction_snapshots: 24 } as const
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  console.log(`alvo: ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host} · ${EXECUTAR ? "EXECUTA" : COPIAR ? "copia" : "ensaio"}`)
  const ownerId = await getOwnerUserId()
  const { data: works, error } = await sb.from("works").select("id, title").in("title", TITULOS)
  if (error) throw new Error(error.message)
  if (works!.length !== TITULOS.length) throw new Error(`achei ${works!.length} de ${TITULOS.length} obras`)
  const ids = works!.map((w) => w.id as string)
  const funil = criarFunil("descarte de 22/11")
  funil.passo("obras atingidas", ids.length)

  const alvo: Record<keyof typeof ESPERADO, string[]> = { prediction_ledger: [], prediction_snapshots: [] }
  for (const t of Object.keys(ESPERADO) as (keyof typeof ESPERADO)[]) {
    let q = sb.from(t).select("id").eq("user_id", ownerId).in("work_id", ids).gte("discarded_at", INI).lte("discarded_at", FIM)
    if (t === "prediction_snapshots") q = q.lt("resolved_at", INI) // só as que já eram medição antes
    const { data, error: e } = await q.order("id").limit(1000)
    if (e) throw new Error(`${t}: ${e.message}`)
    alvo[t] = data!.map((r) => r.id as string)
  }
  const total = alvo.prediction_ledger.length + alvo.prediction_snapshots.length
  funil.passo("linhas descartadas naquela execução", total)
  const semData = works!.find((w) => w.title === SEM_DATA)!.id as string
  const { data: linha, error: e1 } = await sb
    .from("user_work_state")
    .select("updated_at, last_read_at")
    .eq("user_id", ownerId)
    .eq("work_id", semData)
    .single()
  if (e1) throw new Error(e1.message)
  const { data: dada, error: e2 } = await sb.from("prediction_ledger").select("captured_at").eq("user_id", ownerId).eq("work_id", semData).single()
  if (e2) throw new Error(e2.message)
  const mexeData = linha!.last_read_at == null && linha!.updated_at >= INI.slice(0, 19) && linha!.updated_at <= FIM.slice(0, 19)

  if (total === 0 && !mexeData) {
    funil.nadaAFazer("nada a desfazer.")
    return
  }
  funil.relatar()
  console.log(`  prediction_ledger: ${alvo.prediction_ledger.length} (esperado ${ESPERADO.prediction_ledger})`)
  console.log(`  prediction_snapshots: ${alvo.prediction_snapshots.length} (esperado ${ESPERADO.prediction_snapshots})`)
  console.log(`  data de "${SEM_DATA}": ${mexeData ? `${linha!.updated_at} → ${dada!.captured_at}` : `${linha!.updated_at} (mudou desde então; não mexo)`}`)
  for (const t of Object.keys(ESPERADO) as (keyof typeof ESPERADO)[]) {
    if (alvo[t].length !== ESPERADO[t]) throw new Error(`${t}: ${alvo[t].length} linhas, esperava ${ESPERADO[t]} — confira antes`)
  }
  if (!COPIAR) {
    console.log("\nensaio: nada gravado.")
    return
  }
  await copiarNotas(sb, ownerId, ids, "desfazer o descarte de 22/11")
  if (!EXECUTAR) return

  for (const t of Object.keys(ESPERADO) as (keyof typeof ESPERADO)[]) {
    const { data, error: e } = await sb.from(t).update({ discarded_at: null }).in("id", alvo[t]).select("id")
    if (e) throw new Error(`${t}: ${e.message}`)
    if (data!.length !== alvo[t].length) throw new Error(`${t}: o banco gravou ${data!.length} de ${alvo[t].length}`)
  }
  if (mexeData) {
    const { data, error: e } = await sb
      .from("user_work_state")
      .update({ updated_at: dada!.captured_at })
      .eq("user_id", ownerId)
      .eq("work_id", semData)
      .select("work_id")
    if (e) throw new Error(e.message)
    if (data!.length !== 1) throw new Error("a data não foi gravada")
  }
  console.log(`\n✓ ${total} linhas voltaram a valer${mexeData ? " e a data foi devolvida" : ""}.`)
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e)
  process.exit(1)
})
