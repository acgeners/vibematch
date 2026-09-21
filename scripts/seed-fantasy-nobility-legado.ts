/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SEED de transição: `fantasy` e `nobility` recebem o valor do `fantasy_nobility` da obra,
 * marcados como HERDADOS (`source = 'legacy_split_copy'`, `ai_evaluation_id = null`).
 *
 * 🔴 ALVO: NUVEM — GRAVA no catálogo. Rodado contra o local, que é réplica descartável, o
 * trabalho é jogado fora no próximo `db:pull`.
 *
 *   # ensaio (PADRÃO): conta e imprime a amostra, não grava nada
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/seed-fantasy-nobility-legado.ts
 *
 *   # aplica
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/seed-fantasy-nobility-legado.ts --execute
 *
 * ⚠️ US$0 — nenhuma chamada de modelo. É cópia determinística de um valor que já existe.
 *
 * ## Por que o `on conflict do nothing` é o coração disto
 *
 * Ele é o que separa um SEED de um BACKFILL: obra que já recebeu avaliação REAL de `fantasy`
 * ou `nobility` tem linha em `category_scores` (UNIQUE work_id+criterion_slug), e o insert
 * simplesmente não a toca. Logo o script é IDEMPOTENTE e pode ser rodado a qualquer momento
 * da transição sem nunca sobrescrever trabalho novo com o legado.
 *
 * ## O que ele deliberadamente NÃO faz
 *
 * - NÃO copia justificativa. `ai_evaluation_scores.justification` é por critério, e as linhas de
 *   seed não têm avaliação — duplicar a prosa do misto afirmaria que ela sustenta duas notas
 *   separadas, que é exatamente a mistura que a separação existe para desfazer.
 * - NÃO toca `fantasy_nobility`. Ele continua intacto e continua alimentando o cálculo.
 * - NÃO deriva nada por fórmula. Obras novas recebem `fantasy`, `nobility` E `fantasy_nobility`
 *   do provider, em avaliação real.
 *
 * ## Rollback
 *
 *   delete from category_scores where source = 'legacy_split_copy';
 *
 * É exato e completo: nenhuma outra escrita usa esse valor.
 */
import { createClient } from "@supabase/supabase-js"
import { criarFunil } from "./lib/funil.mjs"

const EXECUTE = process.argv.includes("--execute")
const ORIGEM = "fantasy_nobility"
const DESTINOS = ["fantasy", "nobility"] as const
const SOURCE_HERDADO = "legacy_split_copy"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

/**
 * Pagina uma leitura, com a chave de ordenação OBRIGATÓRIA.
 *
 * 🔴 `range()` sem `order` NÃO é paginação estável: o Postgres não promete ordem entre
 * páginas, então a mesma linha pode vir duas vezes e outra sumir. Medido na nuvem em
 * 2026-09-21, lendo as 2.050 linhas de `fantasy`+`nobility` em 3 páginas: **2.050 lidas,
 * 1.550 ÚNICAS** — 500 repetidas e 500 perdidas. Como o resultado alimenta o `jaTem`, o seed
 * concluiu que 500 obras ainda precisavam de `nobility` e anunciou "500 linhas semeadas"
 * tendo gravado ZERO (o `on conflict` absorveu). Pior: é NÃO-determinístico — repetindo a
 * mesma leitura deu 1.525 e depois 2.050, ou seja às vezes acerta por acaso.
 *
 * ⚠️ E o lado caro não é o que apareceu. Na leitura da ORIGEM, perder linhas faria o seed
 * PULAR obras em silêncio — `on conflict` não protege contra isso, porque a linha nunca
 * chega a ser tentada.
 *
 * ⚠️ A chave tem que ser TOTAL (única no conjunto lido), senão a instabilidade volta dentro
 * dos empates: `work_id` basta sob um `criterion_slug` fixo, mas com dois slugs é preciso
 * `work_id, criterion_slug`. Por isso é parâmetro, e não default — assim não dá para esquecer.
 */
