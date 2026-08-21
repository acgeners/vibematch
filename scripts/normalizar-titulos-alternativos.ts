/**
 * Quebra os títulos alternativos que ficaram GRUDADOS numa string só e dedupa a lista. A
 * régua é `lib/titles/alternative-titles.ts` — este script só a aplica, pagina e grava.
 *
 * 🔴 ALVO: NUVEM — GRAVA no catálogo. Rodado contra o local, que é réplica descartável, o
 * trabalho é jogado fora no próximo `db:pull`. E aqui o alvo importa mais que o de costume:
 * o clone tem 988 obras e a nuvem 1.019, e a obra que motivou o conserto
 * (`Trash Will Always Be Trash`) **só existe na nuvem**.
 *
 *   # ensaio (PADRÃO): imprime o diff chip a chip e não grava nada
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/normalizar-titulos-alternativos.ts
 *
 *   # aplica
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/normalizar-titulos-alternativos.ts --execute
 *
 * ⚠️ US$0 — nenhuma chamada de modelo. `alternative_titles` não é input do recalc nem do
 * hash de `work_embeddings` (quem entra lá é `title`/`original_title`), então nada
 * re-embeda, nada reavalia e o badge "Recalcular notas" não acende. O único efeito é a
 * BUSCA melhorar: alias composto não casa com nada em `foldTitle`, logo os títulos que
 * saem dele passam a ser encontráveis em `/catalog` e pela detecção de duplicata.
 *
 * ## Por que o ensaio não é burocracia
 *
 * A quebra é conservadora de propósito (só quebra em `" / "`, `•`, `|`, quebra de linha e
 * `;` seguido de espaço — nunca em vírgula, `·` ou barra colada), mas quem conhece as obras
 * é a única pessoa capaz de vetar uma linha: título estilizado com barra existe
 * (`Fate/Zero`) e nenhuma régua sabe disso sozinha. Leia o diff antes de aplicar.
 */
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { alternativeTitlesFixOrNull } from "@/lib/titles/alternative-titles"
// O dono da retenção de `.backups` é ÚNICO — ver scripts/lib/backups-retencao.mjs.
import { podar } from "./lib/backups-retencao.mjs"
import { criarFunil } from "./lib/funil.mjs"

const EXECUTAR = process.argv.includes("--execute")

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface WorkRow {
  id: string
  title: string
  alternative_titles: string[] | null
}

/**
 * ⚠️ Paginado obrigatoriamente: o `select` do PostgREST corta em 1000 linhas SEM avisar, e a
 * nuvem já passou disso (1.019 obras em 2026-08-18). Truncado, o script diria "nada a fazer"
 * sobre as obras que sobraram — o erro que produz resultado.
 */
async function lerTodasAsObras(): Promise<WorkRow[]> {
  const out: WorkRow[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb
      .from("works")
      .select("id, title, alternative_titles")
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

  const funil = criarFunil("normalizar títulos alternativos")

  const obras = await lerTodasAsObras()
  funil.passo("obras lidas", obras.length)

  const plano = obras
    .map((o) => ({
      id: o.id,
      titulo: o.title,
      antes: o.alternative_titles ?? [],
      depois: alternativeTitlesFixOrNull(o.alternative_titles),
    }))
    .filter((p): p is typeof p & { depois: string[] } => p.depois !== null)

  funil.passo("com alias fora da régua", plano.length)
  if (plano.length === 0) {
    funil.nadaAFazer("nada a corrigir.")
    return
  }
  funil.relatar()
  console.log("")

  // Imprime só o que MUDA: lista inteira lado a lado esconde a diferença no meio de 40 chips.
  console.log(`${plano.length} obra(s) a corrigir:\n`)
  let quebrados = 0
  let removidos = 0
  for (const p of plano) {
    const depois = new Set(p.depois)
    const saem = p.antes.filter((t) => !depois.has(t))
    const entram = p.depois.filter((t) => !p.antes.includes(t))
    quebrados += saem.length
    removidos += saem.length - entram.length
    console.log(`  ${p.titulo}  (${p.antes.length} → ${p.depois.length} chips)`)
    for (const t of saem) console.log(`    − [${t}]`)
    for (const t of entram) console.log(`    + [${t}]`)
    console.log()
  }
  console.log(`${quebrados} chip(s) tocado(s) · saldo de ${removidos} a menos na lista\n`)

  if (!EXECUTAR) {
    console.log("ENSAIO — nada gravado. Repita com --execute para aplicar.")
    return
  }

  // Poda ANTES de gravar: ensaio interrompido deixa lixo igual ao de execução completa.
  podar("normalizar-titulos-alternativos")

  // Snapshot ANTES de escrever: é a única rede pra desfazer (o banco não tem PITR).
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = path.resolve(process.cwd(), ".backups", `normalizar-titulos-alternativos-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "plano.json"), JSON.stringify(plano, null, 2))
  console.log(`estado anterior salvo em ${path.relative(process.cwd(), dir)}/plano.json\n`)

  let ok = 0
  for (const p of plano) {
    const { error } = await sb
      .from("works")
      .update({ alternative_titles: p.depois })
      .eq("id", p.id)
    if (error) {
      console.error(`  ✗ ${p.titulo} — ${error.message}`)
      continue
    }
    ok++
  }
  console.log(`✅ ${ok}/${plano.length} obra(s) normalizada(s)`)
  if (ok < plano.length) {
    console.error(`⚠️  ${plano.length - ok} falharam — o script é idempotente, pode repetir.`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
