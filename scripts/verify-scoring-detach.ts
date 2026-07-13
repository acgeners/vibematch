/**
 * ACEITE DA FASE B — o scoring mudou de fonte sem mudar de resultado?
 *
 * O recalc passou a ler os rótulos do dono de `user_work_state` em vez das colunas de `works`.
 * Se a troca estiver certa, os números têm que sair IDÊNTICOS — mesma matemática, mesmos
 * rótulos, outra tabela.
 *
 * ⚠️ Compara contra `calc_control_147` — a saída de um `recalculateAll()` rodado NA MAIN, sem
 * o rewire. NÃO contra o snapshot da mig 144.
 *
 * Por quê: o snapshot congelou os valores que estavam GUARDADOS no banco, e eles já estavam
 * defasados em relação a um recalc fresco (801 das 882 divergiam já na main, antes de eu
 * tocar em qualquer coisa). Comparar contra ele acusaria o rewire de um crime que não
 * cometeu — e, pior, poderia esconder um crime real no meio do ruído. O controle certo é
 * "mesma entrada, mesmo código, só a FONTE dos rótulos muda".
 *
 * ⚠️ Por que este teste é obrigatório: um Ridge sem rótulos NÃO GRITA. Ele cai na média do
 * treino e devolve 878 notas plausíveis — e "plausível" é indistinguível de "certo" no olho.
 * A única forma de saber é comparar número a número.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/verify-scoring-detach.ts
 */
import { recalculateAll } from "@/server/actions/calculations"
import { createAdminClient } from "@/lib/supabase/admin"

const PAGE = 500

async function fetchAll(table: string, columns: string, order: string) {
  const sb = createAdminClient()
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .order(order, { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as unknown as Record<string, unknown>[]))
    if (data.length < PAGE) break
  }
  return rows
}

const num = (v: unknown) => (v == null ? null : Number(v))

async function main() {
  console.log("── recalculateAll(headless) — sem LLM, custo zero\n")
  const res = await recalculateAll("headless")
  console.log(`   recalculadas: ${res.recalculated ?? "?"} obras\n`)

  const cols = "work_id, expected_score, calc_score, chance_score, personal_fit"
  const [now, snap] = await Promise.all([
    fetchAll("calculated_scores", cols, "work_id"),
    fetchAll("calc_control_147", cols, "work_id"),
  ])
  const snapById = new Map(snap.map((r) => [r.work_id as string, r]))

  console.log(`── comparando ${now.length} obras contra o snapshot (${snap.length})\n`)

  const fields = ["expected_score", "calc_score", "chance_score", "personal_fit"] as const
  const diffs: Record<string, Array<{ id: string; antes: number | null; agora: number | null }>> = {
    expected_score: [],
    calc_score: [],
    chance_score: [],
    personal_fit: [],
  }

  for (const row of now) {
    const before = snapById.get(row.work_id as string)
    if (!before) continue
    for (const f of fields) {
      const a = num(before[f])
      const b = num(row[f])
      // Tolerância ZERO no valor: a matemática é a mesma, os rótulos são os mesmos.
      // (Comparo com string pra não deixar 7.780000001 passar por igual sem eu saber.)
      if (String(a) !== String(b)) {
        diffs[f].push({ id: (row.work_id as string).slice(0, 8), antes: a, agora: b })
      }
    }
  }

  let failed = 0
  for (const f of fields) {
    const d = diffs[f]
    const ok = d.length === 0
    if (!ok) failed++
    console.log(
      `  ${ok ? "✅" : "🔴"} ${f.padEnd(14)} divergentes: ${String(d.length).padStart(3)}` +
        (ok ? "" : `  ex.: ${d.slice(0, 3).map((x) => `${x.id} ${x.antes}→${x.agora}`).join(" · ")}`),
    )
  }

  // A checagem que pega o modo de falha silencioso: se o Ridge tivesse treinado com ZERO
  // rótulos, as notas colapsariam pra perto de um único valor (a média do treino).
  const vals = now.map((r) => num(r.expected_score)).filter((v): v is number => v != null)
  const media = vals.reduce((a, b) => a + b, 0) / vals.length
  const desvio = Math.sqrt(vals.reduce((s, v) => s + (v - media) ** 2, 0) / vals.length)
  const distintos = new Set(vals.map((v) => v.toFixed(2))).size
  console.log(
    `\n  dispersão da Nota Prevista: desvio-padrão ${desvio.toFixed(3)} · ${distintos} valores distintos em ${vals.length}`,
  )
  console.log(
    desvio > 0.3
      ? "  ✅ as notas seguem espalhadas (não colapsaram na média do treino)"
      : "  🔴 as notas COLAPSARAM — sinal de Ridge treinado sem rótulos",
  )
  if (desvio <= 0.3) failed++

  console.log(
    failed === 0
      ? "\n✅ FASE B VERDE — o scoring trocou de fonte e devolveu os MESMOS números."
      : `\n❌ ${failed} verificação(ões) falharam — o scoring mudou de resultado. NÃO mergear.`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n💥 ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
