/**
 * recommendation-hit-baseline.ts — o Veredito IA orienta a ESCOLHA de leitura?
 *
 * Objetivo: dar um número comparável antes/depois de qualquer mudança no ranqueamento
 * (pool de candidatos, eixo de trope, denominador do personal_fit). READ-ONLY — só SELECT.
 *
 * A pergunta que ele responde é diferente da do `baselines:ranking`. Lá: "a nota prevista
 * acerta o quanto o usuário gostou?" (correlação com user_score). Aqui: "das obras que a
 * recomendação ofereceu, o usuário foi ler as que estavam no TOPO?" — que é o desempate
 * entre obras já provavelmente boas, e a tarefa que o produto de fato tem.
 *
 * Sinal: `user_work_state.last_read_at > recommendation_runs.created_at` para o MESMO
 * usuário do run. Nenhum dado novo precisa ser coletado.
 *
 * Uso: npm run baselines:rec-hit
 *
 * ⚠️ TRÊS LIMITES, todos reais:
 * 1. CAUSALIDADE. `last_read_at` posterior ao run não prova que o run causou a leitura —
 *    a obra pode ter sido lida por outro motivo. E se causou, a métrica mede ADESÃO
 *    (o usuário seguiu a sugestão), não acerto — as duas são indistinguíveis aqui.
 * 2. `last_read_at` é o ÚLTIMO capítulo lido, não o primeiro. Uma obra lida antes do run
 *    e continuada depois conta como "leu depois". Superestima.
 * 3. Amostra pequena por construção (1 run = até ~20 candidatos). Os intervalos são largos;
 *    trate como indício comparativo entre orderings, não como estimativa absoluta.
 *
 * O baseline "expected_score" reordena OS MESMOS candidatos pela Nota Prevista. É a
 * pergunta que decide se o Veredito paga a chamada de LLM: se ele não bate a Nota
 * Prevista, está reordenando de graça algo que já se sabia.
 */
import { createClient } from "@supabase/supabase-js"

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

type RunRow = {
  id: string
  user_id: string | null
  mode: string
  created_at: string
  results: unknown
}
type StateRow = { work_id: string; user_id: string; last_read_at: string | null }
type ScoreRow = { work_id: string; expected_score: number | null }

/** Paginação obrigatória: o select do PostgREST corta em 1000 linhas SEM AVISAR. */
async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as unknown as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/** Um candidato dentro de um run, com as duas ordenações concorrentes. */
type Candidate = { workId: string; alignment: number | null; expected: number | null }

/** Posição 1-based de `workId` quando os candidatos são ordenados por `score` desc. */
function positionOf(cands: Candidate[], workId: string, score: (c: Candidate) => number | null): number | null {
  const scored = cands.filter((c) => score(c) != null)
  if (scored.length < 2) return null
  const sorted = [...scored].sort((a, b) => (score(b) as number) - (score(a) as number))
  const idx = sorted.findIndex((c) => c.workId === workId)
  return idx < 0 ? null : idx + 1
}

type Hit = { pos: number; total: number }

function summarize(label: string, hits: Hit[]): string {
  if (hits.length === 0) return `${label.padEnd(22)} —  (sem acerto avaliável)`
  const n = hits.length
  const avgPos = hits.reduce((a, h) => a + h.pos, 0) / n
  // Percentil normalizado: 0 = topo da lista, 1 = fim. Acaso = 0,5 independentemente do N.
  const avgPct = hits.reduce((a, h) => a + (h.pos - 1) / (h.total - 1), 0) / n
  const top3 = hits.filter((h) => h.pos <= 3).length
  const top5 = hits.filter((h) => h.pos <= 5).length
  // Acaso por run: com N candidatos, a chance de cair no top-k é min(k,N)/N.
  const chance3 = hits.reduce((a, h) => a + Math.min(3, h.total) / h.total, 0) / n
  const chance5 = hits.reduce((a, h) => a + Math.min(5, h.total) / h.total, 0) / n
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`
  return (
    `${label.padEnd(22)} pos ${avgPos.toFixed(1).padStart(4)}  ` +
    `percentil ${avgPct.toFixed(3)}  ` +
    `top3 ${pct(top3 / n).padStart(4)} (acaso ${pct(chance3)})  ` +
    `top5 ${pct(top5 / n).padStart(4)} (acaso ${pct(chance5)})`
  )
}

async function main() {
  const [runs, states, scores] = await Promise.all([
    fetchAll<RunRow>("recommendation_runs", "id, user_id, mode, created_at, results"),
    fetchAll<StateRow>("user_work_state", "work_id, user_id, last_read_at"),
    fetchAll<ScoreRow>("calculated_scores", "work_id, expected_score"),
  ])

  // Leitura indexada por DONO — cruzar o run de um usuário com a leitura de outro
  // inventaria acerto onde não houve.
  const readAt = new Map<string, string>()
  for (const s of states) {
    if (s.last_read_at) readAt.set(`${s.user_id}::${s.work_id}`, s.last_read_at)
  }
  const expectedOf = new Map<string, number | null>()
  for (const s of scores) expectedOf.set(s.work_id, s.expected_score)

  const byAlignment: Hit[] = []
  const byExpected: Hit[] = []
  let runsUsed = 0
  let runsSemDono = 0
  const perMode = new Map<string, Hit[]>()

  for (const run of runs) {
    if (!Array.isArray(run.results)) continue
    if (!run.user_id) {
      runsSemDono += 1
      continue
    }
    const cands: Candidate[] = []
    for (const raw of run.results as Array<Record<string, unknown>>) {
      const workId = typeof raw?.work_id === "string" ? raw.work_id : null
      if (!workId) continue
      const a = raw.alignment_score
      cands.push({
        workId,
        alignment: typeof a === "number" ? a : a != null ? Number(a) : null,
        expected: expectedOf.get(workId) ?? null,
      })
    }
    if (cands.length < 2) continue
    runsUsed += 1

    for (const c of cands) {
      const read = readAt.get(`${run.user_id}::${c.workId}`)
      if (!read || new Date(read) <= new Date(run.created_at)) continue

      const posA = positionOf(cands, c.workId, (x) => x.alignment)
      if (posA != null) {
        const hit = { pos: posA, total: cands.filter((x) => x.alignment != null).length }
        byAlignment.push(hit)
        const list = perMode.get(run.mode) ?? []
        list.push(hit)
        perMode.set(run.mode, list)
      }
      const posE = positionOf(cands, c.workId, (x) => x.expected)
      if (posE != null) {
        byExpected.push({ pos: posE, total: cands.filter((x) => x.expected != null).length })
      }
    }
  }

  console.log(`\nRuns: ${runs.length} (usados: ${runsUsed}${runsSemDono ? `, sem user_id: ${runsSemDono}` : ""})`)
  console.log(`Leituras iniciadas depois do run: ${byAlignment.length}\n`)
  console.log("Onde estava, na lista, a obra que o usuário foi ler:")
  console.log("  (percentil 0 = topo · 0,5 = indistinguível do acaso · 1 = fim)\n")
  console.log("  " + summarize("Veredito IA", byAlignment))
  console.log("  " + summarize("Nota Prevista", byExpected))

  if (perMode.size > 1) {
    console.log("\n  Veredito IA por modo:")
    for (const [mode, hits] of [...perMode.entries()].sort()) {
      console.log("    " + summarize(mode, hits))
    }
  }

  if (byAlignment.length < 30) {
    console.log(
      `\n⚠️  ${byAlignment.length} acertos é pouco para separar as duas ordenações com confiança.` +
        `\n   Use como direção, não como veredito.`,
    )
  }
  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
