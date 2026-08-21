/**
 * Reverte notas que a auditoria de critérios (aposentada em 2026-08-16) aplicou SOZINHA.
 *
 * ALVO: NUVEM — grava em `category_scores`. US$0, nenhuma chamada de modelo.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/reverter-calibracao-auto-aplicada.ts
 *   ... --desde=2026-08-16     # só as aplicadas a partir desta data (o padrão é todas)
 *
 * ⚠️ O `--desde` filtra DEPOIS do dedup, de propósito: cortar antes esconderia uma aceitação
 * sua mais recente e o par voltaria a parecer candidato.
 *   ... --execute              # grava (o padrão é ensaio)
 *
 * 🔴 O corte é `auto_applied`, e ele é o que separa máquina de curadoria. Medido na nuvem
 * em 2026-08-17, das 40 notas com `source = 'ai_calibrated'`:
 *
 *   21  auto_applied  — ninguém olhou. |Δ| médio 1,55
 *   18  accepted      — a curadora olhou e concordou. |Δ| médio 2,00
 *    1  edited        — a curadora ajustou o valor proposto
 *
 * As 19 revisadas **não são candidatas**: são decisão humana, e desfazê-las seria apagar
 * curadoria. Só as auto-aplicadas voltam, porque foram escritas por um mecanismo que a
 * medição reprovou — gate de confiança calibrado numa escala que o modelo não produz
 * (satura em 0,85, o corte pedia 0,8 e alcançava 0,78%), e precisão 0 de 2 no topo.
 *
 * ⚠️ As 3 de 16/08 têm defeito nomeado individualmente: duas subiram `adult_content` por tag
 * de circunstância — o mecanismo que a **migration 182 rebaixou de propósito** — e uma subiu
 * `protagonist` justificando com "user_score altíssimo (9.4)", que é gosto de uma pessoa
 * entrando num atributo compartilhado. Por isso o `--desde` existe: dá pra reverter só elas.
 *
 * ⚠️ Volta ao par (`previous_score`, `previous_source`) gravado na própria sugestão — não a
 * um valor recalculado. E a sugestão vira `reverted`, senão o histórico seguiria dizendo
 * "aplicada" para um valor que já não existe.
 *
 * ⚠️ Isto NÃO dispara recálculo. As notas de atributo são features do Ridge, então clique em
 * "Recalcular notas" depois — o script imprime o lembrete.
 */
import { createClient } from "@supabase/supabase-js"
import { exigeAlvoNuvem } from "@/scripts/lib/exige-alvo-nuvem"
import { criarFunil } from "./lib/funil.mjs"

const EXECUTE = process.argv.includes("--execute")
const DESDE = process.argv.find((a) => a.startsWith("--desde="))?.slice("--desde=".length) ?? null
const COMANDO =
  "npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/reverter-calibracao-auto-aplicada.ts --execute"

interface Alvo {
  id: string
  work_id: string
  criterion_slug: string
  previous_score: number
  previous_source: string
  applied_at: string | null
  atual: number
  titulo: string
}