async function pageAll<T>(base: () => any, orderBy: string[]): Promise<T[]> {
  if (orderBy.length === 0) throw new Error("pageAll: chave de ordenação é obrigatória")
  const out: T[] = []
  for (let f = 0; ; f += 1000) {
    let q = base()
    for (const col of orderBy) q = q.order(col)
    const { data, error } = await q.range(f, f + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

async function main() {
  const funil = criarFunil(`seed ${DESTINOS.join("/")} ← ${ORIGEM}`)

  // os critérios precisam existir: a FK de category_scores aponta para `criteria.slug`
  const { data: crit, error: eCrit } = await sb.from("criteria").select("slug").in("slug", DESTINOS)
  if (eCrit) throw new Error(`criteria: ${eCrit.message}`)
  const faltando = DESTINOS.filter((d) => !(crit ?? []).some((c: any) => c.slug === d))
  if (faltando.length) {
    console.error(
      `FATAL: ${faltando.join(", ")} não existe(m) em \`criteria\`. Aplique a migration 197 antes.`,
    )
    process.exit(1)
  }

  const origem = await pageAll<{ work_id: string; score: number | string }>(
    () => sb.from("category_scores").select("work_id, score").eq("criterion_slug", ORIGEM),
    ["work_id"], // único sob um criterion_slug fixo (UNIQUE work_id+criterion_slug)
  )
  funil.passo(`obras com ${ORIGEM}`, origem.length)

  const existentes = await pageAll<{ work_id: string; criterion_slug: string; source: string | null }>(
    () => sb.from("category_scores").select("work_id, criterion_slug, source").in("criterion_slug", DESTINOS),
    ["work_id", "criterion_slug"], // DOIS slugs ⇒ work_id sozinho não é chave total
  )
  const jaTem = new Set(existentes.map((r) => `${r.work_id}|${r.criterion_slug}`))
  const jaReal = existentes.filter((r) => r.source !== SOURCE_HERDADO).length

  const linhas = origem.flatMap((o) =>
    DESTINOS.filter((slug) => !jaTem.has(`${o.work_id}|${slug}`)).map((slug) => ({
      work_id: o.work_id,
      criterion_slug: slug,
      score: Number(o.score),
      source: SOURCE_HERDADO,
      ai_evaluation_id: null,
    })),
  )
  /**
   * 🔴 O funil conta OBRAS, não linhas — as duas etapas são obras e a queda é legível.
   * A 1ª versão punha "linhas de destino já existentes" (0 na 1ª execução) como estágio, e o
   * funil marcava DRENO de 100% sobre um zero que é o estado inicial esperado: o alarme que
   * sempre toca. Quantas linhas serão inseridas é informação LATERAL, impressa fora da cadeia.
   */
  const obrasPendentes = new Set(linhas.map((l) => l.work_id)).size
  funil.passo("obras que ainda precisam de ao menos um destino", obrasPendentes)
  console.log(`  ⇒ ${linhas.length} linha(s) a inserir (${DESTINOS.length} por obra pendente)`)
  console.log(`  ⇒ ${existentes.length} linha(s) de destino já existem (${jaReal} de avaliação REAL)`)

  if (jaReal > 0) {
    console.log(`  ⚠️  ${jaReal} linha(s) de destino já têm avaliação REAL — preservadas pelo on-conflict.`)
  }

  if (linhas.length === 0) {
    funil.nadaAFazer("nada a semear — todas as obras já têm as duas notas.")
    funil.relatar()
    return
  }

  console.log(`\namostra (5 de ${linhas.length}):`)
  for (const l of linhas.slice(0, 5)) {
    console.log(`  ${l.work_id.slice(0, 8)} ${l.criterion_slug.padEnd(9)} ${l.score}  source=${l.source}`)
  }
  funil.relatar()

  if (!EXECUTE) {
    console.log(`\nENSAIO — nada gravado. Para aplicar: --execute`)
    return
  }

  /**
   * 🔴 Conta o que ENTROU, nunca o tamanho do lote. `ignoreDuplicates` descarta em silêncio,
   * então `gravadas += lote.length` afirma trabalho que pode não ter acontecido — foi assim
   * que a 2ª execução anunciou "500 linhas semeadas" tendo gravado zero. O `.select()` faz o
   * PostgREST devolver as linhas REALMENTE inseridas.
   */
  let gravadas = 0
  let mandadas = 0
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500)
    const { data, error } = await sb
      .from("category_scores")
      .upsert(lote, { onConflict: "work_id,criterion_slug", ignoreDuplicates: true })
      .select("id")
    if (error) throw new Error(`insert: ${error.message}`)
    gravadas += data?.length ?? 0
    mandadas += lote.length
    console.log(`  ${gravadas}/${linhas.length}`)
  }
  if (gravadas !== mandadas) {
    console.log(`\n⚠️  ${mandadas} linha(s) enviadas, ${gravadas} gravada(s) — ${mandadas - gravadas} já existiam.`)
  }
  console.log(`\n✓ ${gravadas} linhas semeadas com source=${SOURCE_HERDADO}.`)
  console.log(`  rollback: delete from category_scores where source = '${SOURCE_HERDADO}';`)
}

main().catch((e) => {
  console.error("FALHOU:", e.message)
  process.exit(1)
})
