"use server"

import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin } from "@/server/queries/current-user"
import { recalculateAll, type RecalculateExecutionContext } from "@/server/actions/calculations"
import { ensureRecalculateScores } from "@/lib/orchestration/integrations/recalculate-scores"
import {
  countMissingEmbeddings,
  countPendingCanonicalSynopses,
  countPendingReviewSummaries,
} from "@/server/queries/settings-pending"

// Janela de debounce do recálculo automático: só dispara sozinho depois de 1h
// SEM novas edições de nota. Uma avaliação IA de atributos já leva >60s, então
// uma janela curta dispararia no meio de uma sessão de avaliação em lote — a
// 1h espera o usuário terminar o batch inteiro.
const RECALC_DEBOUNCE_MS = 60 * 60 * 1000

export interface RecalcPendingState {
  pending: boolean
  /** Timestamp da última edição (a janela de 1h conta daqui). */
  lastEditAt: string | null
}

export interface AiPendingCounts {
  embeddings: number
  canonicalSynopsis: number
  reviewSummary: number
}

/**
 * Pendências dos artefatos gerados por IA — versão BARATA (sinais leves, sem o
 * hashing de embeddings), pra alimentar a trava do botão de recalcular sem
 * atrasar o clique. Espelha `getSettingsBadgePendingTotal`, mas devolve o
 * detalhamento por item em vez do total.
 */
export async function getAiPendingCounts(): Promise<AiPendingCounts> {
  const [embeddings, canonicalSynopsis, reviewSummary] = await Promise.all([
    countMissingEmbeddings().catch(() => 0),
    countPendingCanonicalSynopses().catch(() => 0),
    countPendingReviewSummaries().catch(() => 0),
  ])
  return { embeddings, canonicalSynopsis, reviewSummary }
}

/**
 * Marca a base como "recálculo pendente" em vez de rodar recalculateAll na hora.
 * Usado pelos saves incidentais (edição de obra/status, pós-leitura, importação,
 * previsão de sinopse, aceite de avaliação IA). É um UPDATE barato — a Nota
 * Prevista só recalcula quando o usuário clica "Recalcular agora" ou passada 1h
 * sem novas edições.
 *
 * Fallback: se a RPC/colunas ainda não existem (migration 096 não aplicada) ou o
 * UPDATE falha, cai pro recálculo em background (comportamento antigo) pra nada
 * quebrar — o deferimento passa a valer só depois da migration.
 */
export async function markRecalcPending(context: string): Promise<void> {
  const supabase = createAdminClient()
  try {
    const { error } = await supabase.rpc("touch_recalc_pending")
    if (error) throw error
  } catch (err) {
    console.warn(
      `[markRecalcPending:${context}] não foi possível marcar pendente, recalculando em background:`,
      err instanceof Error ? err.message : err,
    )
    recalculateScoresInBackground(context)
  }
}

/**
 * Deps reais p/ a orquestração do recálculo (TS puro determinístico + pendente).
 * `ctx` seleciona o caminho de execução do `recalculateAll` (next-runtime cacheado
 * vs headless uncached) — escolha EXPLÍCITA, sem heurística de ambiente.
 */
const recalcDeps = (force: boolean, ctx: RecalculateExecutionContext = "next-runtime") => ({
  force,
  recalc: () => recalculateAll(ctx),
  readPending: getRecalcPendingState,
})

/**
 * Recálculo orquestrado AGUARDADO (force=true): create / "Recalcular agora". Job
 * global durável, free, deduplicado/coalescido. Devolve estado tipado.
 */
export async function recalculateScoresNow() {
  return ensureRecalculateScores(recalcDeps(true))
}

/**
 * Recálculo orquestrado AGUARDADO que só roda se houver pendência (force=false).
 * Usado pelo backfill após uma regeneração REAL do perfil: `insertNewTasteProfile`
 * marca `recalc_pending`, então este recalc coalescido/global zera a pendência ao
 * concluir — sem `force` (que mascararia a ausência de pendência para os demais
 * consumidores do recalc). Job global free, deduplicado/coalescido.
 */
