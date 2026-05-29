// ============================================================
// Backfill L0+ — estimativa IA de qualidade pras obras não-lidas (Bloco 2.1)
// ============================================================
// Pra cada obra NÃO-LIDA (user_score NULL) com avaliação IA, a IA estima os
// 8 critérios de qualidade (0-10) a partir de sinopse + tags + 9 atributos +
// nota externa. Grava em ai_quality_predictions. É o sinal que dá spread ao
// expected_score do Pago antes do usuário ler.
//
// Uso:
//   node --env-file=.env.local scripts/backfill-quality-predictions.mjs           (dry-run: só conta)
//   node --env-file=.env.local scripts/backfill-quality-predictions.mjs --apply   (chama LLM + grava)
//
// Reexecutar é seguro: UPSERT por (work_id, field). --apply pula obras já com
// predição (a menos que --force).
// ============================================================

import { createClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"

const APPLY = process.argv.includes("--apply")
const FORCE = process.argv.includes("--force")
// --include-read: estima também as obras JÁ LIDAS (user_score != null). Não é
// usado na inferência (lidas têm post-scores reais), mas alimenta o MAE CV
// honesto (held-out previsto com qualidade estimada). Custo extra ~$0.012/obra.
const INCLUDE_READ = process.argv.includes("--include-read")
const MODEL = "claude-sonnet-4-6"
const PROMPT_VERSION = "quality-v1"
const CONCURRENCY = 5

const QUALITY_FIELDS = [
  ["post_story_score", "História"],
  ["post_fl_score", "Female Lead (qualidade da escrita/arco)"],
  ["post_ml_score", "Male Lead (qualidade da escrita/arco)"],
  ["post_character_development_score", "Desenvolvimento dos Personagens"],
  ["post_pacing_score", "Ritmo"],
  ["post_art_visual_score", "Arte/Visual"],
  ["post_impact_immersion_score", "Impacto/Imersão"],
  ["post_originality_score", "Originalidade"],
]

const SYSTEM = `Você estima a QUALIDADE DE EXECUÇÃO de uma obra (manhwa/manga) em 8 dimensões, escala 0-10.
QUALIDADE = "quão BEM-FEITA é cada dimensão", NÃO "quanto está presente". Ex.: uma obra pode ter muito romance (atributo alto) mas romance MAL escrito (qualidade baixa).
Calibração: 5 = mediano, 7-8 = bom, 9-10 = excepcional, 2-3 = fraco.
Use a sinopse, as tags, os atributos da obra e a nota externa como sinais. Seja realista: a maioria das obras é 5-7. Use a tool submit_quality.`

const TOOL = {
  name: "submit_quality",
  description: "Retorna a estimativa de qualidade (0-10) nas 8 dimensões.",
  input_schema: {
    type: "object",
    properties: Object.fromEntries(
      QUALITY_FIELDS.map(([f, label]) => [f, { type: "number", minimum: 0, maximum: 10, description: label }]),
    ),
    required: QUALITY_FIELDS.map(([f]) => f),
  },
}

function buildUserPrompt(w) {
  const attrs = (w.category_scores ?? [])
    .map((c) => `${c.criterion_slug}=${Number(c.score).toFixed(1)}`)
    .join(", ")
  const tags = (w.work_tags ?? [])
    .map((wt) => wt.tags?.name)
    .filter(Boolean)
    .slice(0, 25)
    .join(", ")
  const platform = w.calculated_scores?.platform_avg != null
    ? `Nota externa: ${Number(w.calculated_scores.platform_avg).toFixed(2)} (${w.calculated_scores.total_votes ?? 0} votos)`
    : "Nota externa: —"
  return [
    `Título: ${w.title}`,
    `Sinopse: ${(w.canonical_synopsis ?? "").slice(0, 1200) || "—"}`,
    `Tags: ${tags || "—"}`,
    `Atributos da obra (IA, 0-10): ${attrs || "—"}`,
    platform,
  ].join("\n")
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  let query = sb
    .from("works")
    .select(
      "id, title, canonical_synopsis, category_scores(criterion_slug, score), work_tags(tags(name)), calculated_scores(platform_avg, total_votes)",
    )
    .eq("is_archived", false)
  if (!INCLUDE_READ) query = query.is("user_score", null)
  const { data: works, error } = await query
  if (error) throw new Error(error.message)

  // Só obras com avaliação IA (tem atributos pra basear a estimativa).
  let targets = (works ?? []).filter((w) => (w.category_scores ?? []).length > 0)

  if (!FORCE) {
    // Pagina pra não ser truncado no limite default de 1000 linhas do PostgREST
    // (senão re-estima obras já prontas).
    const done = new Set()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error: pErr } = await sb
        .from("ai_quality_predictions")
        .select("work_id")
        .range(from, from + PAGE - 1)
      if (pErr) throw new Error(pErr.message)
      for (const r of data ?? []) done.add(r.work_id)
      if (!data || data.length < PAGE) break
    }
    targets = targets.filter((w) => !done.has(w.id))
  }

  console.log(
    `obras com IA${INCLUDE_READ ? " (lidas + não-lidas)" : " (não-lidas)"}: ${(works ?? []).length} | a estimar: ${targets.length}`,
  )
  console.log(`custo estimado: ~$${(targets.length * 0.012).toFixed(2)} (Sonnet, ~$0.012/obra)`)

  if (!APPLY) {
    console.log("\n[DRY-RUN] nada chamado/gravado. Rode com --apply pra estimar e gravar.")
    return
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 })
  const now = new Date().toISOString()
  let ok = 0
  let failed = 0

  async function processOne(w) {
    try {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 600,
        temperature: 0.2,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: buildUserPrompt(w) }],
      })
      const tool = msg.content.find((c) => c.type === "tool_use" && c.name === TOOL.name)
      if (!tool) {
        failed++
        console.warn(`  ✗ ${w.title}: sem tool_use`)
        return
      }
      const rows = QUALITY_FIELDS.map(([f]) => {
        const v = Number(tool.input[f])
        return {
          work_id: w.id,
          field: f,
          score: Math.min(10, Math.max(0, Math.round(v * 10) / 10)),
          model_name: MODEL,
          prompt_version: PROMPT_VERSION,
          updated_at: now,
        }
      })
      const { error: upErr } = await sb
        .from("ai_quality_predictions")
        .upsert(rows, { onConflict: "work_id,field" })
      if (upErr) {
        failed++
        console.warn(`  ✗ ${w.title}: ${upErr.message}`)
        return
      }
      ok++
      if (ok % 10 === 0) console.log(`  … ${ok} ok`)
    } catch (err) {
      failed++
      console.warn(`  ✗ ${w.title}: ${err?.message ?? err}`)
    }
  }

  // Concorrência limitada.
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(processOne))
  }

  console.log(`\n[APPLIED] ${ok} obras estimadas, ${failed} falhas.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
