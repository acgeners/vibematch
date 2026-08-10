/**
 * Runner experimental em DRY-RUN do Interesse na Sinopse (Plano 3 Fase B).
 * Roda os baselines D1/D2 (determinísticos) sobre a golden sample, compara com o
 * golden humano (se já rotulado) ou, na falta, com o label manual EXPLORATÓRIO
 * (works.synopsis_quality — contaminado pelo "Aplicar", só sinal aproximado), e
 * estima o orçamento do piloto LLM. NÃO chama provider. READ-ONLY no banco.
 *
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/synopsis-interest-run.ts
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getCandidatesByIds } from "@/server/queries/recommendations"
import { baselineD1, baselineD2 } from "@/lib/synopsis-interest/baselines"
import { levelOf, ordinalAgreement } from "@/lib/synopsis-interest/metrics"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const COST_PER_CALL = 0.00971

interface Slot { slotKey: string; workId: string; split: string; isRepeat: boolean; repeatOf: string | null }

async function main() {
  const dir = resolve(process.cwd(), "lib/synopsis-interest")
  const fixture = JSON.parse(readFileSync(resolve(dir, "golden-sample.pilot-1.json"), "utf8")) as { sample_version: string; slots: Slot[] }
  const uniqueSlots = fixture.slots.filter((s) => !s.isRepeat)
  const uniqueIds = [...new Set(uniqueSlots.map((s) => s.workId))]

  const profileRow = await loadCurrentTasteProfile()
  if (!profileRow || profileRow.is_stub) {
    console.error("[ABORT] sem taste_profile corrente não-stub — gere o perfil antes.")
    process.exit(1)
  }
  const profile = profileRow.profile

  const candidates = await getCandidatesByIds(uniqueIds)
  const byId = new Map(candidates.map((c) => [c.id, c]))

  // D1/D2 por obra única.
  const d1ByWork = new Map<string, number>()
  const d2ByWork = new Map<string, number>()
  for (const id of uniqueIds) {
    const c = byId.get(id)
    if (!c) continue
    const work = { tags: c.tags, synopsis: c.synopsis }
    d1ByWork.set(id, baselineD1(work, profile).level)
    d2ByWork.set(id, baselineD2(work, profile).level)
  }
  console.log(`Perfil v${profileRow.version} | obras da amostra resolvidas: ${byId.size}/${uniqueIds.length}`)

  // Distribuição das 4 classes + variância dos níveis previstos (passo 2).
  function distVar(name: string, byWork: Map<string, number>) {
    const levels = uniqueIds.map((id) => byWork.get(id)).filter((l): l is number => l != null && l >= 1)
    const dist = [1, 2, 3, 4].map((lv) => levels.filter((l) => l === lv).length)
    const mean = levels.reduce((a, b) => a + b, 0) / (levels.length || 1)
    const variance = levels.reduce((a, b) => a + (b - mean) ** 2, 0) / (levels.length || 1)
    console.log(`  ${name}: ♥${dist[0]} ♥♥${dist[1]} ♥♥♥${dist[2]} ♥♥♥♥${dist[3]} | média=${mean.toFixed(2)} var=${variance.toFixed(2)}`)
  }
  console.log("\n=== Distribuição das classes + variância (amostra, n=80) ===")
  distVar("D1     ", d1ByWork)
  distVar("D2     ", d2ByWork)

  // Golden humano (se já carregado + rotulado).
  let golden = new Map<string, number>()
  let goldenAvailable = false
  try {
    const { data, error } = await sb
      .from("synopsis_interest_golden")
      .select("work_id, human_label, is_repeat")
      .eq("sample_version", fixture.sample_version)
      .eq("is_repeat", false)
      .not("human_label", "is", null)
    if (!error && data && data.length > 0) {
      goldenAvailable = true
      golden = new Map(data.map((r) => [(r as { work_id: string }).work_id, levelOf((r as { human_label: string }).human_label)]))
    }
  } catch { /* tabela ausente (migration 109 pendente) */ }

  function report(name: string, predByWork: Map<string, number>, truth: Map<string, number>, splitFilter?: string) {
    const pairs = uniqueSlots
      .filter((s) => (splitFilter ? s.split === splitFilter : true))
      .map((s) => ({ pred: predByWork.get(s.workId) ?? 0, gold: truth.get(s.workId) ?? 0 }))
      .filter((p) => p.pred >= 1 && p.gold >= 1)
    const a = ordinalAgreement(pairs)
    console.log(`  ${name}${splitFilter ? ` [${splitFilter}]` : ""}: n=${a.n} exato=${a.exactRate != null ? (100 * a.exactRate).toFixed(0) + "%" : "—"} ±1=${a.within1Rate != null ? (100 * a.within1Rate).toFixed(0) + "%" : "—"} MAE=${a.mae?.toFixed(2)} viés=${a.bias?.toFixed(2)} QWK=${a.qwk?.toFixed(2)}`)
  }

  if (goldenAvailable) {
    console.log(`\n=== D1/D2 × GOLDEN humano (${golden.size} rotuladas) ===`)
    report("D1", d1ByWork, golden, "development")
    report("D2", d2ByWork, golden, "development")
    report("D1", d1ByWork, golden, "holdout")
    report("D2", d2ByWork, golden, "holdout")
  } else {
    console.log("\n[golden humano ainda não disponível — migration 109 / rotulagem pendente]")
    // Comparação EXPLORATÓRIA (contaminada pelo "Aplicar") só p/ termômetro.
    const { data: wq } = await sb.from("works").select("id, synopsis_quality").in("id", uniqueIds)
    const manual = new Map((wq ?? []).map((w) => [(w as { id: string }).id, levelOf((w as { synopsis_quality: string | null }).synopsis_quality)]))
    distVar("manual ", manual)
    console.log("=== D1/D2 × manual EXPLORATÓRIO (works.synopsis_quality — contaminado, NÃO é o golden) ===")
    report("D1", d1ByWork, manual)
    report("D2", d2ByWork, manual)
  }

  // Consistência intra-avaliador: placeholder (humano) — repetições existem na amostra.
  const repeats = fixture.slots.filter((s) => s.isRepeat)
  console.log(`\nRepetições cegas na amostra: ${repeats.length} (consistência intra-avaliador via intraRaterConsistency após a rotulagem humana)`)

  // Orçamento do piloto LLM (apenas obras únicas; repetições são p/ o HUMANO).
  console.log(`\n=== ORÇAMENTO do piloto LLM (synopsis_quality_predict) ===`)
  console.log(`  obras únicas=${uniqueIds.length} × $${COST_PER_CALL} ≈ $${(uniqueIds.length * COST_PER_CALL).toFixed(2)}`)
  console.log(`  (com cache do bloco de perfil entre chamadas, o real tende a ser MENOR; teto seguro < $1)`)
  console.log(`\n[DRY-RUN] nenhuma chamada paga feita. D1/D2 são determinísticos.`)
}

main().catch((err) => { console.error("[run] erro:", err); process.exit(1) })
