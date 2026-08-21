"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTasteProfile, rankFavorites, MODEL, PROMPT_VERSION } from "@/lib/ai-recommendation/service"
import { type RankingFilters } from "@/server/queries/ranking"
import { ensureAdmin, getSessionUserId } from "@/server/queries/current-user"
import { ensureAiConsumption } from "@/server/queries/ai-quota"
import { ensureReadingStateWriter } from "@/server/queries/user-work-state"
import { mirrorOwnerScores } from "@/server/queries/owner-labels"
import { buildTasteProfileHeuristic } from "@/lib/ai-recommendation/taste-profile-heuristic"
import { classifyProfileStaleness, computeHeuristicFingerprint } from "@/lib/ai-recommendation/profile-drift"
import type { ProfileStaleness } from "@/lib/ai-recommendation/profile-staleness"
import { estimateStep } from "@/lib/orchestration/cost"
import { loadOrEnsureProfile } from "@/lib/ai-recommendation/ensure-profile"
import {
  buildStubProfile,
  computeInputHash,
  insertNewTasteProfile,
  loadCurrentTasteProfile,
  MIN_WORKS_FOR_FULL_PROFILE,
} from "@/lib/ai-recommendation/taste-profile"
import {
  countStaleAlignmentWorks,
  getCandidateById,
  getCandidatesByIds,
  getFavoriteCandidates,
  getRankingCandidates,
  getRatedWorksForProfile,
  getRunsToday,
  getStaleAlignmentCandidates,
  type FavoriteCandidate,
} from "@/server/queries/recommendations"
import { MAX_CANDIDATES_HARD_LIMIT } from "@/lib/ai-recommendation/limits"
import { getPreferenceRules } from "@/server/queries/preference-rules"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import type { TagStance } from "@/server/queries/tag-preferences"
import { STRONG_TAG_WEIGHT } from "@/lib/tags/segment"
import { getSynopsisInputsBatch } from "@/server/queries/work-card-meta"
import type { SynopsisInputs } from "@/server/queries/work-card-meta"
import { recordRecommendationSnapshots } from "@/lib/server/predictions/record-prediction"
import type {
  ChatRecommendationItem,
  RankedCandidate,
  RankedWork,
  RecommendationMode,
  TasteProfileRow,
} from "@/lib/ai-recommendation/types"

const MAX_RUNS_PER_DAY = 20

/**
 * Extrai apenas os campos enriquecidos (sub-fase 2.3.A) pra persistir em
 * `calculated_scores.alignment_payload`. Retorna NULL quando nenhum dos
 * campos opcionais foi preenchido pelo modelo — evita upsert de JSONB vazio.
 */
function buildAlignmentPayload(r: RankedWork): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {}
  if (r.confidence != null) payload.confidence = r.confidence
  if (r.risks && r.risks.length > 0) payload.risks = r.risks
  if (r.similar_loved && r.similar_loved.length > 0) payload.similar_loved = r.similar_loved
  if (r.similar_avoided && r.similar_avoided.length > 0) payload.similar_avoided = r.similar_avoided
  if (r.review_quotes && r.review_quotes.length > 0) payload.review_quotes = r.review_quotes
  if (r.mood_fit != null) payload.mood_fit = r.mood_fit
  return Object.keys(payload).length > 0 ? payload : null
}

interface AlignmentRow {
  work_id: string
  alignment_score: number | null
  alignment_run_id: string | null
  alignment_justification: string | null
  alignment_payload: Record<string, unknown> | null
  alignment_at: string
  alignment_stale: boolean
}

/**
 * Persiste alignment_* (Veredito IA) pro usuário ATUAL, não pra linha
 * compartilhada de `calculated_scores` (que não tem `user_id` — 1 linha por
 * obra, `UNIQUE(work_id)`). O valor depende do PERFIL de quem clicou
 * (`loadOrEnsureProfile`), então gravar sempre na linha compartilhada faz o
 * 2º usuário a rankear uma obra apagar o Veredito do 1º, em silêncio.
 *
 * Dono: grava nas DUAS tabelas — mantém `calculated_scores` como passthrough
 * de leitura pra ele e pro visitante anônimo (mesmo dual-write de
 * `recalculateAll`/`server/actions/calculations.ts`). Não-dono: grava SÓ em
 * `user_calculated_scores` (via `mirrorOwnerScores`, já genérica — mesmo
 * padrão de `recalculateForUser`/`server/recalc/user-recalc.ts`).
 */
async function persistAlignmentScores(
  userId: string,
  isOwner: boolean,
  rows: AlignmentRow[],
): Promise<{ error: string | null }> {
  if (rows.length === 0) return { error: null }
  if (isOwner) {
    const { error } = await createAdminClient()
      .from("calculated_scores")
      .upsert(rows, { onConflict: "work_id" })
    if (error) return { error: `Falha persistindo alignment_score: ${error.message}` }
  }
  return mirrorOwnerScores(userId, rows as unknown as Record<string, unknown>[])
}

