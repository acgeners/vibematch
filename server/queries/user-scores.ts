import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { getOwnerUserId, getSessionUserId } from "./current-user"

// ═══════════════════════════════════════════════════════════════════════════════════════
// Os SCORES DERIVADOS de quem está olhando — FATIA 2b
//
// `calculated_scores` não tem `user_id`. A Nota Prevista, a Chance, o Alinhamento e o
// personal_fit que moram lá são do DONO — e até esta fatia apareciam para a Leitora como se
// fossem dela. Ela lia "você vai gostar 8,6 disso" e aquilo era a previsão do gosto DELE.
//
// ── A divisão ─────────────────────────────────────────────────────────────────────────
//
// FATO DA OBRA (passa direto, igual pra todos — é o que o MAL mostra):
//   platform_avg + total_votes  → a NOTA DA COMUNIDADE
//   ia_eval, chapters_normalized, formula_version
//
// DE QUEM OLHA (sai de `user_calculated_scores`):
//   expected_score (Nota Prevista), calc_score, chance_score,
//   personal_fit, personal_fit_percentile, tag_overlap_net,
//   alignment_* (Veredito IA — o único que custa LLM)
//
//   LEITURA   dono      → `calculated_scores` (fonte de verdade; ele é imune)
//             os demais → `user_calculated_scores`; SEM linha → tudo null
//
// ⚠️ "Sem modelo" devolve NULL, e isso é a correção, não a degradação. Hoje quem tem menos de
// 20 rótulos recebe a média do treino EXIBIDA COMO PREVISÃO (`expected_is_stub`) — um chute com
// cara de número. A partir daqui: sem rótulos, sem previsão. O que aparece é a nota da
// comunidade, que é um fato.
//
// ⚠️ Determinístico ≠ pago. Nota Prevista/Chance/personal_fit saem de Ridge em TS puro (zero
// LLM): o Leitor free TEM direito a elas. O portão é DADO (MIN_TRAIN=20), não plano. Só
// `alignment_*` queima token.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Os campos de `calculated_scores` que pertencem a QUEM OLHA, não à obra. */
export const PERSONAL_SCORE_FIELDS = [
  "expected_score",
  "expected_is_stub",
  "expected_baseline",
  "expected_quality_adj",
  "calc_score",
  "chance_score",
  "chance_is_stub",
  "personal_fit",
  "personal_fit_percentile",
  "tag_overlap_net",
  "alignment_score",
  "alignment_run_id",
  "alignment_justification",
  "alignment_at",
  "alignment_payload",
  "alignment_stale",
  "mae_calc",
  "rmse_calc",
  "confidence",
] as const

export type PersonalScoreField = (typeof PERSONAL_SCORE_FIELDS)[number]

/** Uma linha de scores sem os campos pessoais — só o fato da obra. */
const EMPTY_PERSONAL_SCORES: Record<string, unknown> = Object.fromEntries(
  PERSONAL_SCORE_FIELDS.map((f) => [
    f,
    f === "expected_is_stub" || f === "chance_is_stub" ? true : f === "alignment_stale" ? false : null,
  ]),
)

const PAGE = 1000

export interface ScoresReader {
  /**
   * Dono das notas que este leitor representa — `null` sem sessão. Mesma regra do
   * `PersonalStateReader.userId`, e pelo mesmo motivo: emprestar o id do dono "porque o tipo
   * pede um string" foi o que expôs a lista de leitura dele em `/leitura` (2026-08-03).
   * Nenhum consumidor usava este campo quando ele foi corrigido — a mudança é para que o
   * PRÓXIMO não herde a armadilha.
   */
  userId: string | null
  isOwner: boolean
  /** true quando esta pessoa TEM modelo (≥ MIN_TRAIN rótulos → Nota Prevista de verdade). */
  hasModel: boolean
  /**
   * Sobrepõe os scores PESSOAIS na linha de `calculated_scores` que a página já buscou.
   * Os campos de CATÁLOGO (platform_avg, total_votes, ia_eval) passam intactos — são o que
   * todo mundo vê, inclusive quem não tem modelo.
   *
   * Genérico em `T` para devolver exatamente o tipo que entrou: os call sites têm o tipo
   * `CalculatedScore` do domínio, e alargar pra `Record<string, unknown>` aqui obrigaria um
   * cast em cada um deles — que é onde um erro de campo passaria despercebido.
   */
  overlay<T>(workId: string, calcRow: T): T
}

