/**
 * Normaliza `works.title`: tira espaço das pontas e conserta a caixa das palavras que estão
 * erradas por QUALQUER padrão de título em inglês. A régua é `lib/titles/title-normalize.ts`
 * — este script só a aplica, pagina e grava.
 *
 * 🔴 ALVO: NUVEM — GRAVA no catálogo. Rodado contra o local, que é réplica descartável, o
 * trabalho é jogado fora no próximo `db:pull`.
 *
 *   # ensaio (PADRÃO): imprime o diff linha a linha e não grava nada
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/normalizar-titulos.ts
 *
 *   # aplica
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/normalizar-titulos.ts --execute
 *
 * ⚠️ US$0 de modelo. O único custo é indireto e medido: o título entra no hash de
 * `work_embeddings`, então cada obra tocada re-embeda na próxima passada de embeddings —
 * `text-embedding-3-small` a US$0,02/M tokens ⇒ ~US$0,001 pelas 20. O cache de avaliação
 * de IA também muda de chave, e ali o efeito é ~zero: medido em `ai_cache_events`,
 * `hit_persistent` foi 4 em 1.017 consultas (0,4%).
 *
 * ⚠️ A URL NÃO muda: `titleToSlug` faz `.toLowerCase()` antes de tudo, então caixa não move
 * o slug e nada entra em `previous_slugs`. E `title` não é input do recalc (quem é
 * `original_title`), então o badge "Recalcular notas" não acende.
 *
 * ## Por que o ensaio é obrigatório, e não burocracia
 *
 * A regra ingênua ("palavrinha no meio → minúscula") tem 50% de falso positivo: das 18
 * obras que ela acusava, 9 já estavam certas (a palavra abria um subtítulo). E foi o ensaio
 * contra o catálogo REAL que pegou o bug do `~` em `Nullitas ~The Counterfeit Bride~`, que
 * nenhum teste inventado teria encontrado. Além disso, título oficial às vezes é estilizado
 * de propósito — só quem conhece as obras pode vetar uma linha do diff.
 */
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { titleFixOrNull } from "@/lib/titles/title-normalize"
// O dono da retenção de `.backups` é ÚNICO — ver scripts/lib/backups-retencao.mjs.
import { podar } from "./lib/backups-retencao.mjs"
// "nada a corrigir" tem de sair junto do funil — ver scripts/lib/funil.mjs.
import { criarFunil } from "./lib/funil.mjs"

const EXECUTAR = process.argv.includes("--execute")

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface WorkRow {
  id: string
  title: string
}

/**
 * ⚠️ Paginado obrigatoriamente: o `select` do PostgREST corta em 1000 linhas SEM avisar, e
 * o catálogo tem ~988 obras — a 15 linhas do corte. Truncado, obras sumiriam do plano e o
 * script diria "nada a fazer": o erro que produz resultado.
 */
async function lerTodosOsTitulos(): Promise<WorkRow[]> {
  const out: WorkRow[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb
      .from("works")
      .select("id, title")
      .order("id")
      .range(from, from + 499)
    if (error) throw new Error(`works: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as WorkRow[]))
    if (data.length < 500) break
  }
  return out
}

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("FATAL: sem SUPABASE_SERVICE_ROLE_KEY — use --env-file=.env.local")
    process.exit(1)
  }
  const alvo = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(sem url)"
  const ehLocal = /127\.0\.0\.1|localhost/.test(alvo)
  console.log(`alvo: ${alvo}${ehLocal ? "  ⚠️  LOCAL — este script quer a NUVEM" : ""}`)

  const funil = criarFunil("normalizar títulos")

  const obras = await lerTodosOsTitulos()
  funil.passo("obras lidas", obras.length)

  const plano = obras
    .map((o) => ({ id: o.id, antes: o.title, depois: titleFixOrNull(o.title) }))
    .filter((p): p is { id: string; antes: string; depois: string } => p.depois !== null)
  funil.passo("com título fora da régua", plano.length)

  if (plano.length === 0) {
    // A cadeia sai JUNTO da frase: "nada a corrigir" sozinho não distingue "o catálogo está
    // limpo" de "a leitura veio vazia".
    funil.nadaAFazer("nada a corrigir.")
    return
  }
  funil.relatar()
  console.log("")

  // Colchetes marcam as pontas: sem eles, espaço sobrando é invisível justamente no
  // ensaio que existe pra torná-lo visível.
  console.log(`${plano.length} obra(s) a corrigir:\n`)
  for (const p of plano) {
    console.log(`  [${p.antes}]`)
    console.log(`→ [${p.depois}]\n`)
  }

  if (!EXECUTAR) {
    console.log("ENSAIO — nada gravado. Repita com --execute para aplicar.")
    return
  }

  // Poda ANTES de gravar: ensaio interrompido deixa lixo igual ao de execução completa.
  podar("normalizar-titulos")

  // Snapshot ANTES de escrever: é a única rede pra desfazer (o banco não tem PITR).
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = path.resolve(process.cwd(), ".backups", `normalizar-titulos-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "plano.json"), JSON.stringify(plano, null, 2))
  console.log(`estado anterior salvo em ${path.relative(process.cwd(), dir)}/plano.json\n`)

  let ok = 0
  for (const p of plano) {
    const { error } = await sb.from("works").update({ title: p.depois }).eq("id", p.id)
    if (error) {
      console.error(`  ✗ [${p.antes}] — ${error.message}`)
      continue
    }
    ok++
  }
  console.log(`✅ ${ok}/${plano.length} título(s) normalizado(s)`)
  if (ok < plano.length) {
    console.error(`⚠️  ${plano.length - ok} falharam — o script é idempotente, pode repetir.`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
