/**
 * BACKFILL de `works.alternative_titles` a partir das fontes externas já linkadas.
 *
 * Por que existe: 402 das 906 obras (44%) não guardavam NENHUM título alternativo.
 * A busca de /catalog só enxerga os nomes salvos na linha da obra, enquanto a
 * detecção de duplicata de /catalog/new compara o pacote inteiro de aliases que a
 * fonte externa trouxe. Daí o sintoma: "pesquiso e não acha, mas ao cadastrar
 * diz que já existe". Este script fecha o buraco do passado; a auto-cura em
 * `absorbIncomingAliases` (server/actions/works.ts) impede que ele volte.
 *
 * Custo: só APIs externas (MangaDex, ComicK, AniList, MangaUpdates). ZERO IA.
 *
 * Uso:
 *   npx tsx scripts/backfill-alternative-titles.ts --dry-run   # não escreve
 *   npx tsx scripts/backfill-alternative-titles.ts             # aplica
 *   npx tsx scripts/backfill-alternative-titles.ts --limit=20  # amostra
 *   npx tsx scripts/backfill-alternative-titles.ts --all       # inclui quem já tem alias
 *   npx tsx scripts/backfill-alternative-titles.ts --sources=mangadex,anilist
 *
 * Sobre o ComicK: a API dele é gateada por Cloudflare e responde 403 sem o
 * FlareSolverr/sidecar de pé. Medido em 2026-07-23, ele seria a ÚNICA fonte de
 * apenas 2 das 402 obras — então rodar sem ele custa quase nada e evita 4
 * tentativas 403 por obra. Use `--sources=` pra excluí-lo quando o Docker
 * estiver parado.
 *
 * ⚠️ Rode `node scripts/backup-db.mjs` antes: escreve em massa e o banco não tem
 * backup em nuvem.
 *
 * 🔴 ALVO: NUVEM — este script GRAVA. Rodá-lo contra o local, que é réplica descartável,
 * joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/backfill-alternative-titles.ts
 */
import { createClient } from "@supabase/supabase-js"
import { config } from "dotenv"
import { foldTitle, isWeakDuplicateAlias } from "../lib/title-match"
import { fetchMangaDexById } from "../lib/external/mangadex"
import { fetchComicKByHid } from "../lib/external/comick"
import { fetchAniListById } from "../lib/external/anilist"
import { fetchMangaUpdatesById } from "../lib/external/mangaupdates"

config({ path: ".env.local" })

const MAX_ALTERNATIVE_TITLES = 40
/** Pausa entre obras — não vale queimar as APIs de graça por causa de pressa. */
const DELAY_MS = 350

const args = process.argv.slice(2)
const DRY_RUN = args.includes("--dry-run")
const INCLUDE_ALL = args.includes("--all")
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0") || null

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Lê TODAS as linhas — o PostgREST corta em 1000 sem avisar. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(`${label}: ${error.message}`)
    const batch = data ?? []
    out.push(...batch)
    if (batch.length < 1000) break
  }
  return out
}

interface WorkRow {
  id: string
  title: string | null
  original_title: string | null
  alternative_titles: string[] | null
}

/**
 * Só o AniList expõe `originalTitle` no detalhe; as outras três entregam tudo
 * dentro de `alternativeTitles`. O `title` de cada fonte também entra: é por ele
 * que a obra costuma ser conhecida em outra plataforma.
 */
async function aliasesFor(source: string, externalId: string): Promise<string[]> {
  try {
    switch (source) {
      case "mangadex": {
        const d = await fetchMangaDexById(externalId)
        return [d?.title, ...(d?.alternativeTitles ?? [])].filter((v): v is string => Boolean(v))
      }
      case "comick": {
        const d = await fetchComicKByHid(externalId)
        return [d?.title, ...(d?.alternativeTitles ?? [])].filter((v): v is string => Boolean(v))
      }
      case "anilist": {
        const id = Number(externalId)
        if (!Number.isFinite(id)) return []
        const d = await fetchAniListById(id)
        return [d?.title, d?.originalTitle, ...(d?.alternativeTitles ?? [])].filter(
          (v): v is string => Boolean(v),
        )
      }
      case "mangaupdates": {
        const id = Number(externalId)
        if (!Number.isFinite(id)) return []
        const d = await fetchMangaUpdatesById(id)
        return [d?.title, ...(d?.alternativeTitles ?? [])].filter((v): v is string => Boolean(v))
      }
      default:
        return []
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`      ⚠ ${source} falhou: ${msg.slice(0, 90)}`)
    return []
  }
}

