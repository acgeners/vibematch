/**
 * Integração de `generate_review_summary` e `generate_review_digest` com a
 * orquestração durável (Fase B passo 2) — ver ARQUITETURA-ORQUESTRACAO.md.
 *
 * Substitui o controle implícito/fire-and-forget de `saveWorkReviews` por jobs
 * duráveis com dedup, status, falha persistida e retomada — SEM mudar o resultado
 * funcional: mesmos modelos/prompts/versões/schemas, mesmos gates de
 * materialidade e hashes, mesmas entradas. NÃO cria chamada de LLM só por existir.
 *
 * Pré-autorização de custo é propriedade do PONTO DE ENTRADA: o save passa
 * `allowPaid:true` (preserva o auto-run de hoje, single-op); lotes/novas cascatas
 * passam `allowPaid:false` e somam o custo → confirmação (micro-threshold $0.02).
 *
 * Testabilidade: as dependências de IO (gateway de DB + função de consolidação +
 * jobStore) são INJETÁVEIS. Os testes rodam sem DB e sem provider; o smoke usa o
 * SupabaseJobStore real com gateway em memória (não toca em `works`).
 */

import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { readCanonicalReviewCorpus, readSummaryReviewInputs } from "@/lib/synopsis-interest/digest-corpus"
import { refreshArtSignalForWork } from "@/lib/art/refresh"
import { computeCostUsd } from "@/lib/ai/pricing"
import {
  consolidateReviewsDetailed,
  consolidateReviewsDigestDetailed,
  hashReviewInputs,
  isMaterialReviewChange,
  packReviewSummaryMeta,
  parseReviewSummaryMeta,
  REVIEW_DIGEST_VERSION,
  REVIEW_SUMMARIZER_PROMPT_VERSION,
  type ConsolidateReviewsStatus,
  type ConsolidateDigestStatus,
  type ReviewDigestInput,
  type ReviewSummaryInput,
} from "@/lib/ai-recommendation/review-summarizer"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"
import { DEFAULT_MICRO_THRESHOLD_USD, gateActionCost } from "../cost"
import { getJobStore, runOrchestratedJob, type JobStore } from "../jobs"
import { isUsefulReviewText } from "@/lib/reviews/useful-review"
import { MIN_USEFUL_REVIEWS_FOR_DIGEST, hasEnoughReviewsForDigest } from "@/lib/reviews/digest-gate"

/** Teto de amostragem das reviews (MAX_REVIEWS / DIGEST_TOTAL_CAP no summarizer). */
const REVIEW_SAMPLE_CAP = 40

type AdminClient = ReturnType<typeof createAdminClient>

// ---- Readiness (puro, espelha os gates existentes) -------------------------

export type ArtifactReadiness =
  // `few_reviews` só existe para o DIGEST: o resumo (Haiku, ~0,2¢) continua valendo
  // com uma review só — é texto pra ler, não consenso destilado.
  | { state: "not_applicable"; reason: "no_reviews" | "few_reviews" }
  | { state: "absent" }
  | { state: "fresh" }
  | { state: "immaterial" }
  | { state: "stale"; reason: "hash" | "version" | "materiality" | "forced" }

/**
 * Gate do SUMMARY — idêntico a persistReviewSummary: hash + materialidade (sem
 * versão). present+hash igual ⇒ fresh; present+hash difere+imaterial ⇒ immaterial;
 * present+hash difere+material ⇒ stale; ausente ⇒ absent; 0 reviews ⇒ n/a.
 */
export function classifySummaryReadiness(args: {
  reviewCount: number
  currentHash: string
  nowN: number
  storedSummary: string | null
  storedMeta: string | null
  /** Ver `EnsureSummaryDeps.force`: pula só a materialidade, nunca o hash. */
  force?: boolean
}): ArtifactReadiness {
  if (args.reviewCount === 0) return { state: "not_applicable", reason: "no_reviews" }
  if (args.storedSummary == null) return { state: "absent" }
  const { hash: prevHash, n: prevN } = parseReviewSummaryMeta(args.storedMeta)
  // Hash igual = MESMO conteúdo: nada a regenerar, nem sob `force` (senão a
  // recuperação tardia que não trouxe nada novo pagaria um Haiku à toa).
  if (prevHash === args.currentHash) return { state: "fresh" }
  if (args.force) return { state: "stale", reason: "forced" }
  if (!isMaterialReviewChange(prevN, args.nowN)) return { state: "immaterial" }
  return { state: "stale", reason: "hash" }
}

