"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureCapability } from "@/server/queries/current-user"
import { loadOrEnsureProfile } from "@/lib/ai-recommendation/ensure-profile"
import {
  runChatTurn,
  CHAT_MODEL,
  CHAT_PROMPT_VERSION,
  type ChatToolMode,
} from "@/lib/ai-recommendation/chat-service"
import {
  runRecommendationAction,
  rankSpecificWorksForChat,
  type RunRecommendationResult,
} from "@/server/actions/recommendations"
import { triggerAiEvaluation } from "@/server/actions/ai"
import { resolveWorksByTitles } from "@/server/queries/works"
import { parseFiltersFromSearchParams } from "@/lib/ranking-filters-from-params"
import type { AiEvaluation } from "@/types/domain"
import type {
  ChatEvaluationSnapshot,
  ChatMessage,
  ChatRecommendationItem,
  ChatRecommendationSnapshot,
  ChatRow,
} from "@/lib/ai-recommendation/types"

const MAX_CHAT_MESSAGES_PER_DAY = 60

// Trava de interatividade: o motor de recomendação não dispara enquanto o
// usuário não tiver respondido pelo menos esse tanto de mensagens — garante ao
// menos uma rodada de pergunta/resposta antes da primeira lista (salvo se o
// usuário forçar pelo botão "Pode recomendar agora"). O prompt já induz mais
// trocas; isto é só o piso que blinda contra o modelo "pular" o briefing.
const MIN_USER_MESSAGES_BEFORE_RECOMMEND = 2

// Universo de descoberta do chat = mesmo default do "Recomendar do ranking"
// (status pessoal "Want to Read" + publicação "Completed"). Mantém consistência com
// o botão existente; a nuance de mood vai no userContext derivado da conversa.
function defaultChatFilters() {
  return parseFiltersFromSearchParams(new URLSearchParams())
}

async function getChatMessagesToday(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from("ai_api_calls")
    .select("id", { count: "exact", head: true })
    .eq("operation", "recommendation_chat")
    .gte("created_at", since)
  return count ?? 0
}