export async function recalculateScoresIfPending() {
  return ensureRecalculateScores(recalcDeps(false))
}

/**
 * Recálculo orquestrado HEADLESS-SAFE (CLI/workers): mesmo contrato global/free/
 * coalescido, mas com `recalculateAll("headless")` (leituras uncached, sem
 * `revalidate*`). Só roda se houver pendência (force=false) — usado pelo backfill
 * e pela CLI de recuperação `npm run recalc:scores`. NÃO chama LLM, custo zero.
 */
export async function recalculateScoresHeadless() {
  return ensureRecalculateScores(recalcDeps(false, "headless"))
}

/**
 * Recálculo AGUARDADO que devolve o RESULTADO COMPLETO do recalc (recalculated +
 * calibration etc.) — para callers que precisam dele (settings/calibração/pós-leitura).
 * Roteia pela orquestração (NUNCA chama recalculateAll direto). Lança em falha ou
 * no caso raro de waiter sem resultado (concorrência cross-processo, ~impossível em
 * single-user) — preservando a semântica "ou recalcula e devolve, ou erra".
 */
export async function recalculateScoresNowResult() {
  const out = await recalculateScoresNow()
  if (out.status === "failed") throw new Error(out.error)
  if (out.status !== "succeeded" || out.result == null) {
    throw new Error("Recálculo em andamento — tente novamente em instantes.")
  }
  return out.result
}

/**
 * Recálculo orquestrado em BACKGROUND (force=false): só roda se houver pendência.
 * Substitui a coalescência in-process antiga — a dedup/coalescência agora é da
 * orquestração (single-flight + job durável). Usado pelo auto-recalc e pelo
 * fallback do markRecalcPending. Best-effort (engole erro).
 */
function recalculateScoresInBackground(context: string): void {
  after(async () => {
    try {
      await ensureRecalculateScores(recalcDeps(false))
    } catch (err) {
      console.error(`[${context}] recálculo orquestrado (bg) falhou:`, err instanceof Error ? err.message : err)
    }
  })
}

/** Lê o estado de recálculo pendente (sem efeito colateral). */
export async function getRecalcPendingState(): Promise<RecalcPendingState> {
  const supabase = createAdminClient()
  try {
    const { data, error } = await supabase
      .from("formula_config")
      .select("recalc_pending, recalc_last_edit_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    const row = data as { recalc_pending: boolean | null; recalc_last_edit_at: string | null } | null
    return { pending: row?.recalc_pending === true, lastEditAt: row?.recalc_last_edit_at ?? null }
  } catch {
    // Pré-migration (colunas ausentes) → nunca pendente, nenhum banner.
    return { pending: false, lastEditAt: null }
  }
}

/**
 * Disparo lazy do recálculo automático: se há recálculo pendente E a última
 * edição foi há ≥1h, roda recalculateAll em background (coalescido pelo guard de
 * calculations.ts). Chamado na carga de página (via getSidebarBadgeCounts), então
 * só recompõe quando o usuário volta a usar o app — nunca gasta compute à toa.
 * Retorna o estado pendente pra a UI reaproveitar a mesma leitura.
 */
export async function maybeTriggerStaleRecalc(): Promise<RecalcPendingState> {
  const state = await getRecalcPendingState()
  if (state.pending && state.lastEditAt) {
    const age = Date.now() - new Date(state.lastEditAt).getTime()
    if (age >= RECALC_DEBOUNCE_MS) {
      recalculateScoresInBackground("stale-auto")
    }
  }
  return state
}

/**
 * "Recalcular agora" — recálculo completo AGUARDADO via orquestração (job global
 * free, deduplicado: duplo-clique/callers concorrentes ⇒ uma execução). Limpa o
 * flag pendente (recalculateAll zera ao persistir o formula_config). recalculateAll
 * já revalida /ranking, /titles, /settings e / por dentro. Devolve estado tipado.
 */
export async function triggerRecalcNow() {
  // "Recalcular agora" reescreve calculated_scores (compartilhado) → gate de admin.
  // Sinaliza via throw; o caller (recalc-pending-control) já trata em try/catch → toast.
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)
  return recalculateScoresNow()
}