/**
 * Gate do DIGEST — idêntico a persistReviewDigest: versão + materialidade (sem
 * hash de conteúdo). ausente ⇒ absent; versão != atual ⇒ stale(version);
 * versão atual + crescimento material ⇒ stale(materiality); senão fresh.
 */
export function classifyDigestReadiness(args: {
  reviewCount: number
  nowN: number
  storedDigest: unknown
  storedVersion: string | null
  storedN: number | null
  /**
   * Força o regen quando há reviews (lacuna #1): o gate por-contagem ignora
   * edição de corpus que não cresce ≥materialidade (ex.: add/edit/delete de UMA
   * review manual externa — curadoria deliberada). O path scraped NÃO passa
   * force ⇒ comportamento/custo inalterados. A dedup por contentHash do job
   * evita LLM redundante quando o conteúdo de fato não mudou.
   */
  force?: boolean
}): ArtifactReadiness {
  if (args.reviewCount === 0) return { state: "not_applicable", reason: "no_reviews" }
  // Piso MEDIDO (ver `lib/reviews/digest-gate.ts`): abaixo de 4 reviews úteis o
  // modelo não alcança os 3 traços que o próprio prompt exige em 25-75% dos casos,
  // e o digest magro é consumido pelo consultor IA como se fosse sinal.
  // ⚠️ Vem ANTES do `force`: forçar não cria consenso que as reviews não têm.
  if (!hasEnoughReviewsForDigest(args.reviewCount)) {
    return { state: "not_applicable", reason: "few_reviews" }
  }
  if (args.storedDigest == null) return { state: "absent" }
  if (args.storedVersion !== REVIEW_DIGEST_VERSION) return { state: "stale", reason: "version" }
  if (args.force) return { state: "stale", reason: "forced" }
  if (isMaterialReviewChange(args.storedN, args.nowN)) return { state: "stale", reason: "materiality" }
  return { state: "fresh" }
}

export function summaryDedupKey(workId: string, contentHash: string): string {
  return `generate_review_summary:${workId}:${contentHash}:${REVIEW_SUMMARIZER_PROMPT_VERSION}`
}

/**
 * Chave de dedup/cache do digest. `tag` OPCIONAL (B2.2N): quando presente, é anexado à chave —
 * usado pelo executor EXPERIMENTAL para versionar o cache pela política do corpus (text-only),
 * de modo que trocar a política NÃO reutilize um digest gerado sob a política anterior. Produção
 * (`persist-reviews.ts`) NÃO passa `tag` ⇒ chave idêntica à de hoje (comportamento inalterado).
 */
export function digestDedupKey(workId: string, contentHash: string, tag?: string): string {
  const base = `generate_review_digest:${workId}:${contentHash}:${REVIEW_DIGEST_VERSION}`
  return tag ? `${base}:${tag}` : base
}

// ---- Gateways (IO injetável) ----------------------------------------------

export interface SummaryGateway {
  readReviews(workId: string): Promise<ReviewSummaryInput[]>
  readArtifact(workId: string): Promise<{ summary: string | null; meta: string | null }>
  writeArtifact(workId: string, v: { summary: string; hash: string; n: number; at: string }): Promise<void>
}

export interface DigestGateway {
  readReviews(workId: string): Promise<ReviewDigestInput[]>
  readArtifact(workId: string): Promise<{ digest: unknown; version: string | null; n: number | null }>
  writeArtifact(workId: string, v: { digest: ReviewDigest; n: number; at: string }): Promise<void>
}

class SupabaseSummaryGateway implements SummaryGateway {
  constructor(private readonly sb: AdminClient) {}
  async readReviews(workId: string): Promise<ReviewSummaryInput[]> {
    // Corpus do resumo (= sempre): scraped (work_reviews, com nota) + manual externa
    // (work_external_reviews_manual, sem nota). Mesma fonte que o digest, mas o resumo
    // mantém as notas. NUNCA inclui work_manual_reviews (opinião pessoal).
    return readSummaryReviewInputs(workId, this.sb)
  }
  async readArtifact(workId: string) {
    const { data } = await this.sb
      .from("works")
      .select("review_summary, review_summary_inputs_hash")
      .eq("id", workId)
      .maybeSingle()
    return {
      summary: (data?.review_summary as string | null) ?? null,
      meta: (data?.review_summary_inputs_hash as string | null) ?? null,
    }
  }
  async writeArtifact(workId: string, v: { summary: string; hash: string; n: number; at: string }) {
    await this.sb
      .from("works")
      .update({ review_summary: v.summary, review_summary_at: v.at, review_summary_inputs_hash: packReviewSummaryMeta(v.hash, v.n) })
      .eq("id", workId)
  }
}