// Gera slug único no formato YYYY-MM-DD-N. Tenta computar N olhando o máximo do
// dia e re-tenta em colisão (race entre runs simultâneas — raro, mas garante a
// unique constraint do índice).
async function generateRunSlug(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10)
  const { data: existing } = await supabase
    .from("recommendation_runs")
    .select("slug")
    .like("slug", `${today}-%`)
  const maxN = (existing ?? []).reduce((max, row) => {
    const slug = (row.slug as string | null) ?? ""
    const n = parseInt(slug.slice(today.length + 1), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `${today}-${maxN + 1}`
}

/**
 * Insere uma `recommendation_runs` com slug único, re-tentando em colisão de slug
 * (código 23505) — race entre runs simultâneas. Retorna null (e loga) se falhar
 * por outro motivo, pra o caller decidir se a persistência era essencial.
 * Compartilhado por `runRecommendationAction` e pelo "salvar desempate".
 */
async function insertRecommendationRun(
  supabase: ReturnType<typeof createAdminClient>,
  baseInsert: Record<string, unknown>,
): Promise<{ id: string; slug: string } | null> {
  // Dono da run (migration 141). Sem isto a run nasce órfã e a cota diária — que conta
  // por user_id — nunca enxergaria o gasto de ninguém.
  const userId = await getSessionUserId()

  // FALLBACK-SAFE: a migration 141 é aplicada à mão, então a coluna `user_id` pode ainda
  // não existir. Sem isto, o código mergeado antes da migration derrubaria a persistência
  // de TODA recomendação (42703 = coluna inexistente).
  let withUserId = true

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await generateRunSlug(supabase)
    const row = withUserId ? { ...baseInsert, user_id: userId, slug } : { ...baseInsert, slug }
    const { data, error } = await supabase
      .from("recommendation_runs")
      .insert(row)
      .select("id, slug")
      .single()
    if (!error && data) return { id: data.id as string, slug: data.slug as string }

    if (error?.code === "42703" && withUserId) {
      console.warn("[recommendations] recommendation_runs.user_id não existe — aplique a migration 141. A cota diária segue GLOBAL até lá.")
      withUserId = false
      continue
    }
    if (error?.code !== "23505") {
      console.error("[recommendations] falha persistindo run:", error)
      return null
    }
  }
  console.error("[recommendations] falha persistindo run: colisões de slug esgotaram as tentativas")
  return null
}

export interface ProfileStatus {
  hasProfile: boolean
  profile: TasteProfileRow | null
  isStale: boolean
  currentHash: string
  ratedWorksCount: number
  /**
   * O gate de staleness INTEIRO, não só o booleano. O card mostra "quão defasado"
   * (drift medido + qual gatilho disparou); devolver só `isStale` obrigaria a UI a
   * recalcular — ou, pior, a chutar. Null quando não há perfil.
   */
  staleness: ProfileStaleness | null
  /** Custo provável de recomputar AGORA (USD), na escala de obras rotuladas de hoje. */
  regenCostUsd: number
}

/**
 * Status sem sujeito. NÃO é "erro" nem "ainda carregando": é o que existe pra quem não
 * está logado — nenhum perfil, nenhuma obra avaliada, nada a recomputar.
 */
const ANONYMOUS_PROFILE_STATUS: ProfileStatus = {
  hasProfile: false,
  profile: null,
  isStale: false,
  currentHash: "",
  ratedWorksCount: 0,
  staleness: null,
  regenCostUsd: 0,
}

export async function getTasteProfileStatusAction(): Promise<ProfileStatus> {
  /**
   * 🔴 Resolve por SESSÃO, e devolve vazio sem ela.
   *
   * `loadCurrentTasteProfile()` e `getRatedWorksForProfile()` resolvem por
   * `getCurrentUserId()`, que sem sessão cai no singleton — o DONO. Isso é o
   * comportamento certo em background (o recalc precisa do bias dele) e errado numa
   * função que TRÊS páginas renderizam: `/dashboard`, `/recommendations` e
   * `/account/taste-profile`.
   *
   * Medido em 2026-08-09: `/dashboard` anônimo devolvia 200 imprimindo o
   * `taste_profile.summary` do dono em prosa ("…o coração do gosto é o romance de
   * fantasia/rofan…"), mais os temas e as tags amadas dele. Sem erro e sem log — a
   * página tinha um sujeito, o errado.
   *
   * O gate de rota (`/dashboard` e `/account` no proxy) é a 2ª camada. Esta é a 1ª, e é a
   * que protege o próximo consumidor: um leitor novo desta action herda o vazamento
   * sem que nada acuse.
   */
  const userId = await getSessionUserId()
  if (!userId) return ANONYMOUS_PROFILE_STATUS

  const [profile, ratedWorks] = await Promise.all([
    loadCurrentTasteProfile(userId),
    getRatedWorksForProfile(undefined, userId),
  ])
  const currentHash = computeInputHash(ratedWorks)
  const staleness =
    profile == null
      ? null
      : classifyProfileStaleness({
          savedFingerprint: profile.heuristic_fingerprint ?? null,
          currentFingerprint: computeHeuristicFingerprint(ratedWorks),
          savedInputHash: profile.input_hash,
          currentInputHash: currentHash,
          savedNWorks: profile.n_works_used,
          currentNWorks: ratedWorks.length,
          savedCreatedAt: profile.created_at,
          nowMs: Date.now(),
        })
  return {
    hasProfile: profile != null,
    profile,
    isStale: staleness?.stale ?? false,
    currentHash,
    ratedWorksCount: ratedWorks.length,
    staleness,
    // Mesmo estimador que o popup de custo usa nos fluxos pagos — o chip do botão
    // não pode prometer um preço diferente do que a execução cobra (PR #206).
    regenCostUsd: estimateStep("ensure_taste_profile", ratedWorks.length).likelyUsd,
  }
}

/**
 * Nomes de tags amadas/evitadas EFETIVOS do usuário: perfil de gosto UNIDO às
 * preferências DECLARADAS (`user_tag_preferences`, expandidas por tag). As
 * declaradas são explícitas e PRECEDEM o perfil inferido. Usado pra colorir tags
 * (verde amada / vermelho evitada) no popover de inputs da obra.
 *
 * Nomes do perfil (LLM) podem vir com qualificador — "Harem (sem contexto…)" →
 * indexa também "harem" pra casar com a tag da obra. As declaradas têm nome limpo
 * (catálogo). Tudo em minúsculas.
 */
export async function getEffectiveTagStanceAction(): Promise<{
  loved: string[]
  avoided: string[]
  /** Nomes com ênfase 2× DECLARADA (`STRONG_TAG_WEIGHT`) — o "muito amada/evitada". */
  strong: string[]
  /** Nomes que vieram de DECLARAÇÃO (o resto veio do perfil inferido) — só pro tooltip. */
  declared: string[]
}> {
  const [profileRow, declared] = await Promise.all([
    loadCurrentTasteProfile(),
    getDeclaredTagPreferences(),
  ])
  const stance = new Map<string, TagStance>()
  const addProfile = (name: unknown, s: TagStance) => {
    if (!name) return
    const full = String(name).toLowerCase().trim()
    if (!full) return
    stance.set(full, s)
    const head = full.split("(")[0].trim()
    if (head && head !== full) stance.set(head, s)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = profileRow?.profile as any
  // Perfil: avoided antes de loved (love vence conflito interno do perfil).
  for (const t of p?.avoided_tags ?? []) addProfile(t?.name, "avoid")
  for (const t of p?.loved_tags ?? []) addProfile(t?.name, "love")
  // Declaradas por último → precedem o perfil (nome limpo do catálogo).
  // A ênfase 2× só existe aqui: o perfil traz `strength` 0–1, outra escala.
  const strongNames = new Set<string>()
  const declaredNames = new Set<string>()
  for (const d of declared) {
    const n = d.name.toLowerCase().trim()
    if (!n) continue
    stance.set(n, d.stance)
    declaredNames.add(n)
    if (d.weight >= STRONG_TAG_WEIGHT) strongNames.add(n)
  }
  const loved: string[] = []
  const avoided: string[] = []
  for (const [name, s] of stance) (s === "love" ? loved : avoided).push(name)
  return { loved, avoided, strong: [...strongNames], declared: [...declaredNames] }
}

/**
 * Inputs do preditor de Interesse (sinopse canônica + tags + digest de reviews)
 * de UMA obra, sob demanda. Chamado pelo `SynopsisInputsPopover` ao ABRIR (lazy),
 * tirando `getSynopsisInputsBatch` do caminho crítico do SSR das abas sinopse/
 * untracked — o popover só carrega quando o usuário realmente o abre.
 */
export async function getSynopsisInputsAction(workId: string): Promise<SynopsisInputs> {
  if (!workId) return { canonicalSynopsis: null, tags: [], reviewDigest: null }
  const map = await getSynopsisInputsBatch([workId])
  return map.get(workId) ?? { canonicalSynopsis: null, tags: [], reviewDigest: null }
}

/**
 * Contagem de vereditos IA desatualizados (mesma definição da fila ia-rk). Existe
 * como action pra o menu do /ranking se atualizar SEM reload — no mesmo tab via
 * event-bus e, no fluxo "abrir a fila em nova aba", ao voltar o foco pra cá.
 * Dado de catálogo (agregado, não per-usuário), sem sessão exigida.
 */
export async function getStaleAlignmentCountAction(): Promise<number> {
  return countStaleAlignmentWorks()
}

export async function generateTasteProfileAction(): Promise<{
  data?: TasteProfileRow
  error?: string
}> {
  try {
    const ratedWorks = await getRatedWorksForProfile()
    const inputHash = computeInputHash(ratedWorks)

    if (ratedWorks.length < MIN_WORKS_FOR_FULL_PROFILE) {
      const stub = buildStubProfile(ratedWorks.length)
      const saved = await insertNewTasteProfile({
        profile: stub,
        nWorks: ratedWorks.length,
        inputHash,
        isStub: true,
        modelName: MODEL,
        promptVersion: PROMPT_VERSION,
        rawResponse: null,
        ratedWorks,
      })
      return { data: saved }
    }

    // Leitor (ou quem estourou a cota do dia): perfil heurístico, zero LLM. Assinante+
    // dentro da cota: perfil LLM rico. Degradar é melhor que negar — o perfil heurístico
    // é um produto legítimo, não um erro.
    if (!(await ensureAiConsumption()).ok) {
      const profile = buildTasteProfileHeuristic(ratedWorks)
      const saved = await insertNewTasteProfile({
        profile,
        nWorks: ratedWorks.length,
        inputHash,
        isStub: false,
        modelName: "heuristic",
        promptVersion: "heuristic-v1",
        rawResponse: null,
        ratedWorks,
      })
      return { data: saved }
    }

    const result = await generateTasteProfile(ratedWorks)
    const saved = await insertNewTasteProfile({
      profile: result.profile,
      nWorks: ratedWorks.length,
      inputHash,
      isStub: false,
      modelName: result.modelName,
      promptVersion: result.promptVersion,
      rawResponse: result.rawResponse,
      ratedWorks,
    })
    return { data: saved }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export interface RunRecommendationArgs {
  mode: RecommendationMode
  userContext?: string | null
  /** Quantos candidatos rankear. Default 20, max 30. */
  n?: number
  /** Filtros aplicados na /ranking. Obrigatório quando mode = "ranking". */
  filters?: RankingFilters
}

export interface RunRecommendationResult {
  runId: string
  runSlug: string
  profile: TasteProfileRow
  modeSummary: string
  ranked: RankedCandidate[]
  candidatesEvaluated: number
  candidatesAvailable: number
  truncated: boolean
  modelName: string
  promptVersion: string
}

export async function runRecommendationAction(
  args: RunRecommendationArgs,
): Promise<{ data?: RunRecommendationResult; error?: string }> {
  try {
    // Gate: Smart Shortlist (re-rank por IA + mood) é exclusivo do Pago.
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }
    // Identidade de quem grava o Veredito IA — nunca a linha compartilhada pra não-dono.
    const identity = await ensureReadingStateWriter()
    if (!identity.ok) return { error: identity.error }

    const runsToday = await getRunsToday()
    if (runsToday >= MAX_RUNS_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_RUNS_PER_DAY} execuções atingido. Tente novamente amanhã.`,
      }
    }

    const n = Math.min(Math.max(args.n ?? 20, 1), MAX_CANDIDATES_HARD_LIMIT)

    const profileResult = await loadOrEnsureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile

    if (profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras com user_score pra desbloquear o ranking IA.",
      }
    }

    // Item B — regras/preferências livres (lidas ao vivo). Disparada aqui pra
    // sobrepor a latência ao fetch de candidatos; awaited antes do rankFavorites.
    const preferenceRulesPromise = getPreferenceRules()

    // Busca o universo completo primeiro (sem aplicar `n`) pra reportar
    // truncagem na UI; depois slice. Para ranking, getRanking sem topN
    // retorna a base inteira filtrada.
    let allCandidates: FavoriteCandidate[]
    if (args.mode === "ranking") {
      if (!args.filters) {
        return { error: "Filtros do ranking são obrigatórios pra rodar nesse modo." }
      }
      allCandidates = await getRankingCandidates(args.filters, 200)
    } else {
      allCandidates = await getFavoriteCandidates(args.mode, 200)
    }

    if (allCandidates.length === 0) {
      return {
        error:
          args.mode === "next_read"
            ? "Nenhum favorito sem user_score encontrado. Marque alguns títulos como favoritos ou desfaça suas notas pra ver opções aqui."
            : args.mode === "full_analysis"
              ? "Nenhum favorito encontrado. Marque títulos como favoritos pra rankeá-los."
              : "Nenhuma obra encontrada com os filtros aplicados no ranking.",
      }
    }

    const truncated = allCandidates.length > n
    const candidates = truncated ? allCandidates.slice(0, n) : allCandidates

    const result = await rankFavorites({
      profile: profile.profile,
      candidates,
      mode: args.mode,
      userContext: args.userContext ?? null,
      preferenceRules: await preferenceRulesPromise,
    })

    const byId = new Map<string, FavoriteCandidate>(candidates.map((c) => [c.id, c]))
    const ranked: RankedCandidate[] = []
    for (const r of result.rankings) {
      const work = byId.get(r.work_id)
      if (!work) continue
      ranked.push({
        work_id: r.work_id,
        alignment_score: r.alignment_score,
        justification: r.justification,
        top_match_factors: r.top_match_factors,
        confidence: r.confidence ?? null,
        risks: r.risks ?? undefined,
        similar_loved: r.similar_loved ?? undefined,
        similar_avoided: r.similar_avoided ?? undefined,
        review_quotes: r.review_quotes ?? undefined,
        mood_fit: r.mood_fit ?? null,
        work,
        coverUrls: work.coverUrls,
      })
    }

    const supabase = createAdminClient()
    const baseInsert = {
      mode: args.mode,
      taste_profile_id: profile.id,
      user_context: args.userContext?.trim() || null,
      n_candidates: candidates.length,
      n_available: allCandidates.length,
      source_meta: args.mode === "ranking" ? { filters: args.filters ?? null } : null,
      candidate_work_ids: candidates.map((c) => c.id),
      results: result.rankings,
      mode_summary: result.modeSummary,
      model_name: result.modelName,
      prompt_version: result.promptVersion,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      cache_read_tokens: result.usage.cacheReadTokens,
      cache_creation_tokens: result.usage.cacheCreationTokens,
      ai_api_call_id: result.apiCallId,
    }

    const runRow = await insertRecommendationRun(supabase, baseInsert)

    // Persiste alignment_score pra a coluna "Veredito IA." ficar disponível em
    // qualquer tabela (ranking, favoritos, títulos) — independente do modo da
    // run, já que sempre representa o re-rank mais recente da obra.
    // alignment_payload guarda os campos enriquecidos (sub-fase 2.3.A) — pode
    // ficar NULL se o modelo não preencheu nenhum opcional. Vai pra
    // `user_calculated_scores` de QUEM RODOU (ou também na linha compartilhada,
    // se for o dono) — nunca sobrescreve o Veredito de outra pessoa.
    if (runRow?.id) {
      const now = new Date().toISOString()
      const upsertRows = ranked.map((r) => {
        const payload = buildAlignmentPayload(r)
        return {
          work_id: r.work_id,
          alignment_score: r.alignment_score,
          alignment_run_id: runRow.id,
          alignment_justification: r.justification,
          alignment_payload: payload,
          alignment_at: now,
          alignment_stale: false, // recém-computado com bias/perfil atuais
        }
      })
      const persistResult = await persistAlignmentScores(identity.userId, identity.isOwner, upsertRows)
      if (persistResult.error) {
        console.error("[recommendations] falha persistindo alignment_score:", persistResult.error)
      }
      revalidatePath("/ranking")
      revalidatePath("/favorites")
      revalidatePath("/catalog")

      // P1: registra snapshots prospectivos (prediction_snapshots) das obras
      // recomendadas ainda SEM nota — agrupadas sob esta run (ranking_snapshot_id).
      // Best-effort: o recorder filtra só as prospectivas e nunca lança.
      await recordRecommendationSnapshots({
        rankingSnapshotId: runRow.id,
        workIds: ranked.map((r) => r.work_id),
        modelVersion: result.modelName,
        promptVersion: result.promptVersion,
      })
    }

    revalidatePath("/recommendations")
    if (runRow?.slug) revalidatePath(`/recommendations/${runRow.slug}`)

    return {
      data: {
        runId: runRow?.id ?? "unsaved",
        runSlug: runRow?.slug ?? "unsaved",
        profile,
        modeSummary: result.modeSummary,
        ranked,
        candidatesEvaluated: candidates.length,
        candidatesAvailable: allCandidates.length,
        truncated,
        modelName: result.modelName,
        promptVersion: result.promptVersion,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/**
 * Apaga uma execução do histórico.
 *
 * Gate de ADMIN, não de plano: `recommendation_runs` **não tem `user_id`** — o
 * histórico é COMPARTILHADO. Sem o gate, um usuário apagaria a execução de outro (e,
 * hoje, as do dono). Vira gate de plano/dono quando a Fase 2 particionar a tabela.
 */
export async function deleteRecommendationRunAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase.from("recommendation_runs").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/recommendations")
  return { ok: true }
}

export async function rerunRecommendationFromExistingAction(
  id: string,
): Promise<{ data?: RunRecommendationResult; error?: string }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("recommendation_runs")
    .select("mode, user_context")
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return { error: error?.message ?? "Run original não encontrada." }
  return runRecommendationAction({
    mode: data.mode as RecommendationMode,
    userContext: (data.user_context as string | null) ?? null,
  })
}

// (rerankTopNAction legacy removido — runRecommendationAction(mode: "ranking")
// cobre o mesmo caso de uso com prompt enriquecido + reviews + UI unificada.)

export interface RerankSingleWorkResult {
  alignmentScore: number
  justification: string
}

/**
 * Re-rank sob demanda de UMA obra específica. Disparado pelo botão "Rankear"
 * que substitui o "—" na cell Veredito IA quando `alignment_score` é NULL.
 *
 * Compartilha o limite diário com `runRecommendationAction` (cada chamada é 1
 * LLM call). Não cria registro em `recommendation_runs` — só faz o upsert em
 * `calculated_scores` (com `alignment_run_id = NULL`).
 */
export async function rerankSingleWorkAction(
  workId: string,
): Promise<{ data?: RerankSingleWorkResult; error?: string }> {
  try {
    // Gate: re-rank por IA é exclusivo do Pago.
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }
    const identity = await ensureReadingStateWriter()
    if (!identity.ok) return { error: identity.error }

    const runsToday = await getRunsToday()
    if (runsToday >= MAX_RUNS_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_RUNS_PER_DAY} execuções atingido. Tente novamente amanhã.`,
      }
    }

    const profileResult = await loadOrEnsureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile

    if (profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras com user_score pra desbloquear o ranking IA.",
      }
    }

    const [candidate, preferenceRules] = await Promise.all([
      getCandidateById(workId),
      getPreferenceRules(),
    ])
    if (!candidate) {
      return { error: "Obra não encontrada (ou arquivada)." }
    }

    const result = await rankFavorites({
      profile: profile.profile,
      candidates: [candidate],
      mode: "ranking",
      userContext: null,
      preferenceRules,
    })

    const ranking = result.rankings.find((r) => r.work_id === workId) ?? result.rankings[0]
    if (!ranking) {
      return { error: "O modelo não retornou ranking pra esta obra." }
    }

    const now = new Date().toISOString()
    const persistResult = await persistAlignmentScores(identity.userId, identity.isOwner, [
      {
        work_id: workId,
        alignment_score: ranking.alignment_score,
        alignment_run_id: null,
        alignment_justification: ranking.justification,
        alignment_payload: buildAlignmentPayload(ranking),
        alignment_at: now,
        alignment_stale: false, // recém-computado com bias/perfil atuais
      },
    ])
    if (persistResult.error) {
      return { error: persistResult.error }
    }

    revalidatePath("/favorites")
    revalidatePath("/ranking")

    return {
      data: {
        alignmentScore: ranking.alignment_score,
        justification: ranking.justification,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export interface RerankStaleBatchResult {
  /** Quantas obras foram re-rankeadas e tiveram a flag stale limpa. */
  ranked: number
  /** Total de obras desatualizadas disponíveis antes do corte por `n`. */
  available: number
  /** True quando havia mais stale do que o limite processado nesta run. */
  truncated: boolean
}

/**
 * Re-rankeia em LOTE as obras com Veredito IA desatualizado (alignment_stale=true).
 * Espelha o fluxo do re-rank por-obra, mas manda todos os candidatos numa única
 * chamada `rankFavorites` (como a run de ranking) e limpa a flag stale de cada
 * um. Não cria recommendation_run (alignment_run_id=null, como o re-rank
 * sob-demanda). Respeita o gate Pago e o limite diário de execuções.
 */
export async function rerankStaleBatchAction(
  n?: number,
): Promise<{ data?: RerankStaleBatchResult; error?: string }> {
  try {
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }
    const identity = await ensureReadingStateWriter()
    if (!identity.ok) return { error: identity.error }

    const runsToday = await getRunsToday()
    if (runsToday >= MAX_RUNS_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_RUNS_PER_DAY} execuções atingido. Tente novamente amanhã.`,
      }
    }

    const profileResult = await loadOrEnsureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile
    if (profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras com user_score pra desbloquear o ranking IA.",
      }
    }

    const limit = Math.min(Math.max(n ?? MAX_CANDIDATES_HARD_LIMIT, 1), MAX_CANDIDATES_HARD_LIMIT)
    const [allCandidates, preferenceRules] = await Promise.all([
      getStaleAlignmentCandidates(MAX_CANDIDATES_HARD_LIMIT),
      getPreferenceRules(),
    ])
    if (allCandidates.length === 0) {
      return { error: "Nenhuma obra com Veredito IA desatualizado." }
    }
    const truncated = allCandidates.length > limit
    const candidates = truncated ? allCandidates.slice(0, limit) : allCandidates

    const result = await rankFavorites({
      profile: profile.profile,
      candidates,
      mode: "ranking",
      userContext: null,
      preferenceRules,
    })

    const now = new Date().toISOString()
    const candidateIds = new Set(candidates.map((c) => c.id))
    const upsertRows = result.rankings
      .filter((r) => candidateIds.has(r.work_id))
      .map((r) => ({
        work_id: r.work_id,
        alignment_score: r.alignment_score,
        alignment_run_id: null,
        alignment_justification: r.justification,
        alignment_payload: buildAlignmentPayload(r),
        alignment_at: now,
        alignment_stale: false, // recém-computado com bias/perfil atuais
      }))

    const persistResult = await persistAlignmentScores(identity.userId, identity.isOwner, upsertRows)
    if (persistResult.error) {
      return { error: persistResult.error }
    }

    revalidatePath("/ranking")
    revalidatePath("/ranking/desatualizados")
    revalidatePath("/favorites")

    return {
      data: {
        ranked: upsertRows.length,
        available: allCandidates.length,
        truncated,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export interface RerankWorksBatchResult {
  /** Quantas obras receberam alignment_score nesta chamada. */
  ranked: number
  /** Quantas obras enviadas o modelo não retornou ranking. */
  failed: number
}

/**
 * Re-rankeia em LOTE uma lista EXPLÍCITA de obras — os IDs que o painel de Veredito IA
 * está exibindo na fila (desatualizados E/OU não avaliados), na ordem visível.
 * Espelha o `predictSynopsisQualityBatchAction`: o cliente chama em blocos pra
 * mostrar progresso, então lê o perfil ATUAL (1 linha) em vez de
 * `loadOrEnsureProfile` — recarregar o histórico a cada bloco seria desperdício.
 * Manda o bloco numa única chamada `rankFavorites` (o alignment_score é absoluto
 * por obra no mode "ranking", então fatiar não muda o resultado) e limpa a flag
 * stale. Não cria recommendation_run (alignment_run_id=null, como o re-rank
 * sob-demanda). Corta em `MAX_CANDIDATES_HARD_LIMIT` por chamada (trava de custo
 * — é o mesmo teto da run de ranking). Respeita o gate Pago e o limite diário.
 */
export async function rerankWorksBatchAction(
  workIds: string[],
): Promise<{ data?: RerankWorksBatchResult; error?: string }> {
  try {
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }
    const identity = await ensureReadingStateWriter()
    if (!identity.ok) return { error: identity.error }

    const runsToday = await getRunsToday()
    if (runsToday >= MAX_RUNS_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_RUNS_PER_DAY} execuções atingido. Tente novamente amanhã.`,
      }
    }

    const profile = await loadCurrentTasteProfile()
    if (!profile) {
      return { error: "Gere o perfil de gosto antes de re-rankear (em /recommendations)." }
    }
    if (profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras com user_score pra desbloquear o ranking IA.",
      }
    }

    const ids = Array.from(new Set(workIds ?? []))
      .filter(Boolean)
      .slice(0, MAX_CANDIDATES_HARD_LIMIT)
    if (ids.length === 0) {
      return { error: "Nenhuma obra para re-rankear." }
    }

    const [candidates, preferenceRules] = await Promise.all([
      getCandidatesByIds(ids),
      getPreferenceRules(),
    ])
    if (candidates.length === 0) {
      return { error: "Nenhuma obra elegível (arquivada ou inexistente)." }
    }

    const result = await rankFavorites({
      profile: profile.profile,
      candidates,
      mode: "ranking",
      userContext: null,
      preferenceRules,
    })

    const now = new Date().toISOString()
    const candidateIds = new Set(candidates.map((c) => c.id))
    const upsertRows = result.rankings
      .filter((r) => candidateIds.has(r.work_id))
      .map((r) => ({
        work_id: r.work_id,
        alignment_score: r.alignment_score,
        alignment_run_id: null,
        alignment_justification: r.justification,
        alignment_payload: buildAlignmentPayload(r),
        alignment_at: now,
        alignment_stale: false, // recém-computado com bias/perfil atuais
      }))

    const persistResult = await persistAlignmentScores(identity.userId, identity.isOwner, upsertRows)
    if (persistResult.error) {
      return { error: persistResult.error }
    }

    revalidatePath("/ranking")
    revalidatePath("/ranking/desatualizados")
    revalidatePath("/favorites")
    revalidatePath("/my-ai-scores")
    revalidateTag("ai-eval-tab-counts", "max")

    return {
      data: {
        ranked: upsertRows.length,
        failed: candidates.length - upsertRows.length,
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export interface RerankClusterResult {
  /** Quantas obras do cluster receberam alignment_score nesta run. */
  ranked: number
  /** Quantas obras válidas foram efetivamente enviadas ao modelo. */
  requested: number
  /** Ranking do cluster (desc por alignment_score) — pro caller montar o veredito. */
  rankings: Array<{ workId: string; alignmentScore: number; justification: string }>
  /** Slug da run salva, quando `persist` foi pedido e a gravação deu certo. */
  savedSlug?: string
}

/**
 * Desempate sob demanda de um CLUSTER de obras tecnicamente empatadas na Nota de
 * Decisão. Envia todas numa ÚNICA chamada `rankFavorites` (mode "ranking") pra o
 * modelo compará-las cabeça-a-cabeça — é o que dá o veredito decisivo — e
 * persiste o alignment_score de cada uma. Respeita o gate Pago e o limite diário
 * (1 LLM call por clique).
 *
 * Por padrão NÃO cria `recommendation_run` (efêmero: alignment_run_id=null). Com
 * `opts.persist`, salva uma run navegável (mode "ranking", source_meta.tiebreak)
 * — reusa o `mode_summary` que o modelo já gera — e linka o alignment a ela.
 */
export async function rerankClusterAction(
  workIds: string[],
  opts: { persist?: boolean } = {},
): Promise<{ data?: RerankClusterResult; error?: string }> {
  try {
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }
    const identity = await ensureReadingStateWriter()
    if (!identity.ok) return { error: identity.error }

    const ids = Array.from(new Set(workIds)).filter(Boolean)
    if (ids.length < 2) {
      return { error: "Desempate por IA precisa de pelo menos 2 obras." }
    }
    const limited = ids.slice(0, MAX_CANDIDATES_HARD_LIMIT)

    const runsToday = await getRunsToday()
    if (runsToday >= MAX_RUNS_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_RUNS_PER_DAY} execuções atingido. Tente novamente amanhã.`,
      }
    }

    const profileResult = await loadOrEnsureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile
    if (profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras com user_score pra desbloquear o ranking IA.",
      }
    }

    const [candidatesRaw, preferenceRules] = await Promise.all([
      Promise.all(limited.map((id) => getCandidateById(id))),
      getPreferenceRules(),
    ])
    const candidates = candidatesRaw.filter((c): c is NonNullable<typeof c> => c != null)
    if (candidates.length < 2) {
      return { error: "Obras do cluster não encontradas (ou arquivadas)." }
    }

    const result = await rankFavorites({
      profile: profile.profile,
      candidates,
      mode: "ranking",
      userContext: null,
      preferenceRules,
    })

    const supabase = createAdminClient()
    const now = new Date().toISOString()
    const candidateIds = new Set(candidates.map((c) => c.id))

    // Persistência opcional: cria uma run navegável (histórico/URL) e linka o
    // alignment a ela. Sem persist, o alignment fica solto (run_id=null).
    let savedSlug: string | undefined
    let alignmentRunId: string | null = null
    if (opts.persist) {
      const clusterIds = candidates.map((c) => c.id)
      const runRow = await insertRecommendationRun(supabase, {
        mode: "ranking",
        taste_profile_id: profile.id,
        user_context: null,
        n_candidates: candidates.length,
        n_available: candidates.length,
        source_meta: { tiebreak: true, work_ids: clusterIds },
        candidate_work_ids: clusterIds,
        results: result.rankings,
        mode_summary: result.modeSummary,
        model_name: result.modelName,
        prompt_version: result.promptVersion,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
        cache_creation_tokens: result.usage.cacheCreationTokens,
        ai_api_call_id: result.apiCallId,
      })
      if (runRow) {
        savedSlug = runRow.slug
        alignmentRunId = runRow.id
      }
    }

    const upsertRows = result.rankings
      .filter((r) => candidateIds.has(r.work_id))
      .map((r) => ({
        work_id: r.work_id,
        alignment_score: r.alignment_score,
        alignment_run_id: alignmentRunId,
        alignment_justification: r.justification,
        alignment_payload: buildAlignmentPayload(r),
        alignment_at: now,
        alignment_stale: false, // recém-computado com bias/perfil atuais
      }))

    const persistResult = await persistAlignmentScores(identity.userId, identity.isOwner, upsertRows)
    if (persistResult.error) {
      return { error: persistResult.error }
    }

    revalidatePath("/ranking")
    revalidatePath("/favorites")
    if (savedSlug) {
      revalidatePath("/recommendations")
      revalidatePath(`/recommendations/${savedSlug}`)
    }

    const rankings = result.rankings
      .filter((r) => candidateIds.has(r.work_id))
      .map((r) => ({
        workId: r.work_id,
        alignmentScore: r.alignment_score,
        justification: r.justification,
      }))
      .sort((a, b) => b.alignmentScore - a.alignmentScore)

    return { data: { ranked: upsertRows.length, requested: candidates.length, rankings, savedSlug } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export interface RankSpecificWorksResult {
  items: ChatRecommendationItem[]
  modeSummary: string
}

/**
 * Rankeia um conjunto ESPECÍFICO de obras (por work_id) — usado pelo chat pra
 * "avaliar 1 obra (fit)" e "recomendar entre estas obras". Espelha o
 * `rerankClusterAction`: roda `rankFavorites` (mode "ranking") numa única
 * chamada e PERSISTE o alignment_score em `calculated_scores` (Veredito IA fica
 * visível em /ranking, /favorites, /catalog). Não cria `recommendation_runs` —
 * é ação pontual, como os botões de re-rank. Devolve itens prontos pro card do
 * chat (título, capa, score, justificativa), ordenados por Veredito IA desc.
 */
export async function rankSpecificWorksForChat(args: {
  workIds: string[]
  userContext?: string | null
}): Promise<{ data?: RankSpecificWorksResult; error?: string }> {
  try {
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }
    const identity = await ensureReadingStateWriter()
    if (!identity.ok) return { error: identity.error }

    const ids = Array.from(new Set(args.workIds)).filter(Boolean)
    if (ids.length === 0) return { error: "Nenhuma obra indicada." }
    const limited = ids.slice(0, MAX_CANDIDATES_HARD_LIMIT)

    const runsToday = await getRunsToday()
    if (runsToday >= MAX_RUNS_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_RUNS_PER_DAY} execuções atingido. Tente novamente amanhã.`,
      }
    }

    const profileResult = await loadOrEnsureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile
    if (profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras com user_score pra desbloquear o ranking IA.",
      }
    }

    const [candidatesRaw, preferenceRules] = await Promise.all([
      Promise.all(limited.map((id) => getCandidateById(id))),
      getPreferenceRules(),
    ])
    const candidates = candidatesRaw.filter((c): c is NonNullable<typeof c> => c != null)
    if (candidates.length === 0) {
      return { error: "Obras não encontradas (ou arquivadas)." }
    }

    const result = await rankFavorites({
      profile: profile.profile,
      candidates,
      mode: "ranking",
      userContext: args.userContext ?? null,
      preferenceRules,
    })

    const byId = new Map<string, FavoriteCandidate>(candidates.map((c) => [c.id, c]))
    const now = new Date().toISOString()
    const candidateIds = new Set(candidates.map((c) => c.id))

    const upsertRows = result.rankings
      .filter((r) => candidateIds.has(r.work_id))
      .map((r) => ({
        work_id: r.work_id,
        alignment_score: r.alignment_score,
        alignment_run_id: null,
        alignment_justification: r.justification,
        alignment_payload: buildAlignmentPayload(r),
        alignment_at: now,
        alignment_stale: false,
      }))

    if (upsertRows.length > 0) {
      const persistResult = await persistAlignmentScores(identity.userId, identity.isOwner, upsertRows)
      if (persistResult.error) {
        return { error: persistResult.error }
      }
      revalidatePath("/ranking")
      revalidatePath("/favorites")
      revalidatePath("/catalog")
    }

    const items: ChatRecommendationItem[] = result.rankings
      .filter((r) => candidateIds.has(r.work_id))
      .sort((a, b) => b.alignment_score - a.alignment_score)
      .map((r) => {
        const work = byId.get(r.work_id)
        return {
          work_id: r.work_id,
          title: work?.title ?? "(sem título)",
          coverUrls: work?.coverUrls ?? [],
          alignment_score: r.alignment_score,
          justification: r.justification,
          top_match_factors: r.top_match_factors,
        }
      })

    return { data: { items, modeSummary: result.modeSummary } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// "Mais como estas" (/discover) — explicar sob demanda, aplicar sob confirmação
//
// 🔴 A separação entre EXPLICAR e APLICAR é o desenho, não um passo a mais por precaução.
//
// O ranking de `/discover` é aritmética (percentis de parecença × alinhamento) e não custa
// nada. Só a PROSA custa — e ela é escrita sob o contexto daquelas sementes, então não é a
// mesma coisa que o Veredito IA que o /ranking mostra. Gravá-la direto em
// `calculated_scores.alignment_*` publicaria em todas as telas um julgamento feito para uma
// exploração descartável.
//
// ⚠️ Por isso NÃO dá para reusar `rerankClusterAction`: ele chama `persistAlignmentScores`
// incondicionalmente (o `persist` de lá controla só o histórico). Aqui a gravação nos scores
// é o passo que a pessoa confirma.
//
// 🔴 O que SEMPRE é gravado é a `recommendation_runs` — a chamada foi paga, e descartá-la
// porque ninguém clicou em "aplicar" queimaria ~5¢ sem deixar rastro. É dela que o
// `applySeedVerdictAction` relê o resultado.
//
// 🔴 E é por isso que o "aplicar" recebe um runId, NUNCA as notas: `"use server"` é endpoint
// HTTP público ([[project_use_server_public_endpoints]]). Aceitar `alignment_score` do
// cliente deixaria qualquer um gravar o número que quisesse no Veredito de qualquer obra.
// ═══════════════════════════════════════════════════════════════════════════════════════

export interface ExplainSeedsResult {
  runId: string
  slug: string
  rankings: Array<{ workId: string; alignmentScore: number; justification: string }>
  modeSummary: string
}

/**
 * Roda o consultor sobre as obras que `/discover` encontrou, no contexto das sementes.
 *
 * Cria a run (mode `seeds`) e devolve o resultado — sem tocar em `calculated_scores`.
 */
export async function explainSeedResultsAction(args: {
  seedIds: string[]
  antiIds?: string[]
  workIds: string[]
  weight?: number
}): Promise<{ data?: ExplainSeedsResult; error?: string }> {
  try {
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }
    const identity = await ensureReadingStateWriter()
    if (!identity.ok) return { error: identity.error }

    const seedIds = Array.from(new Set(args.seedIds)).filter(Boolean)
    if (seedIds.length < 2) return { error: "Escolha pelo menos duas obras-semente." }

    const workIds = Array.from(new Set(args.workIds)).filter(Boolean)
    if (workIds.length === 0) return { error: "Nenhuma obra para explicar." }
    const limited = workIds.slice(0, MAX_CANDIDATES_HARD_LIMIT)

    const runsToday = await getRunsToday()
    if (runsToday >= MAX_RUNS_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_RUNS_PER_DAY} execuções atingido. Tente novamente amanhã.`,
      }
    }

    const profileResult = await loadOrEnsureProfile()
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile
    if (profile.is_stub) {
      return {
        error: "Perfil ainda em modo stub — avalie mais obras pra desbloquear a explicação por IA.",
      }
    }

    const supabase = createAdminClient()
    const antiIds = Array.from(new Set(args.antiIds ?? [])).filter(Boolean)

    const [candidates, preferenceRules, seedTitles] = await Promise.all([
      getCandidatesByIds(limited),
      getPreferenceRules(),
      loadWorkTitles(supabase, [...seedIds, ...antiIds]),
    ])
    if (candidates.length === 0) {
      return { error: "As obras encontradas não estão mais disponíveis." }
    }

    // O modelo precisa saber DE ONDE a lista veio — senão escreve como se fosse uma
    // recomendação genérica e a justificativa não menciona o que a pessoa pediu.
    const nomes = (ids: string[]) =>
      ids.map((id) => seedTitles.get(id)).filter(Boolean).join(", ")
    const contextoSementes = [
      `Esta lista veio de uma busca por semelhança com estas obras: ${nomes(seedIds)}.`,
      antiIds.length > 0 ? `A pessoa pediu para EVITAR o que lembra: ${nomes(antiIds)}.` : "",
      "Ao justificar, diga o que cada obra tem em comum com as obras-semente (ou onde se afasta delas), além do encaixe com o perfil.",
    ]
      .filter(Boolean)
      .join(" ")

    const result = await rankFavorites({
      profile: profile.profile,
      candidates,
      mode: "ranking",
      userContext: contextoSementes,
      preferenceRules,
    })

    const runRow = await insertRecommendationRun(supabase, {
      mode: "seeds",
      taste_profile_id: profile.id,
      user_context: contextoSementes,
      n_candidates: candidates.length,
      n_available: workIds.length,
      // A procedência da justificativa: sem isto não dá para responder depois "de que
      // sementes saiu este Veredito?", e é justamente isso que o diferencia do /ranking.
      source_meta: {
        seeds: true,
        seed_ids: seedIds,
        anti_ids: antiIds,
        weight: args.weight ?? null,
      },
      candidate_work_ids: candidates.map((c) => c.id),
      results: result.rankings,
      mode_summary: result.modeSummary,
      model_name: result.modelName,
      prompt_version: result.promptVersion,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      cache_read_tokens: result.usage.cacheReadTokens,
      cache_creation_tokens: result.usage.cacheCreationTokens,
      ai_api_call_id: result.apiCallId,
    })

    if (!runRow) {
      return { error: "A explicação foi gerada, mas não foi possível salvá-la. Tente de novo." }
    }

    const candidateIds = new Set(candidates.map((c) => c.id))
    const rankings = result.rankings
      .filter((r) => candidateIds.has(r.work_id))
      .map((r) => ({
        workId: r.work_id,
        alignmentScore: r.alignment_score,
        justification: r.justification,
      }))
      .sort((a, b) => b.alignmentScore - a.alignmentScore)

    revalidatePath("/recommendations")

    return {
      data: { runId: runRow.id, slug: runRow.slug, rankings, modeSummary: result.modeSummary },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/**
 * Aplica ao catálogo o Veredito de uma run de sementes já paga.
 *
 * Não chama modelo nenhum: relê a run do banco e copia para `calculated_scores`.
 */
export async function applySeedVerdictAction(
  runId: string,
): Promise<{ data?: { applied: number }; error?: string }> {
  try {
    // Sem `ensureAiConsumption`: isto não gasta token. O gate aqui é IDENTIDADE — quem
    // escreve tem que ser dono do que escreve.
    const identity = await ensureReadingStateWriter()
    if (!identity.ok) return { error: identity.error }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("recommendation_runs")
      .select("id, user_id, mode, results")
      .eq("id", runId)
      .maybeSingle()

    if (error) return { error: `Não foi possível ler a explicação: ${error.message}` }
    if (!data) return { error: "Explicação não encontrada." }

    const row = data as { id: string; user_id: string | null; mode: string; results: RankedWork[] }

    // 🔴 A run tem dono, e aplicar a de outra pessoa gravaria o Veredito dela no catálogo
    // desta. `user_id` nulo é run pré-migration 141 e não tem dono comprovável — recusa.
    if (row.user_id !== identity.userId) {
      return { error: "Explicação não encontrada." }
    }
    if (row.mode !== "seeds") {
      return { error: "Esta explicação não é de uma busca por sementes." }
    }

    const now = new Date().toISOString()
    const rows = (row.results ?? [])
      .filter((r) => r?.work_id && typeof r.alignment_score === "number")
      .map((r) => ({
        work_id: r.work_id,
        alignment_score: r.alignment_score,
        alignment_run_id: row.id,
        alignment_justification: r.justification,
        alignment_payload: buildAlignmentPayload(r),
        alignment_at: now,
        alignment_stale: false,
      }))

    if (rows.length === 0) return { error: "A explicação não trouxe nenhuma nota para aplicar." }

    const persistResult = await persistAlignmentScores(identity.userId, identity.isOwner, rows)
    if (persistResult.error) return { error: persistResult.error }

    revalidatePath("/ranking")
    revalidatePath("/favorites")
    revalidatePath("/discover")

    return { data: { applied: rows.length } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

/** Títulos por id — para montar o contexto das sementes no prompt. */
async function loadWorkTitles(
  supabase: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from("works").select("id, title").in("id", ids)
  return new Map(((data ?? []) as Array<{ id: string; title: string }>).map((w) => [w.id, w.title]))
}
