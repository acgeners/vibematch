/**
 * Varredura ÚNICA da fila de sugestões de calibração: fecha o que as regras de hoje já
 * tornaram inaplicável.
 *
 * ALVO: NUVEM — grava (`status = superseded`). US$0, nenhuma chamada de modelo.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/limpar-fila-calibracao.ts
 *   ... --execute      # grava (o padrão é ensaio)
 *
 * 🔴 Por que existe: as três guardas que entraram em 16/08/2026 (escopo por critério, valor
 * do baseline, source travado) barram a APLICAÇÃO uma a uma, no clique. Elas não limpam o
 * que já estava na fila — então a pessoa continua vendo 765 linhas das quais 39% não têm
 * ação possível, e descobre isso item por item, errando o clique. Medido antes de rodar:
 *
 *   204  critério fora do escopo (`adult_content`, `couple_dynamics`)
 *   102  baseline morto — a nota mudou depois da sugestão, que julgou outro número
 *     8  score travado (`manual` / `ai_edited`)
 *
 * ⚠️ `superseded`, nunca `rejected`. A distinção não é cosmética: `rejected` afirma que a
 * curadora olhou e recusou o mérito. Nenhuma destas foi olhada — elas envelheceram, e o
 * histórico precisa continuar dizendo a verdade sobre quem decidiu o quê.
 *
 * ⚠️ É de uma vez só por desenho. Se este script precisar rodar de novo, alguma guarda
 * parou de segurar na origem — investigue lá, não aqui.
 */
import { createClient } from "@supabase/supabase-js"
import { isAuditableCriterion } from "@/lib/ai-calibration/policy"
import { exigeAlvoNuvem } from "@/scripts/lib/exige-alvo-nuvem"

const EXECUTE = process.argv.includes("--execute")
const COMANDO =
  "npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/limpar-fila-calibracao.ts --execute"

type Motivo = "fora-de-escopo" | "baseline-morto" | "score-travado"

const ROTULO: Record<Motivo, string> = {
  "fora-de-escopo": "critério fora do escopo da auditoria",
  "baseline-morto": "a nota mudou depois da sugestão",
  "score-travado": "score travado (manual/ai_edited)",
}

const LOCKED = new Set(["manual", "ai_edited"])

interface Pendente {
  id: string
  work_id: string
  criterion_slug: string
  previous_score: string | number
}

async function main() {
  if (EXECUTE) exigeAlvoNuvem(COMANDO)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  const sb = createClient(url, key)
  console.log(`alvo: ${url}`)
  console.log(EXECUTE ? "modo: EXECUTE (grava)\n" : "modo: ensaio (nada é gravado)\n")

  // ⚠️ Pagina. `score_calibration_suggestions` já passou de 1000 linhas, e um select cru
  // devolveria um recorte silencioso — a fila "limpa" ficaria com o resto invisível.
  const pendentes: Pendente[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("score_calibration_suggestions")
      .select("id, work_id, criterion_slug, previous_score")
      .eq("status", "pending")
      .order("id", { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    pendentes.push(...((data ?? []) as Pendente[]))
    if ((data?.length ?? 0) < 1000) break
  }

  const { count: total, error: countError } = await sb
    .from("score_calibration_suggestions")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")
  if (countError) throw new Error(countError.message)
  if (total !== pendentes.length) {
    throw new Error(`paginação incompleta: ${pendentes.length} lidas contra ${total} no count exato`)
  }
  console.log(`pendentes: ${pendentes.length} (conferido contra count exato)\n`)

  // Estado ATUAL de cada (obra, critério) — é ele que decide baseline morto e travado.
  const chaves = new Set(pendentes.map((p) => `${p.work_id}::${p.criterion_slug}`))
  const atual = new Map<string, { score: number; source: string }>()
  const workIds = [...new Set(pendentes.map((p) => p.work_id))]
  for (let i = 0; i < workIds.length; i += 150) {
    const { data, error } = await sb
      .from("category_scores")
      .select("work_id, criterion_slug, score, source")
      .in("work_id", workIds.slice(i, i + 150))
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const k = `${r.work_id}::${r.criterion_slug}`
      if (chaves.has(k)) atual.set(k, { score: Number(r.score), source: String(r.source) })
    }
  }

  const porMotivo = new Map<Motivo, string[]>()
  for (const p of pendentes) {
    const cur = atual.get(`${p.work_id}::${p.criterion_slug}`)
    let motivo: Motivo | null = null
    // Ordem = precedência da explicação. Escopo primeiro: ele vale mesmo que a nota também
    // tenha mudado, e é o motivo mais informativo pra quem lê o log.
    if (!isAuditableCriterion(p.criterion_slug)) motivo = "fora-de-escopo"
    else if (cur && LOCKED.has(cur.source)) motivo = "score-travado"
    else if (cur && cur.score !== Number(p.previous_score)) motivo = "baseline-morto"
    if (!motivo) continue
    const lista = porMotivo.get(motivo) ?? []
    lista.push(p.id)
    porMotivo.set(motivo, lista)
  }

  const alvo = [...porMotivo.values()].flat()
  for (const motivo of Object.keys(ROTULO) as Motivo[]) {
    const n = porMotivo.get(motivo)?.length ?? 0
    console.log(`  ${String(n).padStart(4)}  ${ROTULO[motivo]}`)
  }
  console.log(`\n  ${String(alvo.length).padStart(4)}  a fechar como "superseded"`)
  console.log(`  ${String(pendentes.length - alvo.length).padStart(4)}  seguem pendentes\n`)

  if (!EXECUTE) {
    console.log(`ensaio. Para gravar:\n  ${COMANDO}`)
    return
  }

  let fechadas = 0
  for (let i = 0; i < alvo.length; i += 200) {
    const lote = alvo.slice(i, i + 200)
    const { error } = await sb
      .from("score_calibration_suggestions")
      .update({ status: "superseded", reviewed_at: new Date().toISOString() })
      .in("id", lote)
      .eq("status", "pending") // corrida: alguém aceitando no app enquanto isto roda
    if (error) throw new Error(error.message)
    fechadas += lote.length
  }
  console.log(`✔ ${fechadas} sugestões fechadas.`)

  const { count: restam } = await sb
    .from("score_calibration_suggestions")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")
  console.log(`fila agora: ${restam} pendentes.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