export class SupabaseDigestGateway implements DigestGateway {
  constructor(private readonly sb: AdminClient) {}
  async readReviews(workId: string): Promise<ReviewDigestInput[]> {
    // Corpus CANÔNICO (Fase 2 / 2A): work_reviews (scraped) + work_external_reviews_manual
    // (manual externa), deduplicado e leakage-proof (sem userRating — notas pessoais não entram).
    // É a MESMA fonte validada na golden-3 (Fase 1 GO). NÃO inclui work_manual_reviews (opinião
    // pessoal da usuária), que segue barrado pelo loader canônico.
    const corpus = await readCanonicalReviewCorpus(workId, this.sb)
    return corpus.reviews.map((r) => ({ text: r.text, source: r.source, userRating: null }))
  }
  async readArtifact(workId: string) {
    const { data } = await this.sb
      .from("works")
      .select("review_digest, review_digest_version, review_digest_n")
      .eq("id", workId)
      .maybeSingle()
    return {
      digest: (data?.review_digest as unknown) ?? null,
      version: (data?.review_digest_version as string | null) ?? null,
      n: (data?.review_digest_n as number | null) ?? null,
    }
  }
  async writeArtifact(workId: string, v: { digest: ReviewDigest; n: number; at: string }) {
    await this.sb
      .from("works")
      .update({ review_digest: v.digest, review_digest_at: v.at, review_digest_n: v.n, review_digest_version: REVIEW_DIGEST_VERSION })
      .eq("id", workId)
    // O eixo "arte" do digest alimenta 17,5% do peso do estimador — digest novo, sinal novo.
    // Não lança (o helper engole e loga com prefixo `[arte-signal]`).
    await refreshArtSignalForWork(workId)
  }
}

// ---- Resultado + opções ----------------------------------------------------

export type EnsureReviewOutcome =
  | { status: "not_ready"; reason: "no_reviews" | "few_reviews"; message: string }
  | { status: "skipped"; reason: "fresh" | "immaterial" }
  | { status: "succeeded"; ranLlm: boolean; costUsd: number }
  | { status: "processing" }
  | { status: "failed"; error: string }
  | { status: "blocked_cost_confirmation"; reason: "threshold" | "over_cap" | "pricing_unknown"; estimatedUsd: number }

interface CommonDeps {
  supabase?: AdminClient
  /** Pré-autoriza o custo (save = true; lote/cascata = false). Default false. */
  allowPaid?: boolean
  maxCostUsd?: number
  microThresholdUsd?: number
  jobStore?: JobStore
  now?: () => string
}

export interface EnsureSummaryDeps extends CommonDeps {
  /** Reviews já lidas (caminho do save evita re-ler). */
  reviews?: ReviewSummaryInput[]
  gateway?: SummaryGateway
  consolidate?: (r: ReviewSummaryInput[], o: { workId?: string | null }) => Promise<ConsolidateReviewsStatus>
  /**
   * Força o regen ignorando o gate de MATERIALIDADE (espelha o `force` do digest).
   * Caso de uso: recuperação tardia de uma fonte que falhou — costuma trazer poucas
   * reviews, abaixo do limiar, e sem isto o resumo fica congelado no pool parcial.
   * NÃO fura o gate de hash: conteúdo idêntico segue `fresh` (não paga à toa).
   */
  force?: boolean
}

export interface EnsureDigestDeps extends CommonDeps {
  reviews?: ReviewDigestInput[]
  gateway?: DigestGateway
  consolidate?: (r: ReviewDigestInput[], o: { workId?: string | null }) => Promise<ConsolidateDigestStatus>
  /** Tag opcional p/ a chave de dedup/cache (B2.2N): executor experimental passa a versão da política do corpus. */
  dedupTag?: string
  /** Força o regen ignorando o gate por-contagem (lacuna #1 — curadoria manual externa). */
  force?: boolean
}

const NO_REVIEWS_MSG = "Obra sem reviews úteis — busque/adicione reviews (Atualizar dados / Revalidar fontes) antes."

