// ============================================================
// Backfill: edições manuais de atributos → user_attribute_assessment
// (Fase 1.5.2.b)
// ============================================================
// Reconstrói o que aconteceria se o usuário tivesse preenchido o
// questionário pós-leitura nas obras que ele já revisou. Popula
// user_attribute_assessment com TODOS os 9 atributos dessas obras
// (edições = opinião dele; não-edições = concordância com a IA, delta 0)
// e recomputa attribute_bias. NÃO altera category_scores (não-destrutivo).
//
// Escopo: obras com >=1 edição (evidência de revisão) e que não sejam
// "To read" (personal_status_id=8). Incluir as concordâncias remove o
// viés de seleção (senão a média só pega discordâncias e infla o offset).
// Só linhas com source IA + suggested_score registrado.
//
// Uso:
// 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
//   node --env-file=.env.local scripts/backfill-edited-attributes-to-assessment.mjs          (dry-run)
//   node --env-file=.env.local scripts/backfill-edited-attributes-to-assessment.mjs --apply  (grava)
//
// Reexecutar é seguro: UPSERT idempotente em ambas as tabelas.
// ============================================================

import { createClient } from "@supabase/supabase-js"

const APPLY = process.argv.includes("--apply")
const TO_READ_STATUS_ID = 8
const BIAS_SHRINKAGE_K = 10

const CRITERION_SLUGS = [
  "romance",
  "couple_dynamics",
  "fantasy_nobility",
  "action_adventure",
  "adult_content",
  "protagonist",
  "humor",
  "drama",
  "tragedy",
]

