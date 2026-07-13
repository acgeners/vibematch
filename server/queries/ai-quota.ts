import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensurePermission, getCurrentRole, getSessionUserId } from "@/server/queries/current-user"
import { ROLE_LABELS } from "@/lib/plans/roles"
import type { Role } from "@/lib/plans/roles"

/**
 * Cota de IA POR USUÁRIO — a trava de denial-of-wallet.
 *
 * O que existia antes: `MAX_RUNS_PER_DAY = 20` contado por `getRunsToday()`, que
 * consultava `recommendation_runs` SEM filtro de usuário (a tabela nem tinha a coluna).
 * Ou seja: um teto GLOBAL de 20 runs/dia para o app inteiro — um usuário esgotava a cota
 * de todos. E era furado por três lados:
 *
 *   1. os cinco re-ranks CHECAVAM o teto e nunca gravavam run → re-rank era ilimitado;
 *   2. deep dive e chat não checavam nada — e o deep dive usa extended thinking, a
 *      chamada mais cara do app;
 *   3. `ai_api_calls.user_id` era 100% NULL → ninguém sabia quem gastou o quê.
 *
 * A cota agora é em DÓLARES, não em "runs". Dólar é a unidade do risco: cobre re-rank,
 * deep dive, chat, perfil e previsão de interesse de uma vez, e não depende de cada
 * feature nova lembrar de se registrar. A fonte é `ai_api_calls.cost_total_usd`, por onde
 * TODA chamada de LLM passa.
 */

/** Teto de gasto de IA nas últimas 24h, por papel. */
export const DAILY_AI_BUDGET_USD: Record<Role, number> = {
  // O leitor não consome IA (o gate `consume_ai` já barra). Zero aqui é cinto e suspensório.
  leitor: 0,
  // ~US$0,03/avaliação, ~US$0,05–0,15/recomendação: US$2/dia é folgado pro uso humano e
  // ainda assim um teto — um loop maluco para em minutos, não em centenas de dólares.
  assinante: 2,
  // Sem teto: o curador roda backfills e cascatas em lote (é o dono do saldo). Um teto aqui
  // quebraria trabalho legítimo — e quem tem a chave da Anthropic é ele.
  curador: Number.POSITIVE_INFINITY,
}

/** Gasto de IA do usuário nas últimas 24h (US$). Memoizado por request. */
export const getAiSpend24hUsd = cache(async (userId: string): Promise<number> => {
  const supabase = createAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // ⚠️ Paginado: `select` do Supabase corta em 1000 linhas SEM AVISAR, e um dia movimentado
  // passa disso fácil. Truncar aqui não daria erro — daria um gasto SUBESTIMADO, que é
  // exatamente o jeito de a trava falhar em silêncio justamente quando ela importa.
  let total = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("ai_api_calls")
      .select("cost_total_usd")
      .eq("user_id", userId)
      .gte("created_at", since)
      .range(from, from + 999)

    if (error) {
      console.error("[ai-quota] erro somando gasto:", error.message)
      // Fail-OPEN de propósito: um erro transitório de leitura não pode bloquear o app
      // inteiro. O teto é uma trava de custo, não um gate de segurança — quem barra o
      // não-autorizado é `ensurePermission("consume_ai")`, que roda antes.
      return 0
    }
    if (!data?.length) break
    for (const row of data) total += Number(row.cost_total_usd ?? 0)
    if (data.length < 1000) break
  }
  return total
})

export interface AiBudgetStatus {
  role: Role
  spentUsd: number
  limitUsd: number
  remainingUsd: number
  exceeded: boolean
}

export async function getAiBudgetStatus(): Promise<AiBudgetStatus | null> {
  const userId = await getSessionUserId()
  if (!userId) return null

  const role = await getCurrentRole()
  const limitUsd = DAILY_AI_BUDGET_USD[role]
  const spentUsd = Number.isFinite(limitUsd) ? await getAiSpend24hUsd(userId) : 0

  return {
    role,
    spentUsd,
    limitUsd,
    remainingUsd: limitUsd - spentUsd,
    exceeded: spentUsd >= limitUsd,
  }
}

/**
 * O gate ÚNICO de toda IA de consumo: permissão **e** cota, nesta ordem.
 *
 * Existe pra que não haja como passar em um e esquecer o outro — foi assim que deep dive
 * e chat ficaram sem trava nenhuma de custo, enquanto a recomendação tinha (uma furada).
 */
export async function ensureAiConsumption(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const permitted = await ensurePermission("consume_ai")
  if (!permitted.ok) return permitted
  return ensureAiBudget()
}

/**
 * Gate de CUSTO. Roda DEPOIS de `ensurePermission("consume_ai")` — permissão responde
 * "pode?", cota responde "quanto já gastou hoje?".
 */
export async function ensureAiBudget(): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = await getAiBudgetStatus()
  if (!status) return { ok: false, error: "Entre na sua conta para usar a IA." }
  if (!status.exceeded) return { ok: true }

  return {
    ok: false,
    error: `Cota diária de IA do plano ${ROLE_LABELS[status.role]} atingida (US$ ${status.limitUsd.toFixed(2)} em 24h). Ela volta conforme as chamadas antigas saem da janela.`,
  }
}
