"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureCapability } from "@/server/queries/current-user"
import { loadOrEnsureProfile } from "@/lib/ai-recommendation/ensure-profile"
import { runChatTurn, CHAT_MODEL, CHAT_PROMPT_VERSION } from "@/lib/ai-recommendation/chat-service"
import { runRecommendationAction, type RunRecommendationResult } from "@/server/actions/recommendations"
import { parseFiltersFromSearchParams } from "@/lib/ranking-filters-from-params"
import type {
  ChatMessage,
  ChatRecommendationSnapshot,
  ChatRow,
} from "@/lib/ai-recommendation/types"

const MAX_CHAT_MESSAGES_PER_DAY = 60

// Universo de descoberta do chat = mesmo default do "Recomendar do ranking"
// (status pessoal "To read" + publicação "Completed"). Mantém consistência com
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
  userText: string
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

    const userText = args.userText?.trim()
    if (!userText) return { error: "Mensagem vazia." }

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
    const now = new Date().toISOString()
    const userMessage: ChatMessage = { role: "user", content: userText, created_at: now }
    const history: ChatMessage[] = [...(existing?.messages ?? []), userMessage]

    const turn = await runChatTurn({ profile: profile.profile, messages: history })

    let assistantContent = turn.assistantText
    let recommendation: ChatRecommendationSnapshot | undefined

    if (turn.toolCall) {
      const run = await runRecommendationAction({
        mode: "ranking",
        userContext: turn.toolCall.userContext,
        n: turn.toolCall.n,
        filters: defaultChatFilters(),
      })
      if (run.error) {
        const note = `(Não consegui rodar a recomendação agora: ${run.error})`
        assistantContent = assistantContent ? `${assistantContent}\n\n${note}` : note
      } else if (run.data) {
        recommendation = buildSnapshot(run.data, turn.toolCall.userContext)
        if (!assistantContent) {
          assistantContent = run.data.modeSummary
            ? `Garimpei estas pra você: ${run.data.modeSummary}`
            : "Garimpei estas obras pra você 👇"
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

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantContent,
      recommendation,
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
