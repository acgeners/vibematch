/**
 * Backfill de tags/gêneros das fontes — ETAPA B: APLICAR.
 *
 * Consome o staging da Etapa A. DEFAULT = dry-run (reporta o que faria, $0). Com
 * --execute: cria as tags novas (origin='external'), anexa às obras (work_tags),
 * roda o enriquecimento em LOTE (tag_classifier + tag_enricher → grupo/subgrupo +
 * flag 18+ + propostas de cluster), recomputa adult_auto, e enfileira gêneros
 * candidatos que recorrem (≥ limiar). Reporta o custo real de IA.
 *
 *   # dry-run (seguro):
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/backfill-external-tags-apply.ts --from=.backups/backfill-tags/map-<stamp>.json
 *   # valendo (RODE `node scripts/backup-db.mjs` ANTES — banco sem backup cloud):
 *   ... --execute [--limit=N]
 */
import fs from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveOrCreateTags, enrichNewTags } from "@/lib/tags/ingest"
import { slugifyTagName } from "@/lib/utils"
import { GENRE_PROPOSAL_MIN_OCCURRENCES } from "@/lib/tags/genre-proposals"

const arg = (k: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1]
const FROM = arg("--from")
const EXECUTE = process.argv.includes("--execute")
const LIMIT = Number(arg("--limit") ?? "0") || 0
const NO_GENRES = process.argv.includes("--no-genres")
const GENRES_MIN = Number(arg("--genres-min") ?? String(GENRE_PROPOSAL_MIN_OCCURRENCES)) || GENRE_PROPOSAL_MIN_OCCURRENCES
const ENRICH_CHUNK = 30

interface WorkStaged {
  workId: string
  title: string
  newTags: string[]
}

type Admin = ReturnType<typeof createAdminClient>

async function costOf(supabase: Admin): Promise<{ inTok: number; outTok: number; calls: number }> {
  let inTok = 0
  let outTok = 0
  let calls = 0
  for (const op of ["tag_classifier", "tag_enricher"]) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("ai_api_calls")
        .select("input_tokens, output_tokens")
        .eq("operation", op)
        .range(from, from + 999)
      if (!data?.length) break
      for (const r of data) {
        inTok += (r.input_tokens as number) ?? 0
        outTok += (r.output_tokens as number) ?? 0
        calls++
      }
      if (data.length < 1000) break
    }
  }
  return { inTok, outTok, calls }
}