function round2(n) {
  return Math.round(n * 100) / 100
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  )

  // 1. user_id singleton
  const { data: us, error: usErr } = await sb
    .from("user_settings")
    .select("current_user_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (usErr) throw new Error(`user_settings: ${usErr.message}`)
  if (!us?.current_user_id) throw new Error("user_settings sem current_user_id (rode migration 074).")
  const userId = us.current_user_id
  console.log(`user_id: ${userId}`)

  // 2. obras REVISADAS = têm >=1 atributo ai_edited (evidência de que o
  //    usuário olhou os atributos). Equivalente histórico a "preencheu o
  //    questionário". Obras sem nenhuma edição não auto-populam.
  const { data: edited, error: edErr } = await sb
    .from("category_scores")
    .select("work_id")
    .eq("source", "ai_edited")
  if (edErr) throw new Error(`category_scores (edited): ${edErr.message}`)
  const reviewedWorkIds = [...new Set(edited.map((r) => r.work_id))]
  console.log(`obras com >=1 edição: ${reviewedWorkIds.length}`)

  // 3. status → in-scope = revisada E não "To read"
  const { data: works, error: wErr } = await sb
    .from("works")
    .select("id, personal_status_id")
    .in("id", reviewedWorkIds)
  if (wErr) throw new Error(`works: ${wErr.message}`)
  const inScope = new Set(
    works.filter((w) => w.personal_status_id !== TO_READ_STATUS_ID).map((w) => w.id),
  )
  console.log(`in-scope (revisadas, não To read): ${inScope.size}`)

  // 4. TODOS os atributos dessas obras (edição + concordância). Concordância
  //    = o usuário deixou o valor da IA → delta 0 (sinal não-enviesado).
  const { data: allcs, error: csErr } = await sb
    .from("category_scores")
    .select("work_id, criterion_slug, score, ai_evaluation_id, source")
    .in("work_id", [...inScope])
  if (csErr) throw new Error(`category_scores (all): ${csErr.message}`)

  const evalIds = [...new Set(allcs.map((r) => r.ai_evaluation_id).filter(Boolean))]
  const { data: sugg, error: sErr } = await sb
    .from("ai_evaluation_scores")
    .select("ai_evaluation_id, criterion_slug, suggested_score")
    .in("ai_evaluation_id", evalIds)
  if (sErr) throw new Error(`ai_evaluation_scores: ${sErr.message}`)
  const suggMap = new Map(
    sugg.map((s) => [`${s.ai_evaluation_id}|${s.criterion_slug}`, s.suggested_score]),
  )
  const { data: evals, error: eErr } = await sb
    .from("ai_evaluations")
    .select("id, model_name, prompt_version")
    .in("id", evalIds)
  if (eErr) throw new Error(`ai_evaluations: ${eErr.message}`)
  const evalMeta = new Map(evals.map((e) => [e.id, e]))

  // 5. monta linhas de assessment (só sources derivadas da IA, com sugestão)
  const IA_SOURCES = new Set(["ai_accepted", "ai_edited", "ai_calibrated"])
  const rows = []
  const skipped = { nonIaSource: 0, noSuggestion: 0, noEvalId: 0, badSlug: 0 }
  const now = new Date().toISOString()

  for (const r of allcs) {
    if (!IA_SOURCES.has(r.source)) {
      skipped.nonIaSource++
      continue
    }
    if (!CRITERION_SLUGS.includes(r.criterion_slug)) {
      skipped.badSlug++
      continue
    }
    if (!r.ai_evaluation_id) {
      skipped.noEvalId++
      continue
    }
    const suggested = suggMap.get(`${r.ai_evaluation_id}|${r.criterion_slug}`)
    if (suggested == null) {
      skipped.noSuggestion++
      continue
    }
    const meta = evalMeta.get(r.ai_evaluation_id)
    const userValue = Number(r.score)
    const iaValue = Number(suggested)
    rows.push({
      user_id: userId,
      work_id: r.work_id,
      attribute_slug: r.criterion_slug,
      user_value: userValue,
      source: userValue === iaValue ? "ai_accepted_post_read" : "user_edited_post_read",
      ia_value_at_assessment: iaValue,
      ia_model_at_assessment: meta?.model_name ?? "unknown",
      ia_prompt_version: meta?.prompt_version ?? "unknown",
      ia_evaluation_id: r.ai_evaluation_id,
      updated_at: now,
    })
  }

  const distinctWorks = new Set(rows.map((r) => r.work_id)).size
  console.log(`\nsamples a gravar: ${rows.length} (em ${distinctWorks} obras)`)
  console.log("puladas:", skipped)

  // 6. recomputa bias inline (delta = ia - user)
  const deltasBySlug = new Map(CRITERION_SLUGS.map((s) => [s, []]))
  for (const r of rows) {
    deltasBySlug.get(r.attribute_slug).push(r.ia_value_at_assessment - r.user_value)
  }
  const biasRows = []
  console.log("\noffset por atributo (preview):")
  for (const slug of CRITERION_SLUGS) {
    const deltas = deltasBySlug.get(slug)
    const n = deltas.length
    const mean = n ? deltas.reduce((a, d) => a + d, 0) / n : 0
    const applied = n ? mean * (n / (n + BIAS_SHRINKAGE_K)) : 0
    let stddev = null
    if (n >= 2) {
      const variance = deltas.reduce((a, d) => a + (d - mean) ** 2, 0) / (n - 1)
      stddev = Math.sqrt(variance)
    }
    biasRows.push({
      user_id: userId,
      attribute_slug: slug,
      n_samples: n,
      mean_bias_raw: round2(mean),
      bias_applied: round2(applied),
      stddev_bias: stddev == null ? null : round2(stddev),
      last_updated_at: now,
    })
    console.log(
      `  ${slug.padEnd(18)} n=${String(n).padStart(2)}  mean=${round2(mean)
        .toFixed(2)
        .padStart(6)}  applied=${round2(applied).toFixed(2).padStart(6)}`,
    )
  }

  if (!APPLY) {
    console.log("\n[DRY-RUN] nada gravado. Rode com --apply pra persistir.")
    return
  }

  // 7. grava
  const { error: upErr } = await sb
    .from("user_attribute_assessment")
    .upsert(rows, { onConflict: "user_id,work_id,attribute_slug" })
  if (upErr) throw new Error(`upsert assessment: ${upErr.message}`)

  const { error: biasErr } = await sb
    .from("attribute_bias")
    .upsert(biasRows, { onConflict: "user_id,attribute_slug" })
  if (biasErr) throw new Error(`upsert attribute_bias: ${biasErr.message}`)

  console.log(`\n[APPLIED] ${rows.length} assessments + ${biasRows.length} linhas de bias gravadas.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