/**
 * Leitor dos scores do usuário da requisição. Memoizado por request.
 *
 * ⚠️ Usa `getSessionUserId()` (null sem sessão), NUNCA `getCurrentUserId()` — este último cai
 * no singleton, e era exatamente por isso que o visitante anônimo recebia `isOwner: true` e
 * lia `calculated_scores`: a Nota Prevista, o personal_fit e o Veredito IA DO DONO, exibidos
 * como se fossem a avaliação do acervo. Numa página pública isso publica o gosto de uma
 * pessoa com cara de dado objetivo — e o /ranking e o /titles ordenam por `expected_score`
 * por padrão, então era a ordem do catálogo inteiro que saía dali.
 *
 * Anônimo → `hasModel: false` + os campos pessoais zerados. O fallback que já existia para
 * "quem não tem modelo" (ranking.ts troca os campos pessoais do sort por `platform_avg`)
 * passa a valer para ele também — não foi preciso criar caminho novo, só parar de mentir
 * sobre quem ele é. Sobra o que é FATO da obra: platform_avg, total_votes, ia_eval.
 */
export const getScoresReader = cache(async (): Promise<ScoresReader> => {
  const [sessionId, ownerId] = await Promise.all([getSessionUserId(), getOwnerUserId()])

  if (!sessionId) {
    return {
      // Sem sessão não há identidade. Quem derivar chave de cache daqui deve usar uma sentinela
      // explícita (`?? "anon"`), como em `getFavoritesSummary` — nunca o id do dono, que faria o
      // visitante ler a entrada de cache dele.
      userId: null,
      isOwner: false,
      hasModel: false,
      overlay: <T,>(_workId: string, calcRow: T): T =>
        calcRow ? ({ ...(calcRow as object), ...EMPTY_PERSONAL_SCORES } as T) : calcRow,
    }
  }

  const userId = sessionId
  const isOwner = userId === ownerId

  if (isOwner) {
    // Dono: zero queries. `calculated_scores` já é o dele — a página buscou e pronto.
    return {
      userId,
      isOwner: true,
      hasModel: true,
      overlay: (_workId, calcRow) => calcRow,
    }
  }

  const byWorkId = await loadUserScores(userId)
  const hasModel = [...byWorkId.values()].some(
    (r) => r.expected_score != null && r.expected_is_stub !== true,
  )

  return {
    userId,
    isOwner: false,
    hasModel,
    overlay: <T,>(workId: string, calcRow: T): T => {
      if (!calcRow) return calcRow
      const mine = byWorkId.get(workId)
      // Sem linha dela → os campos pessoais somem (null). O CATÁLOGO fica: é a nota da
      // comunidade que ela passa a ver no lugar. Nunca herdar os do dono.
      return { ...(calcRow as object), ...EMPTY_PERSONAL_SCORES, ...(mine ?? {}) } as T
    },
  }
})

async function loadUserScores(userId: string): Promise<Map<string, Record<string, unknown>>> {
  const supabase = createAdminClient()
  const byWorkId = new Map<string, Record<string, unknown>>()

  // Paginado: o `select` corta em 1000 linhas sem avisar.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("user_calculated_scores")
      .select(
        `work_id, expected_score, expected_is_stub, expected_baseline, expected_quality_adj,
         calc_score, chance_score, chance_is_stub,
         personal_fit, personal_fit_percentile, tag_overlap_net,
         alignment_score, alignment_run_id, alignment_justification, alignment_at,
         alignment_payload, alignment_stale, mae_calc, rmse_calc, confidence`,
      )
      .eq("user_id", userId)
      .order("work_id", { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`user_calculated_scores: ${error.message}`)
    if (!data?.length) break
    for (const row of data) {
      const { work_id, ...scores } = row as Record<string, unknown>
      byWorkId.set(work_id as string, scores)
    }
    if (data.length < PAGE) break
  }

  return byWorkId
}