/** Distinto do "sem reviews": aqui existe material, só não o suficiente pra destilar
 *  consenso. A ação é a mesma (buscar mais), mas a causa não — e uma mensagem que
 *  diz "sem reviews" sobre uma obra que tem 3 manda procurar o que já está lá. */
const FEW_REVIEWS_MSG =
  `Reviews de menos pra um digest (mínimo ${MIN_USEFUL_REVIEWS_FOR_DIGEST} úteis) — ` +
  "com menos que isso o modelo não tem consenso pra destilar. Busque mais reviews antes."

// ---- generate_review_summary ----------------------------------------------

export async function ensureReviewSummary(
  workId: string,
  deps: EnsureSummaryDeps = {},
): Promise<EnsureReviewOutcome> {
  // Client resolvido com lazy memo — só criado se gateway/jobStore não forem
  // injetados (testes injetam ambos ⇒ nenhum createAdminClient).
  let cachedSb: AdminClient | null = null
  const sb = (): AdminClient => (cachedSb ??= deps.supabase ?? createAdminClient())
  const gateway = deps.gateway ?? new SupabaseSummaryGateway(sb())
  const consolidate = deps.consolidate ?? consolidateReviewsDetailed
  const micro = deps.microThresholdUsd ?? DEFAULT_MICRO_THRESHOLD_USD
  const allowPaid = deps.allowPaid ?? false

  const raw = deps.reviews ?? (await gateway.readReviews(workId))
  const cleaned = raw
    .map((r) => ({ text: (r.text ?? "").trim(), userRating: r.userRating ?? null }))
    .filter((r) => isUsefulReviewText(r.text))
  // Ordem determinística — idêntica a persistReviewSummary (estabiliza o hash).
  const ordered = [...cleaned].sort((a, b) => a.text.localeCompare(b.text))
  const hash = hashReviewInputs(ordered)
  const nowN = ordered.length

  const artifact = await gateway.readArtifact(workId)
  const readiness = classifySummaryReadiness({
    reviewCount: cleaned.length,
    currentHash: hash,
    nowN,
    storedSummary: artifact.summary,
    storedMeta: artifact.meta,
    force: deps.force,
  })

  if (readiness.state === "not_applicable") return { status: "not_ready", reason: "no_reviews", message: NO_REVIEWS_MSG }
  if (readiness.state === "fresh") return { status: "skipped", reason: "fresh" }
  if (readiness.state === "immaterial") return { status: "skipped", reason: "immaterial" }

  const scale = Math.min(nowN, REVIEW_SAMPLE_CAP)
  const gate = gateActionCost("generate_review_summary", scale, { allowPaid, maxCostUsd: deps.maxCostUsd, microThresholdUsd: micro })
  if ("blocked" in gate) return { status: "blocked_cost_confirmation", reason: gate.blocked, estimatedUsd: gate.estimatedUsd }

  const jobStore = deps.jobStore ?? (await getJobStore(sb()))
  let ranLlm = false
  let costUsd = 0
  const run = await runOrchestratedJob(
    jobStore,
    {
      action: "generate_review_summary",
      workId,
      dedupKey: summaryDedupKey(workId, hash),
      estimateUsd: gate.estimatedUsd,
      payload: { hash, n: nowN, promptVersion: REVIEW_SUMMARIZER_PROMPT_VERSION },
    },
    async () => {
      // Re-check (anti-cobrança-dupla): outro processo pode ter produzido fresh.
      const fresh = await gateway.readArtifact(workId)
      const r2 = classifySummaryReadiness({ reviewCount: cleaned.length, currentHash: hash, nowN, storedSummary: fresh.summary, storedMeta: fresh.meta, force: deps.force })
      if (r2.state === "fresh" || r2.state === "immaterial") return { costActualUsd: 0 }
      const status = await consolidate(ordered, { workId })
      if (status.kind === "api_failed") throw new Error(status.error)
      if (status.kind !== "ok") return { costActualUsd: 0 } // skipped: não persiste, não apaga o anterior
      await gateway.writeArtifact(workId, { summary: status.result.summary, hash, n: nowN, at: deps.now?.() ?? new Date().toISOString() })
      const c = computeCostUsd(status.result.model, { inputTokens: status.result.tokensIn, outputTokens: status.result.tokensOut, cacheReadTokens: 0, cacheCreationTokens: 0 })
      ranLlm = true
      costUsd = c.costInputUsd + c.costOutputUsd
      return { costActualUsd: costUsd }
    },
  )

  if (run.status === "processing") return { status: "processing" }
  if (run.status === "failed") return { status: "failed", error: run.error instanceof Error ? run.error.message : String(run.error) }
  return { status: "succeeded", ranLlm, costUsd }
}

