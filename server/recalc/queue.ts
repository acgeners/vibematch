import "server-only"

// Fila/execução do recálculo. NÃO é `"use server"`: ali toda função exportada vira
// endpoint HTTP público, e `recalculateScoresNow()` — CPU sobre o catálogo inteiro —
// estava aberta a qualquer POST. Gate aqui não resolveria: estas funções rodam em
// background (`after()`, cascatas), onde não há sessão e `ensureAdmin()` daria false,
// matando os jobs do próprio dono. A fachada `server/actions/recalc-queue.ts` expõe
// como action só o que a UI chama (`getAiPendingCounts`, `triggerRecalcNow` — gated).

import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin, getOwnerUserId } from "@/server/queries/current-user"
import { decideMarkRecalc, needsOwnerToDecide } from "@/lib/calculations/recalc-inputs"
import type { RecalcInput } from "@/lib/calculations/recalc-inputs"
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

export interface MarkRecalcPendingOptions {
  /**
   * As entradas do recálculo que ESTA operação mudou (ver
   * `lib/calculations/recalc-inputs.ts`). Omitir significa "não sei" e marca —
   * é o default à prova de falha, e o comportamento de quem ainda não declara.
   * Array VAZIO significa "conferi, nada material mudou" e NÃO marca.
   */
  changed?: readonly RecalcInput[]
  /**
   * Quem fez a operação. Só é lido quando `changed` tem apenas entradas
   * PESSOAIS: o recalc global lê o viés/tags/perfil/rótulos do DONO, então a
   * mesma mudança feita por outra pessoa não move número nenhum aqui.
   *
   * 🔴 Passe o id EXPLÍCITO de quem agiu. Deduzir com `getCurrentUserId()` aqui
   * dentro seria pior que não checar: em background (sem sessão) ele cai no
   * singleton, ou seja, TODA ação pareceria ser do dono e o gate nunca fecharia.
   */
  actorId?: string
}

/**
 * Marca a base como "recálculo pendente" em vez de rodar recalculateAll na hora.
 * Usado pelos saves incidentais (edição de obra/status, pós-leitura, importação,
 * previsão de sinopse, aceite de avaliação IA). É um UPDATE barato — a Nota
 * Prevista só recalcula quando o usuário clica "Recalcular agora" ou passada 1h
 * sem novas edições.
 *
 * O `context` vai pro log (`[recalc-pending]`), que é a única medição que existe
 * da frequência real de cada disparo: a distribuição por caller sai de
 * `grep '\[recalc-pending\]'` nos logs, não de estimativa.
 *
 * Fallback: se a RPC/colunas ainda não existem (migration 096 não aplicada) ou o
 * UPDATE falha, cai pro recálculo em background (comportamento antigo) pra nada
 * quebrar — o deferimento passa a valer só depois da migration.
 */
export async function markRecalcPending(
  context: string,
  opts?: MarkRecalcPendingOptions,
): Promise<void> {
  const skip = await shouldSkipMark(context, opts)
  if (skip) return

  const supabase = createAdminClient()
  console.info(`[recalc-pending] marcou · context=${context} · changed=${opts?.changed?.join(",") ?? "?"}`)
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
 * Gate de materialidade. Duas saídas, ambas conservadoras por construção — a
 * dúvida sempre resolve em MARCAR, porque não marcar deixa nota velha na tela
 * sem nada acusar, enquanto marcar demais só custa um clique.
 */
async function shouldSkipMark(context: string, opts?: MarkRecalcPendingOptions): Promise<boolean> {
  const changed = opts?.changed

  // Só paga o `getOwnerUserId()` quando a decisão depende dele — o caminho comum
  // (mudou entrada de catálogo) resolve sem consulta nenhuma.
  let ownerId: string | null = null
  if (needsOwnerToDecide(changed, opts?.actorId)) {
    try {
      ownerId = await getOwnerUserId()
    } catch (err) {
      // Não deu pra saber quem é o dono → marca. Um gate que falha ABERTO devolve
      // um badge a mais; um que falha fechado devolve nota errada, calada.
      console.warn(
        `[recalc-pending] dono indeterminado em ${context}, marcando:`,
        err instanceof Error ? err.message : err,
      )
      return false
    }
  }

  const decision = decideMarkRecalc(changed, opts?.actorId, ownerId)
  if (decision.mark) return false
  console.info(`[recalc-pending] pulou · context=${context} · ${decision.reason}`)
  return true
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
