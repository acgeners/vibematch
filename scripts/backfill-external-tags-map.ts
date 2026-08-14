/**
 * Backfill de tags/gêneros das fontes — ETAPA A: MAPEAR (read-only, $0, sem IA).
 *
 * Re-busca cada obra nas fontes (via os IDs externos aceitos), coleta os
 * gêneros/tags que hoje seriam DESCARTADOS na criação, deduplica contra o catálogo
 * ao vivo (tags+alias, genres) e a denylist, e classifica cada string nova em
 * "tag nova" vs "candidato a gênero". NÃO escreve nada no catálogo — só grava um
 * arquivo de staging que a ETAPA B consome (pra não re-buscar).
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis \
 *     scripts/backfill-external-tags-map.ts [--limit=N] [--concurrency=3]
 *
 * Saída: .backups/backfill-tags/map-<stamp>.json  + resumo no stdout.
 * Lento (rede/FlareSolverr/sidecar) — deixe o Docker/sidecar no ar.
 */
import fs from "node:fs"
import path from "node:path"
import { createAdminClient } from "@/lib/supabase/admin"
import { buildCandidateFromExternalIds, fetchMultiSourceDetails } from "@/lib/external/index"
import type { ExternalSourceId } from "@/lib/external/types"
import { slugifyTagName } from "@/lib/utils"
import { normalizeTagKey, SOURCE_TAG_DENYLIST } from "@/lib/tags/source-tag-filter"
import { GENRE_PROPOSAL_MIN_OCCURRENCES } from "@/lib/tags/genre-proposals"
// O dono da retenção de `.backups` é ÚNICO — ver scripts/lib/backups-retencao.mjs.
import { podar } from "./lib/backups-retencao.mjs"

const arg = (k: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1]
const LIMIT = Number(arg("--limit") ?? "0") || 0
const CONCURRENCY = Math.max(1, Number(arg("--concurrency") ?? "3") || 3)

interface WorkStaged {
  workId: string
  title: string
  newTags: string[] // strings inéditas (viram tag) — nome cru da fonte
}

async function loadWorks(supabase: ReturnType<typeof createAdminClient>) {
  // obras + seus external_ids aceitos.
  const works = new Map<string, { title: string; originalTitle: string | null; altTitles: string[]; ids: Partial<Record<ExternalSourceId, string>> }>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("works").select("id, title, original_title, alternative_titles").range(from, from + 999)
    if (!data?.length) break
    for (const w of data)
      works.set(w.id as string, {
        title: w.title as string,
        originalTitle: (w.original_title as string | null) ?? null,
        altTitles: ((w.alternative_titles as string[] | null) ?? []),
        ids: {},
      })
    if (data.length < 1000) break
  }
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("work_external_ids")
      .select("work_id, source, external_id, is_rejected")
      .eq("is_rejected", false)
      .range(from, from + 999)
    if (!data?.length) break
    for (const r of data) {
      const w = works.get(r.work_id as string)
      if (w) w.ids[r.source as ExternalSourceId] = String(r.external_id)
    }
    if (data.length < 1000) break
  }
  // só as que têm ao menos 1 id.
  return [...works.entries()].filter(([, w]) => Object.keys(w.ids).length > 0)
}

async function loadCatalog(supabase: ReturnType<typeof createAdminClient>) {
  const tagSlugs = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("tags").select("slug").range(from, from + 999)
    if (!data?.length) break
    for (const t of data) tagSlugs.add(t.slug as string)
    if (data.length < 1000) break
  }
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("tag_alias").select("alias_slug").range(from, from + 999)
    if (!data?.length) break
    for (const a of data) tagSlugs.add(a.alias_slug as string)
    if (data.length < 1000) break
  }
  // Gênero conhecido: mesma normalização do fluxo real (external.ts usa
  // normalizeTagKey sobre os nomes de gênero, não slug).
  const genreKeys = new Set<string>()
  const { data: genres } = await supabase.from("genres").select("name")
  for (const g of genres ?? []) genreKeys.add(normalizeTagKey(g.name as string))
  return { tagSlugs, genreKeys }
}

