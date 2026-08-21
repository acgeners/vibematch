/**
 * Backfill determinístico: realinha a FAIXA CITADA na prosa com a nota que a obra exibe.
 *
 * O problema: a ficha da obra mostra a nota (de `category_scores`) ao lado da justificativa
 * (de `ai_evaluation_scores`). Quando um pós-processamento moveu a nota — ou o modelo se
 * contradisse —, a prosa segue abrindo com "Faixa 4-6 (Suggestive)" enquanto o número já é
 * 7,0. Medido com `scripts/coherence-audit.ts` (checagem A, n=8.673): 149 casos.
 *
 * 🔴 CADA CASO RECEBE O RÓTULO QUE A EVIDÊNCIA SUSTENTA — nada além disso. A tentação era
 * escrever "definida pelo limite obrigatório" nos 149; medindo, só 85 têm a impressão
 * digital do clamp. Afirmar a causa nos outros seria inventar um motivo na tela, que é o
 * mesmo defeito que este backfill existe pra remover.
 *
 *   85  adult_content, `ai_accepted`, nota EXATA num piso (5/7/9) e prosa citando faixa
 *       abaixo  → "definida pelo limite obrigatório"
 *   41  causa não verificável (adult sem bater piso + modelo se contradizendo sozinho)
 *       → rótulo NEUTRO, só declara a divergência
 *   23  a nota foi editada por humano (`ai_edited`) → **PULADAS**. Reescrever a prosa do
 *       modelo pra casar com o número que a curadora escolheu afirmaria que o modelo
 *       concluiu aquilo. A divergência ali é esperada e informativa.
 *
 * ⚠️ `adultContentBounds.applied` NÃO serve pra atribuir a causa: o campo só existe desde a
 * v22 (2026-07-24) e está ausente em todos os 149. Por isso a impressão digital numérica.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/backfill-faixa-citada.ts
 *   ... --execute
 *
 * Idempotente: reaplicar não empilha rótulos (a prosa já realinhada não casa o critério).
 * Reversível em informação: a faixa original fica preservada em "conclui faixa X-Y".
 */
import { createClient } from "@supabase/supabase-js"
import { realinharFaixaCitada } from "@/lib/ai-evaluation/service"
import { bandForScore } from "@/lib/criteria/justification"
import { criarFunil } from "./lib/funil.mjs"

const EXECUTE = process.argv.includes("--execute")
const PISOS = new Set([5, 7, 9])

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
const sb = createClient(url, key)

interface Linha {
  id: string
  workId: string
  titulo: string
  slug: string
  nota: number
  source: string
  just: string
}

async function carregar(): Promise<Linha[]> {
  const out: Linha[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("category_scores")
      .select("work_id, criterion_slug, score, source, works(title), ai_evaluations(ai_evaluation_scores(id, criterion_slug, justification))")
      .not("ai_evaluation_id", "is", null)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as Array<{
      work_id: string; criterion_slug: string; score: string; source: string
      works?: { title?: string } | null
      ai_evaluations?: { ai_evaluation_scores?: Array<{ id: string; criterion_slug: string; justification: string | null }> } | null
    }>
    for (const r of rows) {
      const s = r.ai_evaluations?.ai_evaluation_scores?.find((x) => x.criterion_slug === r.criterion_slug)
      if (s?.justification) {
        out.push({
          id: s.id, workId: r.work_id, titulo: r.works?.title ?? r.work_id,
          slug: r.criterion_slug, nota: Number(r.score), source: r.source, just: s.justification,
        })
      }
    }
    if (rows.length < 1000) break
  }
  return out
}

function classificar(l: Linha): { acao: "limite" | "desconhecida" | "pular"; motivo: string } {
  const citada = l.just.match(/Faixa\s+(\d+-\d+)/i)?.[1]
  if (!citada || citada === bandForScore(l.nota)) return { acao: "pular", motivo: "coerente ou sem faixa citada" }
  if (l.source === "ai_edited") return { acao: "pular", motivo: "nota editada por humano" }
  const prosaAbaixo = Number(citada.split("-")[0]) < Number(bandForScore(l.nota).split("-")[0])
  if (l.slug === "adult_content" && PISOS.has(l.nota) && prosaAbaixo) {
    return { acao: "limite", motivo: "nota exata num piso, prosa abaixo" }
  }
  return { acao: "desconhecida", motivo: "causa não verificável" }
}

async function main() {
  console.log(`modo: ${EXECUTE ? "EXECUTE (grava)" : "dry-run"}`)
  console.log(`alvo: ${url}\n`)

  const linhas = await carregar()
  const grupos = { limite: [] as Linha[], desconhecida: [] as Linha[], pular: [] as Linha[] }
  const motivos = new Map<string, number>()
  for (const l of linhas) {
    const { acao, motivo } = classificar(l)
    grupos[acao].push(l)
    if (acao !== "pular" || motivo === "nota editada por humano") {
      motivos.set(`${acao}: ${motivo}`, (motivos.get(`${acao}: ${motivo}`) ?? 0) + 1)
    }
  }

  const funil = criarFunil("backfill da faixa citada")
  funil.passo("atributos com justificativa", linhas.length)
  for (const [k, v] of [...motivos].sort()) console.log(`  ${k}: ${v}`)
  const alvo = [...grupos.limite, ...grupos.desconhecida]
  funil.passo("a reescrever", alvo.length)
  if (alvo.length === 0) {
    funil.nadaAFazer("\nnada a reescrever.")
    return
  }
  funil.relatar()

  for (const l of alvo.slice(0, 3)) {
    const causa = grupos.limite.includes(l) ? "limite" : "desconhecida"
    console.log(`\n— [${l.slug} = ${l.nota}] ${l.titulo}  (${causa})`)
    console.log(`  antes:  ${l.just.slice(0, 110)}`)
    console.log(`  depois: ${realinharFaixaCitada(l.just, l.nota, causa).slice(0, 110)}`)
  }

  if (!EXECUTE) {
    console.log(`\n[dry-run] nada gravado. Rode com --execute pra aplicar.`)
    return
  }

  let ok = 0
  for (const [causa, lista] of [["limite", grupos.limite], ["desconhecida", grupos.desconhecida]] as const) {
    for (const l of lista) {
      const nova = realinharFaixaCitada(l.just, l.nota, causa)
      if (nova === l.just) continue
      const { error } = await sb.from("ai_evaluation_scores").update({ justification: nova }).eq("id", l.id)
      if (error) console.error(`  ✗ ${l.titulo}/${l.slug}: ${error.message}`)
      else ok++
    }
  }
  console.log(`\n✅ ${ok} justificativa(s) realinhada(s).`)
  console.log(`⚠️ Isto é o banco LOCAL. A nuvem tem as próprias linhas — rode lá separadamente.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
