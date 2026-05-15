/**
 * Comparação de modelos para avaliação IA.
 *
 * Roda o mesmo prompt em Haiku 4.5, Sonnet 4.6 e Opus 4.7 para cada obra alvo
 * e imprime um relatório lado a lado.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/compare-models.ts
 */

import { createClient } from "@supabase/supabase-js"
import { requestAiEvaluation } from "@/lib/ai-evaluation/service"
import { fetchExternalEvaluationContextForWork } from "@/lib/external/index"
import { pickPrimarySynopsis } from "@/lib/work-derived"
import { TAG_GROUP_IDS } from "@/lib/constants/tag-groups"
import { CRITERION_SLUGS } from "@/types/domain"

const TITLES = [
  "Side Characters Deserve Love Too",
  "The Little Princess and Her Monster Prince",
  "Until the Tragic Male Lead Walks Again",
]

const MODELS = (process.env.COMPARE_MODELS ?? "haiku,sonnet,opus")
  .split(",")
  .map((m) => m.trim().toLowerCase())
  .map((m) => {
    if (m === "haiku") return { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" }
    if (m === "sonnet") return { id: "claude-sonnet-4-6", label: "Sonnet 4.6" }
    if (m === "opus") return { id: "claude-opus-4-7", label: "Opus 4.7" }
    return null
  })
  .filter((m): m is { id: string; label: string } => m !== null)

const TAG_GROUP_ID_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(TAG_GROUP_IDS).map(([slug, id]) => [id, slug.replace(/^﻿/, "")])
)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no env.")
}
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("Falta ANTHROPIC_API_KEY no env.")
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

interface WorkPayload {
  id: string
  title: string
  synopsis?: string
  genres: string[]
  tags: Array<{ name: string; group: string | null }>
  sourcedReviews: Awaited<ReturnType<typeof fetchExternalEvaluationContextForWork>>["sourcedReviews"]
  externalContext: string[]
}

async function loadWork(title: string): Promise<WorkPayload | null> {
  const { data, error } = await supabase
    .from("works")
    .select(`
      id, title, original_title, alternative_titles,
      work_tags(tags(name, tag_group_id)),
      work_genres(genres(name)),
      work_synopses(text, is_primary, position)
    `)
    .ilike("title", title)
    .maybeSingle()

  if (error) {
    console.error(`[load] erro buscando "${title}":`, error.message)
    return null
  }
  if (!data) {
    console.error(`[load] obra não encontrada: "${title}"`)
    return null
  }

  type WorkRow = {
    id: string
    title: string
    original_title?: string | null
    alternative_titles?: string[] | null
    work_tags?: Array<{ tags?: { name?: string; tag_group_id?: string | null } }>
    work_genres?: Array<{ genres?: { name?: string } | null }>
    work_synopses?: Array<{ text?: string | null; is_primary?: boolean | null; position?: number | null }>
  }
  const work = data as WorkRow

  const tags = (work.work_tags ?? [])
    .map((wt) => wt.tags)
    .filter((t): t is { name: string; tag_group_id?: string | null } => Boolean(t?.name))
    .map((t) => ({
      name: t.name,
      group: t.tag_group_id ? (TAG_GROUP_ID_TO_SLUG[t.tag_group_id] ?? null) : null,
    }))

  const genres = (work.work_genres ?? [])
    .map((wg) => wg.genres?.name)
    .filter((n): n is string => Boolean(n))

  const synopsis = pickPrimarySynopsis(work.work_synopses) ?? undefined

  console.log(`  ➜ buscando reviews externas para "${work.title}"...`)
  const { sourcedReviews, externalContext } = await fetchExternalEvaluationContextForWork({
    title: work.title,
    originalTitle: work.original_title,
    alternativeTitles: work.alternative_titles,
  })

  return {
    id: work.id,
    title: work.title,
    synopsis,
    genres,
    tags,
    sourcedReviews,
    externalContext,
  }
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

function shortJust(j: string, max = 140): string {
  const compact = j.replace(/\s+/g, " ").trim()
  return compact.length <= max ? compact : compact.slice(0, max - 1) + "…"
}

async function main() {
  for (const title of TITLES) {
    console.log(`\n${"=".repeat(90)}`)
    console.log(`OBRA: ${title}`)
    console.log("=".repeat(90))

    const work = await loadWork(title)
    if (!work) continue

    console.log(`  tags: ${work.tags.length} (${new Set(work.tags.map((t) => t.group ?? "sem-grupo")).size} grupos)`)
    console.log(`  gêneros: ${work.genres.length}`)
    console.log(`  sourcedReviews: ${work.sourcedReviews.length}`)
    console.log(`  externalContext: ${work.externalContext.length}`)
    console.log("")

    const results: Array<{ modelLabel: string; scores: Record<string, number>; justs: Record<string, string>; summary: string; confidence: number; latencyMs: number }> = []

    for (const model of MODELS) {
      const t0 = Date.now()
      try {
        const resp = await requestAiEvaluation({
          workId: work.id,
          title: work.title,
          synopsis: work.synopsis,
          genres: work.genres,
          tags: work.tags,
          sourcedReviews: work.sourcedReviews,
          externalContext: work.externalContext,
          model: model.id,
        })
        const latencyMs = Date.now() - t0
        const scores: Record<string, number> = {}
        const justs: Record<string, string> = {}
        for (const s of resp.scores) {
          scores[s.criterionSlug] = s.suggestedScore
          justs[s.criterionSlug] = s.justification
        }
        results.push({ modelLabel: model.label, scores, justs, summary: resp.summary, confidence: resp.confidence, latencyMs })
        console.log(`  ✓ ${model.label} em ${(latencyMs / 1000).toFixed(1)}s (conf ${resp.confidence.toFixed(2)})`)
      } catch (err) {
        console.error(`  ✗ ${model.label} falhou:`, err instanceof Error ? err.message : err)
      }
    }

    if (results.length === 0) continue

    // Tabela de notas
    console.log("")
    console.log("  NOTAS:")
    console.log(`  ${pad("critério", 22)} ${results.map((r) => pad(r.modelLabel, 12)).join(" ")}`)
    for (const slug of CRITERION_SLUGS) {
      const cells = results.map((r) => pad(r.scores[slug]?.toFixed(1) ?? "—", 12))
      console.log(`  ${pad(slug, 22)} ${cells.join(" ")}`)
    }

    console.log("")
    console.log("  RESUMOS:")
    for (const r of results) {
      console.log(`  [${r.modelLabel}] (${(r.latencyMs / 1000).toFixed(1)}s) ${r.summary}`)
    }

    console.log("")
    console.log("  JUSTIFICATIVAS (resumidas):")
    for (const slug of CRITERION_SLUGS) {
      console.log(`  ─ ${slug} ─`)
      for (const r of results) {
        console.log(`    [${r.modelLabel}] ${shortJust(r.justs[slug] ?? "")}`)
      }
    }
  }

  console.log(`\n${"=".repeat(90)}`)
  console.log("Comparação concluída.")
}

main().catch((err) => {
  console.error("ERRO FATAL:", err)
  process.exit(1)
})