// ---- generate_review_digest -----------------------------------------------

export async function ensureReviewDigest(
  workId: string,
  deps: EnsureDigestDeps = {},
): Promise<EnsureReviewOutcome> {
  let cachedSb: AdminClient | null = null
  const sb = (): AdminClient => (cachedSb ??= deps.supabase ?? createAdminClient())
  const gateway = deps.gateway ?? new SupabaseDigestGateway(sb())
  const consolidate = deps.consolidate ?? consolidateReviewsDigestDetailed
  const micro = deps.microThresholdUsd ?? DEFAULT_MICRO_THRESHOLD_USD
  const allowPaid = deps.allowPaid ?? false

  const raw = deps.reviews ?? (await gateway.readReviews(workId))
  const cleaned = raw
    .map((r) => ({ text: (r.text ?? "").trim(), source: r.source || "desconhecida", userRating: r.userRating ?? null }))
    .filter((r) => isUsefulReviewText(r.text))
  const nowN = cleaned.length
  // Hash de conteúdo SÓ p/ a dedup_key (o gate do digest é versão+materialidade,
  // sem hash) — garante que "reviews mudaram" gere nova chave/execução.
  const contentHash = hashReviewInputs(cleaned.map((r) => ({ text: r.text })))

  const artifact = await gateway.readArtifact(workId)
  const readiness = classifyDigestReadiness({
    reviewCount: cleaned.length,
    nowN,
    storedDigest: artifact.digest,
    storedVersion: artifact.version,
    storedN: artifact.n,
    force: deps.force,
  })

  if (readiness.state === "not_applicable") {
    // Duas causas, duas mensagens: "sem reviews" dito a uma obra que tem 3 manda
    // procurar o que já está lá.
    return readiness.reason === "few_reviews"
      ? { status: "not_ready", reason: "few_reviews", message: FEW_REVIEWS_MSG }
      : { status: "not_ready", reason: "no_reviews", message: NO_REVIEWS_MSG }
  }
  if (readiness.state === "fresh") return { status: "skipped", reason: "fresh" }
  if (readiness.state === "immaterial") return { status: "skipped", reason: "immaterial" }

  const scale = Math.min(nowN, REVIEW_SAMPLE_CAP)
  const gate = gateActionCost("generate_review_digest", scale, { allowPaid, maxCostUsd: deps.maxCostUsd, microThresholdUsd: micro })
  if ("blocked" in gate) return { status: "blocked_cost_confirmation", reason: gate.blocked, estimatedUsd: gate.estimatedUsd }

  const jobStore = deps.jobStore ?? (await getJobStore(sb()))
  let ranLlm = false
  let costUsd = 0
  const run = await runOrchestratedJob(
    jobStore,
    {
      action: "generate_review_digest",
      workId,
      dedupKey: digestDedupKey(workId, contentHash, deps.dedupTag),
      estimateUsd: gate.estimatedUsd,
      payload: { contentHash, n: nowN, version: REVIEW_DIGEST_VERSION },
    },
    async () => {
      const fresh = await gateway.readArtifact(workId)
      const r2 = classifyDigestReadiness({ reviewCount: cleaned.length, nowN, storedDigest: fresh.digest, storedVersion: fresh.version, storedN: fresh.n, force: deps.force })
      if (r2.state === "fresh") return { costActualUsd: 0 }
      const status = await consolidate(cleaned, { workId })
      if (status.kind === "api_failed") throw new Error(status.error)
      if (status.kind !== "ok") return { costActualUsd: 0 } // skipped: não persiste, não apaga o anterior
      await gateway.writeArtifact(workId, { digest: status.result.digest, n: nowN, at: deps.now?.() ?? new Date().toISOString() })
      const c = computeCostUsd(status.result.model, { inputTokens: status.result.tokensIn, outputTokens: status.result.tokensOut, cacheReadTokens: 0, cacheCreationTokens: 0 })
      ranLlm = true
      costUsd = c.costInputUsd + c.costOutputUsd
      return { costActualUsd: costUsd }
    },
  )

  if (run.status === "processing") return { status: "processing" }
  if (run.status === "failed") return { status: "failed", error: run.error instanceof Error ? run.error.message : String(run.error) }
  return { status: "succeeded", ranLlm, costUsd }
}
