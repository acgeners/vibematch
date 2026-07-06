"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureComixReady, resolveComixDataResilient } from "@/server/actions/comix-resolver"
import { ensureComicKReady } from "@/lib/external/comick-health"
import { flareSolverrHealth } from "@/lib/external/flaresolverr"
import { acquireAndPersistWorkReviews } from "@/lib/external/acquire-reviews"
import { countWorkReviews } from "@/server/queries/work-reviews"
import { consolidateSynopsisForWork } from "@/lib/ai-recommendation/consolidate-for-work"
import { ensureReviewSummary } from "@/lib/orchestration/integrations/reviews"
import { generateWorkReviewDigest } from "@/server/actions/review-digest"
import { inferAndPersistTagsForWork } from "@/lib/tags/auto-infer"
import { triggerAiEvaluation, submitAiReview } from "@/server/actions/ai"
import { recalculateScoresNow } from "@/server/actions/recalc-queue"
import { autoPredictSynopsisQuality } from "@/lib/ai-evaluation/synopsis-quality-runner"
import { rerankSingleWorkAction } from "@/server/actions/recommendations"
import { refreshEmbeddingForWork } from "@/server/actions/embeddings"
import { estimateStepUsd } from "@/lib/orchestration/cost"
import { MANUAL_DATA_INSTRUCTIONS, type ActionName } from "@/lib/orchestration/contracts"
import type { NoReviewsReason } from "@/lib/ai-evaluation/no-reviews"
import type {
  CascadeStatus,
  SourcesHealth,
  GenerateAllResult,
  GenerateAllOpts,
} from "@/lib/generate-all/types"

// ---- Estado por-obra (works.cascade_status) --------------------------------

/** Update tolerante a coluna ausente (pré-migration 130) — nunca quebra o fluxo. */
async function setCascadeStatus(workId: string, status: CascadeStatus): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.from("works").update({ cascade_status: status }).eq("id", workId)
  } catch {
    // coluna pode não existir antes da migration — telemetria de estado é best-effort.
  }
}

/**
 * Gate de fontes de review: garante Comix E ComicK saudáveis via canário ativo
 * (bounded, ~3 min cada, em paralelo). Ambos dependem do FlareSolverr; o ComicK
 * engole falha de infra em vazio, então o canário é o único jeito de pegar a
 * queda silenciosa. `confirmed = comix && comick`.
 */
async function ensureReviewSourcesReady(): Promise<SourcesHealth> {
  const [comixReady, comickReady, fs] = await Promise.all([
    ensureComixReady(),
    ensureComicKReady(),
    flareSolverrHealth().catch(() => ({ ok: false })),
  ])
  const comix = comixReady.ok
  const comick = comickReady.ok
  return { flaresolverr: !!fs.ok, comix, comick, confirmed: comix && comick }
}

async function hasComixHid(workId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("work_external_ids")
    .select("external_id, is_rejected")
    .eq("work_id", workId)
    .eq("source", "comix")
    .eq("is_rejected", false)
    .limit(1)
    .maybeSingle()
  return !!data?.external_id
}

async function deriveNoReviewsReason(workId: string): Promise<NoReviewsReason> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("work_external_ids")
    .select("is_rejected")
    .eq("work_id", workId)
  const accepted = (data ?? []).filter((r) => r.is_rejected === false)
  if (accepted.length === 0) return "no_external_ids"
  return "sources_returned_empty"
}

// Passos PAGOS da cascata (pra somar o custo estimado do checkpoint). Embedding é
// free (OpenAI ~$0). `enrich_tags` é proxy de custo da inferência de tags (Haiku).
const CASCADE_PAID_ACTIONS: ActionName[] = [
  "consolidate_synopsis",
  "enrich_tags",
  "generate_review_summary",
  "generate_review_digest",
  "run_ai_evaluation",
  "predict_interest_potential",
  "run_alignment",
]

function estimateCascadeUsd(): number {
  return CASCADE_PAID_ACTIONS.reduce((sum, a) => sum + estimateStepUsd(a, 1), 0)
}

interface StepResult {
  fatal: boolean
  error?: string
  note?: string
}

/**
 * Cascata contínua/sequencial que gera TODOS os dados DA OBRA, um passo só quando
 * o anterior termina. Perfil de gosto EXCLUÍDO (usa o existente; sem regen).
 *
 * Fase 0 (grátis): gate Comix+ComicK (canário, bloqueia) → hid do Comix (manual)
 * → enrich Comix + adquire reviews → checkpoint (custo + sem-review). Retorna sem
 * gastar. Fase 1 (paga, só com `proceed`): sinopse → resumo+digest → tags → 9
 * atributos (auto-aceita) → recalc → Interesse → Veredito → embedding (por último).
 * PARA no 1º erro fatal; passos best-effort (Interesse/Veredito) não derrubam.
 */