async function main() {
  if (EXECUTE) exigeAlvoNuvem(COMANDO)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  const sb = createClient(url, key)
  console.log(`alvo: ${url}`)
  console.log(EXECUTE ? "modo: EXECUTE (grava)" : "modo: ensaio (nada é gravado)")
  if (DESDE) console.log(`filtro: aplicadas a partir de ${DESDE}`)
  console.log()

  // 🔴 Busca as aplicações de QUALQUER status, não só as automáticas — e é isso que impede
  // o script de desfazer curadoria. Um par (obra, critério) pode ter sido auto-aplicado em
  // junho e ACEITO por você depois: filtrar só por `auto_applied` acha a antiga, e reverter
  // para o `previous_score` dela apagaria também a sua decisão posterior. Medido: 24 pares
  // com auto-aplicação no histórico, mas só 21 em que ela é a última palavra.
  const { data: sugs, error } = await sb
    .from("score_calibration_suggestions")
    .select("id, work_id, criterion_slug, previous_score, previous_source, applied_at, status")
    .in("status", ["auto_applied", "accepted", "edited"])
    .order("applied_at", { ascending: false })
  if (error) throw new Error(error.message)

  // Só reverte o que a auditoria ainda controla: se o score já virou `ai_accepted` (uma
  // reavaliação passou por cima) ou `ai_edited` (a curadora mexeu), a aplicação dela não
  // está mais em vigor e reverter escreveria por cima de quem veio depois.
  // ⚠️ Dedup por (obra, critério) mantendo a MAIS RECENTE. Um mesmo par pode ter sido
  // auto-aplicado mais de uma vez (medido: 26 sugestões para 21 pares), e a que vale é a
  // última — o `previous_score` dela é o valor imediatamente anterior ao que está no ar. Sem
  // isto o script listava a mesma nota duas vezes e só não revertia duas por acidente da
  // ordenação, porque a 2ª passada encontrava o source já trocado.
  const funil = criarFunil("reverter calibração auto-aplicada")
  funil.passo("aplicações no histórico", (sugs ?? []).length)

  const vistos = new Set<string>()
  const alvos: Alvo[] = []
  // Os estágios do meio: sem eles, "nada a reverter" não distingue "já revertido" de
  // "o filtro de status ou a janela --desde engoliram tudo".
  let pares = 0
  let autoAplicadas = 0
  let naJanela = 0
  for (const s of sugs ?? []) {
    const chave = `${s.work_id}::${s.criterion_slug}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    pares++
    // A última aplicação do par manda. Se foi sua, o par não é candidato.
    if (s.status !== "auto_applied") continue
    autoAplicadas++
    if (DESDE && String(s.applied_at ?? "") < DESDE) continue
    naJanela++
    const { data: cs } = await sb
      .from("category_scores")
      .select("score, source")
      .eq("work_id", s.work_id)
      .eq("criterion_slug", s.criterion_slug)
      .maybeSingle()
    if (!cs || cs.source !== "ai_calibrated") continue
    const { data: w } = await sb.from("works").select("title").eq("id", s.work_id).maybeSingle()
    alvos.push({
      id: s.id as string,
      work_id: s.work_id as string,
      criterion_slug: s.criterion_slug as string,
      previous_score: Number(s.previous_score),
      previous_source: String(s.previous_source),
      applied_at: (s.applied_at as string | null) ?? null,
      atual: Number(cs.score),
      titulo: (w?.title as string) ?? s.work_id,
    })
  }

  funil.passo("pares distintos (a última aplicação manda)", pares)
  funil.passo("cuja última aplicação foi automática", autoAplicadas)
  if (DESDE) funil.passo(`aplicadas desde ${DESDE}`, naJanela)
  funil.passo("ainda sob controle da auditoria", alvos.length)

  if (alvos.length === 0) {
    funil.nadaAFazer("nada a reverter.")
    return
  }
  funil.relatar()
  console.log("")
  for (const a of alvos) {
    console.log(
      `  ${(a.applied_at ?? "").slice(0, 10)}  ${a.titulo.slice(0, 38).padEnd(38)} ` +
        `${a.criterion_slug.padEnd(17)} ${a.atual.toFixed(1)} → ${a.previous_score.toFixed(1)} (volta a ${a.previous_source})`,
    )
  }
  console.log(`\n${alvos.length} notas a reverter.\n`)

  if (!EXECUTE) {
    console.log(`ensaio. Para gravar:\n  ${COMANDO}`)
    console.log(`Para reverter só as mais recentes:\n  ${COMANDO} --desde=2026-08-16`)
    return
  }

  let ok = 0
  for (const a of alvos) {
    const { error: e1 } = await sb
      .from("category_scores")
      .update({ score: a.previous_score, source: a.previous_source })
      .eq("work_id", a.work_id)
      .eq("criterion_slug", a.criterion_slug)
      .eq("source", "ai_calibrated") // corrida: alguém reavaliando enquanto isto roda
    if (e1) {
      console.error(`  ✘ ${a.titulo} / ${a.criterion_slug}: ${e1.message}`)
      continue
    }
    const { error: e2 } = await sb
      .from("score_calibration_suggestions")
      .update({ status: "reverted", reviewed_at: new Date().toISOString() })
      .eq("id", a.id)
    if (e2) console.error(`  ⚠ nota revertida mas sugestão não marcada: ${e2.message}`)
    ok += 1
  }
  console.log(`✔ ${ok} notas revertidas.`)
  console.log(`\n⚠️ Os atributos são features do Ridge — clique em "Recalcular notas" no app.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