async function main() {
  console.log(
    `\n🔤 Backfill de alternative_titles ${DRY_RUN ? "(DRY RUN — não escreve)" : "(APLICANDO)"}\n`,
  )

  // Confere contra a contagem exata: se o paginador perdesse linhas, o backfill
  // terminaria "com sucesso" tendo processado uma fração do alvo.
  const { count: exactWorks } = await supabase
    .from("works")
    .select("*", { count: "exact", head: true })

  const works = await fetchAll<WorkRow>(
    (from, to) =>
      supabase.from("works").select("id, title, original_title, alternative_titles").range(from, to),
    "works",
  )
  if (works.length !== exactWorks) {
    throw new Error(`ABORTADO: li ${works.length} obras mas o count exato é ${exactWorks}`)
  }
  console.log(`   ${works.length} obras no catálogo (confere com o count exato)`)

  const extIds = await fetchAll<{ work_id: string; source: string; external_id: string; is_rejected: boolean }>(
    (from, to) =>
      supabase
        .from("work_external_ids")
        .select("work_id, source, external_id, is_rejected")
        .range(from, to),
    "work_external_ids",
  )
  const idsByWork = new Map<string, Array<{ source: string; external_id: string }>>()
  for (const row of extIds) {
    if (row.is_rejected) continue
    const list = idsByWork.get(row.work_id) ?? []
    list.push({ source: row.source, external_id: row.external_id })
    idsByWork.set(row.work_id, list)
  }

  // MangaDex primeiro: é a fonte com mais alias multi-idioma (coreano, japonês,
  // romanizado) — exatamente os nomes pelos quais a busca falhava.
  const ALL_SOURCES = ["mangadex", "comick", "anilist", "mangaupdates"]
  const requested = args.find((a) => a.startsWith("--sources="))?.split("=")[1]
  const SOURCE_ORDER = requested
    ? requested.split(",").map((s) => s.trim()).filter((s) => ALL_SOURCES.includes(s))
    : ALL_SOURCES
  console.log(`   fontes: ${SOURCE_ORDER.join(", ")}`)

  let targets = works.filter((w) => INCLUDE_ALL || !w.alternative_titles?.length)
  targets = targets.filter((w) => (idsByWork.get(w.id) ?? []).length > 0)
  if (LIMIT) targets = targets.slice(0, LIMIT)

  console.log(`   ${targets.length} obras alvo\n`)

  let updated = 0
  let unchanged = 0
  let failed = 0
  let totalAdded = 0

  for (const [i, work] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] ${(work.title ?? "?").slice(0, 52)}`
    const sources = (idsByWork.get(work.id) ?? [])
      .filter((s) => SOURCE_ORDER.includes(s.source))
      .sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source))

    if (!sources.length) {
      unchanged++
      continue
    }

    const collected: string[] = []
    for (const s of sources) {
      collected.push(...(await aliasesFor(s.source, s.external_id)))
    }

    // Descarta o que a obra já reconhece (título, original, aliases salvos) e o
    // que é genérico demais pra identificar ("Official", "English"…).
    const known = new Set(
      [work.title, work.original_title, ...(work.alternative_titles ?? [])]
        .map(foldTitle)
        .filter(Boolean),
    )
    const toAdd: string[] = []
    for (const raw of collected) {
      const trimmed = raw.trim()
      const key = foldTitle(trimmed)
      if (!key || known.has(key) || isWeakDuplicateAlias(key)) continue
      known.add(key)
      toAdd.push(trimmed)
    }

    if (!toAdd.length) {
      unchanged++
      console.log(`${label} — nada novo`)
      await sleep(DELAY_MS)
      continue
    }

    const next = [...(work.alternative_titles ?? []), ...toAdd].slice(0, MAX_ALTERNATIVE_TITLES)
    if (DRY_RUN) {
      updated++
      totalAdded += toAdd.length
      console.log(`${label} — +${toAdd.length}: ${toAdd.slice(0, 3).join(" · ").slice(0, 80)}`)
    } else {
      const { error } = await supabase
        .from("works")
        .update({ alternative_titles: next })
        .eq("id", work.id)
      if (error) {
        failed++
        console.error(`${label} — ✗ ${error.message}`)
      } else {
        updated++
        totalAdded += toAdd.length
        console.log(`${label} — +${toAdd.length}`)
      }
    }
    await sleep(DELAY_MS)
  }

  console.log(
    `\n${DRY_RUN ? "DRY RUN" : "✅"} atualizadas: ${updated} · sem novidade: ${unchanged} · falhas: ${failed}`,
  )
  console.log(`   ${totalAdded} títulos alternativos ${DRY_RUN ? "seriam" : "foram"} adicionados`)

  if (!DRY_RUN) {
    const after = await fetchAll<{ id: string; alternative_titles: string[] | null }>(
      (from, to) => supabase.from("works").select("id, alternative_titles").range(from, to),
      "verificação",
    )
    const semAlias = after.filter((w) => !w.alternative_titles?.length).length
    console.log(`   obras SEM nenhum alias agora: ${semAlias} (eram 402)`)
  }
}

main().catch((error) => {
  console.error("\n❌", error)
  process.exit(1)
})