async function main() {
  if (!FROM) {
    console.error("faltou --from=<staging.json> (rode a Etapa A primeiro).")
    process.exit(1)
  }
  const staging = JSON.parse(fs.readFileSync(FROM, "utf8")) as { works: WorkStaged[] }
  const works = LIMIT > 0 ? staging.works.slice(0, LIMIT) : staging.works
  const supabase = createAdminClient()

  // Agrega slug → { name, workIds }.
  const bySlug = new Map<string, { name: string; workIds: string[] }>()
  for (const w of works) {
    for (const name of w.newTags) {
      const slug = slugifyTagName(name)
      if (!slug) continue
      const e = bySlug.get(slug) ?? { name, workIds: [] }
      e.workIds.push(w.workId)
      bySlug.set(slug, e)
    }
  }
  const distinctTags = bySlug.size
  const genreCands = NO_GENRES
    ? []
    : [...bySlug.entries()].filter(([, e]) => e.workIds.length >= GENRES_MIN)

  console.log(`staging: ${staging.works.length} obras (processando ${works.length}).`)
  console.log(`tags novas distintas: ${distinctTags} | candidatos a gênero (≥${GENRE_PROPOSAL_MIN_OCCURRENCES}): ${genreCands.length}`)

  if (!EXECUTE) {
    console.log("\n[DRY-RUN] nada foi escrito. Rode com --execute (após backup) pra aplicar.")
    console.log(`faria: criar ~${distinctTags} tags, anexar work_tags, enriquecer em ~${Math.ceil(distinctTags / ENRICH_CHUNK)} lotes, enfileirar ${genreCands.length} gêneros.`)
    return
  }

  const before = await costOf(supabase)

  // 1) cria/dedup todas as tags novas (origin='external').
  const allNames = [...bySlug.values()].map((e) => e.name)
  const { createdIds } = await resolveOrCreateTags(supabase, allNames, "external")
  console.log(`\ntags criadas (novas de fato): ${createdIds.length}`)

  // slug → id (pra anexar work_tags), incluindo as que já existiam.
  const slugToId = new Map<string, string>()
  const slugs = [...bySlug.keys()]
  for (let i = 0; i < slugs.length; i += 500) {
    const { data } = await supabase.from("tags").select("id, slug").in("slug", slugs.slice(i, i + 500))
    for (const t of data ?? []) slugToId.set(t.slug as string, t.id as string)
  }

  // 2) anexa work_tags (source='imported') — ANTES do enriquecimento, pra o
  //    recompute de adult_auto (dentro do enrichNewTags) achar as obras.
  let attached = 0
  for (const w of works) {
    const rows = w.newTags
      .map((name) => slugToId.get(slugifyTagName(name)))
      .filter((id): id is string => Boolean(id))
      .map((tag_id) => ({ work_id: w.workId, tag_id, source: "imported" }))
    if (!rows.length) continue
    const { error } = await supabase
      .from("work_tags")
      .upsert(rows, { onConflict: "work_id,tag_id", ignoreDuplicates: true })
    if (error) console.warn(`  work_tags upsert falhou (${w.title}): ${error.message}`)
    else attached += rows.length
  }
  console.log(`work_tags anexadas: ${attached}`)

  // 3) enriquecimento em lote (dispara tag_classifier + tag_enricher + recompute 18+).
  console.log(`enriquecendo ${createdIds.length} tags em lotes de ${ENRICH_CHUNK}…`)
  for (let i = 0; i < createdIds.length; i += ENRICH_CHUNK) {
    await enrichNewTags(createdIds.slice(i, i + ENRICH_CHUNK))
    if ((i / ENRICH_CHUNK) % 5 === 0) console.log(`  … ${Math.min(i + ENRICH_CHUNK, createdIds.length)}/${createdIds.length}`)
  }

  // 4) enfileira gêneros candidatos recorrentes (não ressuscita approved/rejected).
  const candSlugs = genreCands.map(([slug]) => slug)
  const { data: existingProps } = await supabase
    .from("genre_proposal")
    .select("slug, status")
    .in("slug", candSlugs)
  const blocked = new Set((existingProps ?? []).filter((p) => p.status !== "pending").map((p) => p.slug as string))
  const propRows = genreCands
    .filter(([slug]) => !blocked.has(slug))
    .map(([slug, e]) => ({
      raw_name: e.name,
      slug,
      occurrences: e.workIds.length,
      sample_work_ids: [...new Set(e.workIds)].slice(0, 8),
      status: "pending",
      updated_at: new Date().toISOString(),
    }))
  if (propRows.length) {
    const { error } = await supabase.from("genre_proposal").upsert(propRows, { onConflict: "slug" })
    if (error) console.warn(`genre_proposal upsert falhou: ${error.message}`)
  }
  console.log(`gêneros candidatos enfileirados: ${propRows.length}`)

  // 5) custo real.
  const after = await costOf(supabase)
  const dIn = after.inTok - before.inTok
  const dOut = after.outTok - before.outTok
  const dCalls = after.calls - before.calls
  const cost = (dIn * 1 + dOut * 5) / 1e6
  console.log("\n================= RESUMO (ETAPA B) =================")
  console.log(`tags criadas ......... ${createdIds.length}`)
  console.log(`work_tags anexadas ... ${attached}`)
  console.log(`gêneros na fila ...... ${propRows.length}`)
  console.log(`chamadas de IA ....... ${dCalls} (in=${dIn} out=${dOut} tokens)`)
  console.log(`custo real ........... $${cost.toFixed(2)}`)
  console.log("\n→ revise em /settings?g=avancado → Consolidação → Tags novas / Gêneros propostos.")
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
