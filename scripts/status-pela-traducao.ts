/**
 * Reclassifica o status de publicação do catálogo pelo da TRADUÇÃO (decisão de 2026-11-16).
 * A régua é `decidePublicationStatus` (`lib/external/publication-status-sync.ts`) — este script
 * só lê o MangaUpdates de cada obra, aplica a régua e grava.
 *
 * 🔴 ALVO: NUVEM — GRAVA no catálogo. Rodado contra o local, que é réplica descartável, o
 * trabalho é jogado fora no próximo `db:pull`.
 *
 *   # ensaio (PADRÃO): imprime o plano e não grava nada
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/status-pela-traducao.ts
 *
 *   # aplica (salva o estado anterior em .backups/ e marca o recálculo)
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/status-pela-traducao.ts --execute
 *
 * ⚠️ US$0 de modelo. Lê a API pública do MangaUpdates, uma obra por vez (3 em paralelo, ~5 min
 * no catálogo inteiro). Status é feature da Nota Prevista: o `--execute` marca o recálculo.
 *
 * Por que existe: as rotas automáticas (checagem da `/reading`, lote do catálogo) só passam
 * pela régua nova quando olham a obra, e o lote não olha obra concluída. Medido em 16/11: 10
 * obras presas em Completed com o MangaUpdates dizendo Ongoing, e 63 concluídas no original com
 * menos capítulos disponíveis do que o original tem.
 */
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"
import { decidePublicationStatus } from "@/lib/external/publication-status-sync"
import { fetchMangaUpdatesStatus } from "@/lib/external/mangaupdates"
import { getPublicationStatusIdByName, getPublicationStatusNameById } from "@/lib/constants/status-lookups"
// O dono da retenção de `.backups` é ÚNICO — ver scripts/lib/backups-retencao.mjs.
import { podar } from "./lib/backups-retencao.mjs"
// "nada a corrigir" tem de sair junto do funil — ver scripts/lib/funil.mjs.
import { criarFunil } from "./lib/funil.mjs"

const EXECUTAR = process.argv.includes("--execute")
const PARALELO = 3

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

interface Obra {
  id: string
  title: string
  publication_status_id: number | null
  total_chapters: number | null
}

interface Mudanca {
  id: string
  title: string
  antes: string | null
  depois: string
  original: string
  totalOriginal: number | null
  disponiveis: number | null
}

/** Paginado com ordem total: o `select` corta em 1000 linhas sem avisar. */
async function lerTudo<T>(tabela: string, colunas: string, ordem: string, filtro: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await filtro(sb.from(tabela).select(colunas)).order(ordem).range(from, from + 499)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as T[]))
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

  const funil = criarFunil("status pela tradução")

  const obras = await lerTudo<Obra>("works", "id, title, publication_status_id, total_chapters", "id", (q) =>
    q.eq("is_archived", false),
  )
  funil.passo("obras ativas", obras.length)

  // Com `source` fixo, `work_id` é chave única da leitura (unique em work_id + source).
  const vinculos = await lerTudo<{ work_id: string; external_id: string | null; is_rejected: boolean | null }>(
    "work_external_ids",
    "work_id, external_id, is_rejected",
    "work_id",
    (q) => q.eq("source", "mangaupdates"),
  )
  const muId = new Map<string, number>()
  for (const v of vinculos) {
    const n = Number(v.external_id)
    if (!v.is_rejected && Number.isFinite(n)) muId.set(v.work_id, n)
  }
  const comMu = obras.filter((o) => muId.has(o.id))
  funil.passo("com MangaUpdates vinculado", comMu.length)

  let lidas = 0
  const plano: Mudanca[] = []
  let i = 0
  async function trabalhador() {
    while (i < comMu.length) {
      const o = comMu[i++]
      const mu = await fetchMangaUpdatesStatus(muId.get(o.id)!)
      await new Promise((r) => setTimeout(r, 250))
      if (!mu) continue
      lidas++
      const antes = getPublicationStatusNameById(o.publication_status_id)
      const d = decidePublicationStatus(
        antes,
        { mangaupdates: mu.status, comix: null },
        { originalChapters: mu.originalChapters, availableChapters: o.total_chapters },
      )
      if (d) {
        plano.push({
          id: o.id,
          title: o.title,
          antes,
          depois: d.status,
          original: mu.status,
          totalOriginal: mu.originalChapters,
          disponiveis: o.total_chapters,
        })
      }
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabalhador))
  // Um zero aqui é o MangaUpdates fora, não "tudo certo" — e o funil marca a queda.
  funil.passo("com status lido do MangaUpdates", lidas, { reterAoMenos: 0.8 })
  funil.passo("com status a mudar", plano.length)

  if (plano.length === 0) {
    funil.nadaAFazer("nada a reclassificar.")
    return
  }
  funil.relatar()
  console.log("")

  plano.sort((a, b) => `${a.antes}>${a.depois}`.localeCompare(`${b.antes}>${b.depois}`) || a.title.localeCompare(b.title))
  const porTransicao = new Map<string, number>()
  for (const p of plano) porTransicao.set(`${p.antes ?? "—"} → ${p.depois}`, (porTransicao.get(`${p.antes ?? "—"} → ${p.depois}`) ?? 0) + 1)
  console.log(`${plano.length} obra(s) mudam de status:`)
  for (const [t, n] of porTransicao) console.log(`  ${String(n).padStart(4)}  ${t}`)
  console.log("")
  for (const p of plano) {
    const cap = p.totalOriginal != null ? ` · ${p.disponiveis ?? "?"} de ${p.totalOriginal} capítulos disponíveis` : ""
    console.log(`  ${(p.antes ?? "—").padEnd(9)} → ${p.depois.padEnd(9)}  ${p.title}  (original: ${p.original}${cap})`)
  }
  console.log("")

  if (!EXECUTAR) {
    console.log("ENSAIO — nada gravado. Repita com --execute para aplicar.")
    return
  }

  // Poda ANTES de gravar: ensaio interrompido deixa lixo igual ao de execução completa.
  podar("status-pela-traducao")

  // Snapshot ANTES de escrever: é a única rede pra desfazer (o banco não tem PITR).
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = path.resolve(process.cwd(), ".backups", `status-pela-traducao-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "plano.json"), JSON.stringify(plano, null, 2))
  console.log(`estado anterior salvo em ${path.relative(process.cwd(), dir)}/plano.json\n`)

  let ok = 0
  for (const p of plano) {
    const id = getPublicationStatusIdByName(p.depois)
    if (id == null) {
      console.error(`  ✗ ${p.title} — status "${p.depois}" sem id`)
      continue
    }
    const { error } = await sb.from("works").update({ publication_status_id: id }).eq("id", p.id)
    if (error) {
      console.error(`  ✗ ${p.title} — ${error.message}`)
      continue
    }
    ok++
  }
  console.log(`✅ ${ok}/${plano.length} status gravado(s)`)

  // Status é feature da Nota Prevista. `markRecalcPending` é server-only: a RPC é a mesma que ele usa.
  if (ok > 0) {
    const { error } = await sb.rpc("touch_recalc_pending")
    if (error) console.error(`⚠️  recálculo NÃO marcado: ${error.message} — rode "Recalcular notas" na barra.`)
    else console.log("recálculo marcado (badge \"Recalcular notas\").")
  }
  if (ok < plano.length) {
    console.error(`⚠️  ${plano.length - ok} falharam — o script é idempotente, pode repetir.`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