async function main() {
  const supabase = createAdminClient()
  console.log("carregando obras + catálogo ao vivo…")
  const [works, catalog] = await Promise.all([loadWorks(supabase), loadCatalog(supabase)])
  const targets = LIMIT > 0 ? works.slice(0, LIMIT) : works
  console.log(`${works.length} obras com id externo aceito; processando ${targets.length} (concorrência ${CONCURRENCY}).`)
  console.log(`catálogo: ${catalog.tagSlugs.size} slugs de tag (+alias), ${catalog.genreKeys.size} gêneros.\n`)

  const staged: WorkStaged[] = []
  const newTagCounts = new Map<string, number>() // slug → nº obras
  const newTagNameBySlug = new Map<string, string>()
  const genreCandCounts = new Map<string, number>()
  const genreCandNameBySlug = new Map<string, string>()
  let processed = 0
  let failed = 0

  const processOne = async ([id, w]: (typeof targets)[number]) => {
    try {
      const candidate = buildCandidateFromExternalIds(
        { title: w.title, originalTitle: w.originalTitle, alternativeTitles: w.altTitles },
        w.ids,
      )
      const result = await fetchMultiSourceDetails(candidate)
      const rawStrings = [...(result.data.genres ?? []), ...(result.data.tags ?? [])]
      const newTags: string[] = []
      const seen = new Set<string>()
      for (const raw of rawStrings) {
        const name = raw.trim()
        const key = normalizeTagKey(name)
        const slug = slugifyTagName(name)
        if (!key || !slug || seen.has(slug)) continue
        seen.add(slug)
        if (SOURCE_TAG_DENYLIST.has(key)) continue
        if (catalog.genreKeys.has(key)) continue // já é gênero (mesma checagem do fluxo real)
        if (catalog.tagSlugs.has(slug)) continue // já é tag existente (será só anexada, não é NOVA)
        // NOVA: vira tag. Vindo do campo gênero, também é candidata a gênero (com limiar).
        newTags.push(name)
        newTagCounts.set(slug, (newTagCounts.get(slug) ?? 0) + 1)
        newTagNameBySlug.set(slug, name)
        genreCandCounts.set(slug, (genreCandCounts.get(slug) ?? 0) + 1)
        genreCandNameBySlug.set(slug, name)
      }
      if (newTags.length) staged.push({ workId: id, title: w.title, newTags })
    } catch (e) {
      failed++
      console.warn(`  ✗ ${w.title}: ${e instanceof Error ? e.message : e}`)
    } finally {
      processed++
      if (processed % 20 === 0) console.log(`  … ${processed}/${targets.length}`)
    }
  }

  // pool simples de concorrência.
  const queue = [...targets]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const item = queue.shift()
        if (item) await processOne(item)
      }
    }),
  )

  // resumo.
  const distinctNewTags = newTagCounts.size
  const genreCandsOverThreshold = [...genreCandCounts.values()].filter(
    (c) => c >= GENRE_PROPOSAL_MIN_OCCURRENCES,
  ).length
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  // Declara a família antes de gravar. Este script escapou da varredura por escrever
  // `".backups/backfill-tags"` — caminho embutido no literal, que o teste antigo não
  // reconhecia. Aqui a poda não remove nada (o diretório é único); o que ela faz é impedir
  // que a pasta volte a crescer sem dono, e denunciar o PRÓXIMO prefixo que aparecer.
  podar("backfill-tags")
  const outDir = path.resolve(process.cwd(), ".backups/backfill-tags")
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `map-${stamp}.json`)
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        worksProcessed: targets.length,
        worksWithNewStrings: staged.length,
        failed,
        distinctNewTags,
        genreProposalMinOccurrences: GENRE_PROPOSAL_MIN_OCCURRENCES,
        genreCandidatesOverThreshold: genreCandsOverThreshold,
        works: staged,
      },
      null,
      2,
    ),
  )

  const top = (m: Map<string, number>, nameBy: Map<string, string>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([s, c]) => `${nameBy.get(s)} (${c})`)

  // custo estimado (batcheado): ~1 classifier + ~1 enricher por ~35 tags novas.
  const batches = Math.ceil(distinctNewTags / 35)
  const estBatched = (batches * (0.0039 + 0.003)).toFixed(2)
  const estPerWork = (distinctNewTags * 0.007).toFixed(2)

  console.log("\n================= RESUMO (ETAPA A) =================")
  console.log(`obras processadas ........ ${targets.length}${failed ? ` (${failed} falharam)` : ""}`)
  console.log(`obras com string nova .... ${staged.length}`)
  console.log(`TAGS novas (distintas) ... ${distinctNewTags}`)
  console.log(`GÊNEROS candidatos (≥${GENRE_PROPOSAL_MIN_OCCURRENCES} obras) ... ${genreCandsOverThreshold}`)
  console.log(`\ntop candidatos a gênero: ${top(genreCandCounts, genreCandNameBySlug, 15).join(", ") || "(nenhum)"}`)
  console.log(`\ntop tags novas: ${top(newTagCounts, newTagNameBySlug, 20).join(", ") || "(nenhuma)"}`)
  console.log(`\ncusto de IA estimado (Etapa B): ~$${estBatched} batcheado  |  ~$${estPerWork} por-obra (teto)`)
  console.log(`\nstaging: ${outPath}`)
  console.log("→ revise e, se aprovar, rode a Etapa B apontando pra esse arquivo.")
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