export async function generateAllWorkData(
  workId: string,
  opts: GenerateAllOpts = {},
): Promise<GenerateAllResult> {
  if (!workId) return { status: "failed", failed: "input", error: "workId ausente" }

  // ---------------- FASE 0 (grátis) — checkpoint antes de gastar ----------------
  if (!opts.proceed) {
    await setCascadeStatus(workId, "verifying_sources")

    let sources: SourcesHealth | null = null
    if (!opts.ignoreSourceGate) {
      sources = await ensureReviewSourcesReady()
      if (!sources.confirmed) {
        await setCascadeStatus(workId, "needs_authorization")
        return {
          status: "needs_authorization",
          reason: "sources_unconfirmed",
          estimatedUsd: estimateCascadeUsd(),
          noReviewsReason: null,
          sources,
        }
      }
    }

    // Infra confirmada ⇒ hid ausente é gap REAL (não infra disfarçada de ausência).
    if (!opts.proceedWithoutComix && !(await hasComixHid(workId))) {
      await setCascadeStatus(workId, "blocked_manual")
      return {
        status: "blocked_manual",
        missing: "comix_hid",
        instruction: MANUAL_DATA_INSTRUCTIONS.comix_hid ?? "Cole o hid do Comix na obra.",
      }
    }

    // Enriquecimento Comix + aquisição de reviews (todas as fontes) — grátis.
    await resolveComixDataResilient(workId)
    await acquireAndPersistWorkReviews(workId)

    const reviews = await countWorkReviews(workId)
    await setCascadeStatus(workId, "needs_authorization")
    return {
      status: "needs_authorization",
      reason: reviews === 0 ? "no_reviews" : "cost",
      estimatedUsd: estimateCascadeUsd(),
      noReviewsReason: reviews === 0 ? await deriveNoReviewsReason(workId) : null,
      sources,
    }
  }

  // ---------------- FASE 1 (paga) — sequencial, para no 1º erro fatal ----------------
  await setCascadeStatus(workId, "generating")
  const proceedWithoutReviews = opts.proceedWithoutReviews ?? false

  const steps: Array<{ action: ActionName; run: () => Promise<StepResult> }> = [
    {
      action: "consolidate_synopsis",
      run: async () => {
        const r = await consolidateSynopsisForWork(workId)
        return r.status === "failed" ? { fatal: true, error: r.error } : { fatal: false, note: r.status }
      },
    },
    {
      action: "generate_review_summary",
      run: async () => {
        const r = await ensureReviewSummary(workId, { allowPaid: true })
        return r.status === "failed" ? { fatal: true, error: r.error } : { fatal: false, note: r.status }
      },
    },
    {
      action: "generate_review_digest",
      run: async () => {
        const r = await generateWorkReviewDigest(workId)
        return r.status === "error" ? { fatal: true, error: r.message } : { fatal: false, note: r.status }
      },
    },
    {
      action: "enrich_tags",
      run: async () => {
        // best-effort por design (nunca lança; no-op sem sinopse utilizável)
        const n = await inferAndPersistTagsForWork(workId)
        return { fatal: false, note: `${n} tags` }
      },
    },
    {
      action: "run_ai_evaluation",
      run: () => runAiEvaluationStep(workId, proceedWithoutReviews),
    },
    {
      action: "recalculate_scores",
      run: async () => {
        const r = await recalculateScoresNow()
        return r.status === "failed" ? { fatal: true, error: r.error } : { fatal: false, note: r.status }
      },
    },
    {
      action: "predict_interest_potential",
      run: async () => {
        // best-effort: usa perfil fresh existente; sem perfil, no-op (engole erro)
        await autoPredictSynopsisQuality(workId)
        return { fatal: false }
      },
    },
    {
      action: "run_alignment",
      run: async () => {
        // Veredito IA tem gates legítimos (plano pago / perfil não-stub / limite
        // diário). Falha aqui é SKIP, não erro fatal da cascata.
        const r = await rerankSingleWorkAction(workId)
        return { fatal: false, note: r.error ? `skip: ${r.error}` : "ok" }
      },
    },
    {
      action: "generate_embedding",
      run: async () => {
        // ÚLTIMO: depende de sinopse+tags+scores+digest (o hash reflete tudo).
        const r = await refreshEmbeddingForWork(workId)
        return r.failed ? { fatal: true, error: "falha ao gerar embedding" } : { fatal: false }
      },
    },
  ]

  const ran: string[] = []
  for (const step of steps) {
    const r = await step.run()
    if (r.fatal) {
      await setCascadeStatus(workId, "failed")
      revalidatePath(`/titles/${workId}`)
      return { status: "failed", failed: step.action, error: r.error ?? "erro desconhecido" }
    }
    ran.push(step.action)
  }

  await setCascadeStatus(workId, "done")
  revalidatePath(`/titles/${workId}`)
  return { status: "ready", ran }
}

/**
 * Passo da Avaliação IA com AUTO-ACEITE: roda a avaliação (9 atributos) e comita
 * os scores como `ai_accepted` (ai_eval_status=done) — necessário porque o recalc
 * e o embedding leem `category_scores` comitados. `proceedWithoutReviews` já foi
 * autorizado no checkpoint, então o gate de "sem review" não dispara aqui.
 */
async function runAiEvaluationStep(
  workId: string,
  proceedWithoutReviews: boolean,
): Promise<StepResult> {
  const res = await triggerAiEvaluation(workId, { proceedWithoutReviews })
  if ("error" in res && res.error) return { fatal: true, error: res.error }
  if ("needsReviewConfirmation" in res) {
    return { fatal: true, error: "avaliação IA pediu confirmação de reviews inesperadamente" }
  }
  if (!("data" in res) || !res.data) return { fatal: true, error: "avaliação IA sem resultado" }

  const evaluation = res.data.evaluation as unknown as {
    id: string
    ai_evaluation_scores?: Array<{ criterion_slug: string; suggested_score: number | string }>
  }
  const scoreRows = evaluation.ai_evaluation_scores ?? []
  if (scoreRows.length === 0) return { fatal: true, error: "avaliação IA não retornou scores" }

  const submit = await submitAiReview({
    evaluationId: evaluation.id,
    workId,
    scores: scoreRows.map((s) => ({
      criterionSlug: s.criterion_slug,
      acceptedScore: Number(s.suggested_score),
      wasEdited: false,
    })),
  })
  if (submit.error) return { fatal: true, error: submit.error }
  return { fatal: false }
}