async function generateChatSlug(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from("recommendation_chats")
    .select("slug")
    .like("slug", `${today}-%`)
  const maxN = (data ?? []).reduce((max, row) => {
    const slug = (row.slug as string | null) ?? ""
    const n = parseInt(slug.slice(today.length + 1), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `${today}-${maxN + 1}`
}

function deriveTitle(userText: string): string {
  const oneLine = userText.replace(/\s+/g, " ").trim()
  return oneLine.length > 70 ? `${oneLine.slice(0, 69).trimEnd()}…` : oneLine
}

function buildSnapshot(
  data: RunRecommendationResult,
  userContext: string,
): ChatRecommendationSnapshot {
  return {
    runSlug: data.runSlug,
    runId: data.runId,
    modeSummary: data.modeSummary,
    userContext,
    candidatesEvaluated: data.candidatesEvaluated,
    truncated: data.truncated,
    items: data.ranked.map((r) => ({
      work_id: r.work_id,
      title: r.work.title,
      coverUrl: r.coverUrl,
      alignment_score: r.alignment_score,
      justification: r.justification,
      top_match_factors: r.top_match_factors,
    })),
  }
}

/** Monta um snapshot de recomendação a partir de itens já rankeados (sem
 * recommendation_run associada — caso do fit/recommend_among do chat). */
function snapshotFromItems(
  items: ChatRecommendationItem[],
  modeSummary: string,
  userContext: string | null,
): ChatRecommendationSnapshot {
  return {
    runSlug: "unsaved",
    runId: "unsaved",
    modeSummary,
    userContext,
    candidatesEvaluated: items.length,
    truncated: false,
    items,
  }
}

function buildEvaluationSnapshot(
  evaluation: AiEvaluation,
  title: string,
): ChatEvaluationSnapshot {
  const scores = (evaluation.ai_evaluation_scores ?? []).map((s) => ({
    criterionSlug: s.criterion_slug,
    score: s.suggested_score,
    justification: s.justification,
  }))
  return {
    workId: evaluation.work_id,
    title,
    coverUrl: null,
    scores,
    summary: evaluation.summary,
    confidence: evaluation.confidence,
    reviewHref: "/ai-evaluation",
  }
}

/** Extrai o bloco "[[sugestoes: a | b | c]]" que o modelo anexa às perguntas,
 * removendo-o do texto exibido e devolvendo as opções. */
function extractSuggestions(text: string): { content: string; suggestions?: string[] } {
  const match = text.match(/\[\[\s*sugest(?:o|õ)es\s*:([\s\S]+?)\]\]/i)
  if (!match) return { content: text }
  const suggestions = match[1]
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4)
  const content = text.replace(match[0], "").trim()
  return { content, suggestions: suggestions.length > 0 ? suggestions : undefined }
}

type ResolveTitlesResult =
  | { ok: true; works: Array<{ id: string; title: string }>; note: string | null }
  | { ok: false; message: string }

/** Resolve títulos digitados → obras do catálogo e formata uma mensagem de
 * esclarecimento quando há ambiguidade ou faltam matches suficientes. */
async function resolveTitlesForChat(
  titles: string[],
  minNeeded: number,
): Promise<ResolveTitlesResult> {
  const res = await resolveWorksByTitles(titles)
  const matched = res.flatMap((r) => (r.status === "matched" ? [r.work] : []))
  const ambiguous = res.flatMap((r) =>
    r.status === "ambiguous" ? [{ query: r.query, options: r.options }] : [],
  )
  const notFound = res.flatMap((r) => (r.status === "not_found" ? [r.query] : []))

  if (ambiguous.length > 0) {
    const lines = ambiguous
      .map((a) => `• “${a.query}” pode ser: ${a.options.map((o) => o.title).join(" · ")}`)
      .join("\n")
    return {
      ok: false,
      message: `Achei mais de uma opção pra alguns títulos — qual você quer?\n${lines}`,
    }
  }

  if (matched.length < minNeeded) {
    const miss = notFound.map((q) => `“${q}”`).join(", ")
    return {
      ok: false,
      message:
        minNeeded <= 1
          ? `Não achei ${miss || "essa obra"} no seu catálogo. Confere o nome?`
          : `Preciso de pelo menos ${minNeeded} obras que existam no seu catálogo${miss ? ` — não achei: ${miss}` : ""}.`,
    }
  }

  const note =
    notFound.length > 0
      ? `(não achei no catálogo: ${notFound.map((q) => `“${q}”`).join(", ")})`
      : null
  return { ok: true, works: matched, note }
}

function rowToChat(row: Record<string, unknown>): ChatRow {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: (row.title as string | null) ?? null,
    messages: (row.messages as ChatMessage[] | null) ?? [],
    taste_profile_id: (row.taste_profile_id as string | null) ?? null,
    model_name: row.model_name as string,
    prompt_version: row.prompt_version as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

async function loadChatBySlug(
  supabase: ReturnType<typeof createAdminClient>,
  slug: string,
): Promise<ChatRow | null> {
  const { data } = await supabase
    .from("recommendation_chats")
    .select("*")
    .eq("slug", slug)
    .maybeSingle()
  return data ? rowToChat(data as Record<string, unknown>) : null
}

export interface SendChatMessageArgs {
  /** Slug da conversa existente, ou null/undefined pra iniciar uma nova. */
  slug?: string | null
  userText?: string
  /**
   * Botão "Pode recomendar agora": pula o briefing e força a recomendação com
   * o que já foi conversado. Não exige novo texto do usuário.
   */
  forceRecommend?: boolean
}

export interface SendChatMessageResult {
  slug: string
  assistantMessage: ChatMessage
}

export async function sendChatMessageAction(
  args: SendChatMessageArgs,
): Promise<{ data?: SendChatMessageResult; error?: string }> {
  try {
    const gate = await ensureCapability("chat_recommend")
    if (!gate.ok) return { error: gate.error }

    const forceRecommend = args.forceRecommend === true
    const userText = args.userText?.trim() ?? ""
    if (!userText && !forceRecommend) return { error: "Mensagem vazia." }

    const supabase = createAdminClient()

    const msgsToday = await getChatMessagesToday(supabase)
    if (msgsToday >= MAX_CHAT_MESSAGES_PER_DAY) {
      return {
        error: `Limite diário de ${MAX_CHAT_MESSAGES_PER_DAY} mensagens de chat atingido. Tente novamente amanhã.`,
      }
    }

    // refreshIfStale: o chat regenera o perfil quando você avaliou obras novas
    // desde a última geração (input_hash mudou) ou pra promover um stub a perfil
    // completo. Auto-limitante: roda uma vez por lote de novas avaliações.
    const profileResult = await loadOrEnsureProfile({ refreshIfStale: true })
    if ("error" in profileResult) return { error: profileResult.error }
    const profile = profileResult.profile

    const existing = args.slug ? await loadChatBySlug(supabase, args.slug) : null
    const priorMessages = existing?.messages ?? []

    // Force-recommend sem texto novo precisa de conversa prévia pra resumir.
    if (forceRecommend && !userText && priorMessages.length === 0) {
      return { error: "Conte um pouco do que você quer antes de eu recomendar." }
    }

    const now = new Date().toISOString()
    const history: ChatMessage[] = [...priorMessages]
    if (userText) {
      history.push({ role: "user", content: userText, created_at: now })
    }

    // Quantas mensagens o usuário já mandou (contando a atual).
    const userMessageCount = history.filter((m) => m.role === "user").length
    // Trava: força só conversa enquanto não houver briefing mínimo, a menos que
    // o usuário tenha pedido explicitamente pra recomendar agora (botão).
    const toolMode: ChatToolMode = forceRecommend
      ? "force"
      : userMessageCount < MIN_USER_MESSAGES_BEFORE_RECOMMEND
        ? "block"
        : "auto"

    const turn = await runChatTurn({ profile: profile.profile, messages: history, toolMode })

    let assistantContent = turn.assistantText
    let recommendation: ChatRecommendationSnapshot | undefined
    let evaluation: ChatEvaluationSnapshot | undefined

    const appendNote = (note: string) => {
      assistantContent = assistantContent ? `${assistantContent}\n\n${note}` : note
    }

    const call = turn.toolCall

    if (call?.tool === "recommend_works") {
      const run = await runRecommendationAction({
        mode: "ranking",
        userContext: call.userContext,
        n: call.n,
        filters: defaultChatFilters(),
      })
      if (run.error) {
        appendNote(`(Não consegui rodar a recomendação agora: ${run.error})`)
      } else if (run.data) {
        recommendation = buildSnapshot(run.data, call.userContext)
        if (!assistantContent) {
          assistantContent = run.data.modeSummary
            ? `Garimpei estas pra você: ${run.data.modeSummary}`
            : "Garimpei estas obras pra você 👇"
        }
      }
    } else if (call?.tool === "recommend_among") {
      const resolved = await resolveTitlesForChat(call.titles, 2)
      if (!resolved.ok) {
        assistantContent = assistantContent
          ? `${assistantContent}\n\n${resolved.message}`
          : resolved.message
      } else {
        const res = await rankSpecificWorksForChat({
          workIds: resolved.works.map((w) => w.id),
          userContext: call.userContext,
        })
        if (res.error) {
          appendNote(`(Não consegui comparar agora: ${res.error})`)
        } else if (res.data) {
          recommendation = snapshotFromItems(res.data.items, res.data.modeSummary, call.userContext)
          if (!assistantContent) {
            assistantContent = res.data.modeSummary
              ? `Comparei as obras: ${res.data.modeSummary}`
              : "Comparei as obras que você indicou 👇"
          }
          if (resolved.note) appendNote(resolved.note)
        }
      }
    } else if (call?.tool === "evaluate_work" && call.kind === "fit") {
      const resolved = await resolveTitlesForChat([call.title], 1)
      if (!resolved.ok) {
        assistantContent = assistantContent
          ? `${assistantContent}\n\n${resolved.message}`
          : resolved.message
      } else {
        const res = await rankSpecificWorksForChat({
          workIds: resolved.works.map((w) => w.id),
          userContext: null,
        })
        if (res.error) {
          appendNote(`(Não consegui avaliar o fit agora: ${res.error})`)
        } else if (res.data) {
          recommendation = snapshotFromItems(res.data.items, res.data.modeSummary, null)
          if (!assistantContent) assistantContent = "Avaliei o quanto combina com seu gosto 👇"
        }
      }
    } else if (call?.tool === "evaluate_work" && call.kind === "full") {
      const resolved = await resolveTitlesForChat([call.title], 1)
      if (!resolved.ok) {
        assistantContent = assistantContent
          ? `${assistantContent}\n\n${resolved.message}`
          : resolved.message
      } else {
        const work = resolved.works[0]
        const ev = await triggerAiEvaluation(work.id, {
          proceedWithoutReviews: call.evenWithoutReviews === true,
        })
        if ("error" in ev && ev.error) {
          appendNote(`(Não consegui avaliar agora: ${ev.error})`)
        } else if ("needsReviewConfirmation" in ev && ev.needsReviewConfirmation) {
          const msg = `Não achei reviews externas confiáveis pra "${ev.workTitle}", então a avaliação completa vai se basear só na sinopse/tags (menos precisa). Quer que eu avalie mesmo assim?`
          assistantContent = assistantContent ? `${assistantContent}\n\n${msg}` : msg
        } else if ("data" in ev && ev.data) {
          evaluation = buildEvaluationSnapshot(ev.data.evaluation, work.title)
          if (!assistantContent) {
            assistantContent = `Avaliei "${work.title}" nos 9 critérios 👇 (são sugestões — revise e salve quando quiser)`
          }
        }
      }
    }

    if (!assistantContent) {
      assistantContent =
        "Me conta um pouco mais do que você tá a fim agora — tom (leve/denso), gênero, tamanho, ou algo pra evitar?"
    }

    // Transparência: o perfil foi atualizado com avaliações recentes neste turno.
    if (profileResult.staleRefresh) {
      assistantContent = `🔄 Atualizei seu perfil de gosto com suas avaliações recentes.\n\n${assistantContent}`
    }

    // Extrai as sugestões de resposta (só fazem sentido em perguntas; quando há
    // recommendation/evaluation o modelo não deve emitir o bloco, mas removemos
    // por segurança de qualquer forma).
    const { content: cleanContent, suggestions } = extractSuggestions(assistantContent)
    assistantContent = cleanContent

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantContent,
      recommendation,
      evaluation,
      suggestions: recommendation || evaluation ? undefined : suggestions,
      created_at: new Date().toISOString(),
    }

    const newMessages: ChatMessage[] = [...history, assistantMessage]

    let slug = existing?.slug ?? null
    if (existing) {
      const { error } = await supabase
        .from("recommendation_chats")
        .update({ messages: newMessages, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
      if (error) console.error("[recommendation-chat] falha atualizando conversa:", error)
    } else {
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidateSlug = await generateChatSlug(supabase)
        const { data, error } = await supabase
          .from("recommendation_chats")
          .insert({
            slug: candidateSlug,
            title: deriveTitle(userText),
            messages: newMessages,
            taste_profile_id: profile.id,
            model_name: CHAT_MODEL,
            prompt_version: CHAT_PROMPT_VERSION,
          })
          .select("slug")
          .single()
        if (!error && data) {
          slug = data.slug as string
          break
        }
        if (error?.code !== "23505") {
          console.error("[recommendation-chat] falha criando conversa:", error)
          break
        }
      }
    }

    if (!slug) {
      // Persistência falhou, mas a resposta do modelo é válida — devolve mesmo
      // assim com um slug efêmero pra UI não travar (não recarregável).
      slug = "unsaved"
    }

    if (slug !== "unsaved") {
      revalidatePath("/recommendations/chat")
      revalidatePath(`/recommendations/chat/${slug}`)
    }

    return { data: { slug, assistantMessage } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" }
  }
}

export async function getChatAction(slug: string): Promise<ChatRow | null> {
  const supabase = createAdminClient()
  return loadChatBySlug(supabase, slug)
}

export interface ChatSummary {
  slug: string
  title: string | null
  updatedAt: string
  messageCount: number
}

export async function listChatsAction(limit = 20): Promise<ChatSummary[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("recommendation_chats")
    .select("slug, title, updated_at, messages")
    .order("updated_at", { ascending: false })
    .limit(limit)
  return (data ?? []).map((row) => ({
    slug: row.slug as string,
    title: (row.title as string | null) ?? null,
    updatedAt: row.updated_at as string,
    messageCount: Array.isArray(row.messages) ? (row.messages as unknown[]).length : 0,
  }))
}
