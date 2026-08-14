/**
 * Sobe a ESTRUTURA DE ABERTURA do local para a nuvem — dry-run por padrão, US$0.
 *
 *   npx tsx --env-file=.env.local scripts/push-opening-structure.ts
 *   npx tsx --env-file=.env.local scripts/push-opening-structure.ts --execute
 *
 * ALVO: NUVEM — ele GRAVA, e o destino é produção. A leitura vem do Postgres local por
 * `psql`; nada aqui usa `.env.analysis`.
 *
 * ── POR QUE EXISTE ──────────────────────────────────────────────────────────────────────
 *
 * A análise de abertura (`opening_structure*`, migration 185) foi rodada no LOCAL, e o local
 * é réplica descartável: o próximo `db:pull` reconstrói tudo a partir da nuvem e o resultado
 * some. Achado pelo `db:health` em 2026-08-14 — 2 obras com dado que só existe no local:
 *
 *   I Tamed the Monster Prince  → flashforward
 *   The Duchess' 50 Tea Recipes → indeterminado
 *
 * 🔴 As 9 colunas JÁ EXISTEM na nuvem (a 185 está aplicada lá). O que falta é só o conteúdo
 * — por isso dá para subir sem migration nenhuma. Se um dia elas não existirem no destino, o
 * script para com o erro do PostgREST em vez de gravar pela metade.
 *
 * ⚠️ Sobe apenas linhas em que o LOCAL tem valor e a NUVEM não. Nunca sobrescreve o que já
 * está lá: a nuvem é a fonte de verdade, e este script existe para resgatar o que ficou para
 * trás, não para reverter o que produção decidiu.
 *
 * ⚠️ Não recalcula nada — é transporte de dado. A análise em si custa IA e é outra decisão.
 */

import { writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { exigeAlvoNuvem } from "./lib/exige-alvo-nuvem"
// O dono da retenção é ÚNICO de propósito — ver scripts/lib/backups-retencao.mjs
import { podar } from "./lib/backups-retencao.mjs"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const EXECUTE = process.argv.includes("--execute")
if (EXECUTE) {
  exigeAlvoNuvem("npx tsx --env-file=.env.local scripts/push-opening-structure.ts --execute")
}

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const local = (sql: string) =>
  execFileSync("psql", [LOCAL, "-At", "-c", sql], { encoding: "utf8" }).trim()

async function rest<T>(path: string, init?: RequestInit): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key!,
      Authorization: `Bearer ${key!}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers ?? {}),
    },
  })
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${(await r.text()).slice(0, 220)}`)
  const txt = await r.text()
  return txt ? (JSON.parse(txt) as T[]) : []
}

/**
 * As colunas GRAVÁVEIS da migration 185.
 *
 * 🔴 `opening_structure` fica de FORA: na nuvem ela é `GENERATED ALWAYS AS
 * COALESCE(opening_structure_override, opening_structure_auto)`, e tentar escrevê-la devolve
 * *"column can only be updated to DEFAULT"* (428C9). Ela se resolve sozinha assim que as duas
 * fontes sobem — é o valor que se quer, não a coluna que se escreve.
 *
 * ⚠️ O erro veio no `--execute`, não no dry-run, porque só o PATCH real toca a restrição. Um
 * dry-run que "passa" não prova que a escrita passa.
 */
const COLS = [
  "opening_structure_auto",
  "opening_structure_auto_confidence",
  "opening_structure_auto_evidence",
  "opening_structure_auto_rationale",
  "opening_structure_auto_source",
  "opening_structure_auto_model",
  "opening_structure_auto_at",
  "opening_structure_override",
]

async function main() {
  console.log(`origem: LOCAL · destino: ${url}`)
  console.log(EXECUTE ? "modo: EXECUTE (grava)\n" : "modo: dry-run (não grava — use --execute)\n")

  // Uma linha por obra, em JSON, para não brigar com aspas/quebras dentro dos textos.
  const bruto = local(
    `select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (
       select id::text as id, title, opening_structure, ${COLS.map((c) => `"${c}"`).join(", ")}
       from public.works where opening_structure is not null order by title
     ) t`,
  )
  const doLocal = JSON.parse(bruto) as Array<Record<string, unknown>>
  if (doLocal.length === 0) {
    console.log("nada com opening_structure no local — nada a subir.")
    return
  }

  const ids = doLocal.map((r) => String(r.id))
  const naNuvem = await rest<{ id: string; opening_structure: string | null }>(
    `works?select=id,opening_structure&id=in.(${ids.join(",")})`,
  )
  const jaTem = new Map(naNuvem.map((r) => [r.id, r.opening_structure]))

  const snapshot: Record<string, unknown> = { quando: new Date().toISOString(), url, antes: naNuvem }
  let subiu = 0

  for (const linha of doLocal) {
    const id = String(linha.id)
    const titulo = String(linha.title)
    console.log(`▸ ${titulo}`)

    if (!jaTem.has(id)) {
      console.log(`   obra não existe na nuvem — pulada\n`)
      continue
    }
    if (jaTem.get(id) != null) {
      // A nuvem é a fonte de verdade: se ela já decidiu, não se mexe.
      console.log(`   a nuvem já tem "${jaTem.get(id)}" — preservada\n`)
      continue
    }

    const patch: Record<string, unknown> = {}
    for (const c of COLS) patch[c] = linha[c] ?? null
    console.log(`   → subir "${linha.opening_structure}" (${COLS.filter((c) => linha[c] != null).length} de ${COLS.length} colunas preenchidas)`)

    if (EXECUTE) {
      await rest(`works?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) })
      console.log(`   ✓ gravado`)
      subiu++
    }
    console.log()
  }

  if (EXECUTE) {
    // Diretório datado + poda ANTES de gravar: execução interrompida deixa lixo igual ao de
    // uma completa, e é `podar` quem denuncia entrada de família nenhuma em .backups.
    podar("push-opening-structure")
    const dir = `.backups/push-opening-structure-${new Date().toISOString().replace(/[:.]/g, "-")}`
    mkdirSync(dir, { recursive: true })
    const arq = `${dir}/snapshot.json`
    writeFileSync(arq, JSON.stringify(snapshot, null, 2))
    console.log(`snapshot do estado ANTERIOR da nuvem: ${arq}`)
    console.log(`\n${subiu} obra(s) subiram. O \`npm run db:pull\` agora é seguro.`)
  } else {
    console.log("Nada foi gravado. Para aplicar:")
    console.log("  npx tsx --env-file=.env.local scripts/push-opening-structure.ts --execute")
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
