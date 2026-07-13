import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { getOwnerUserId } from "./current-user"
import { PERSONAL_COLUMNS } from "./user-work-state"
import type { WorkReadingColumns } from "./user-work-state"

// ═══════════════════════════════════════════════════════════════════════════════════════
// Os RÓTULOS DO DONO — a fonte do scoring (Fase B do desatrelamento)
//
// O Ridge (Nota Prevista), a chance, o viés de atributo, o ledger de previsões e o perfil de
// gosto treinam com as notas do DONO. Elas moravam em `works`; agora saem daqui.
//
// ── Por que este arquivo existe, em vez de cada query fazer o seu join ─────────────────
//
// Porque o modo de falha é silencioso. O recalc roda em BACKGROUND (fila, `after()`,
// cascatas) — sem sessão. Se uma query esquecer o `user_id`, ou o cliente de sessão for usado
// por engano, a leitura devolve ZERO linhas. E o Ridge, sem rótulos, NÃO GRITA: ele cai na
// média do treino (`MIN_TRAIN = 20` em lib/calculations/expected.ts) e devolve 878 notas
// plausíveis e erradas. Sem erro, sem log, sem sintoma — até você reparar que o ranking virou
// outro.
//
// Então a leitura dos rótulos passa por UM lugar só, e esse lugar:
//   1. usa a SERVICE ROLE com o `user_id` EXPLÍCITO do dono (background não tem sessão);
//   2. PAGINA (o `select` corta em 1000 linhas sem avisar);
//   3. tem um GUARDA BARULHENTO: se os rótulos sumirem, ele FALHA em vez de devolver poucos.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Piso de sanidade. Abaixo disto, alguma coisa quebrou — não é "o dono desavaliou tudo". */
const MIN_EXPECTED_LABELS = 50

export interface OwnerLabels {
  ownerId: string
  /** Estado pessoal do dono, por obra (as 16 colunas). */
  byWorkId: Map<string, WorkReadingColumns>
  /** Quantas obras ele de fato notou (`user_score != null`). */
  labelledCount: number
}

/**
 * Carrega o estado pessoal do dono de `user_work_state`.
 *
 * ⚠️ NÃO memoizado com o `cache` do React de propósito: o recalc roda fora de request (fila,
 * `after()`), onde o cache do React não existe — e um "cache" que só funciona às vezes é pior
 * que nenhum, porque esconde o custo real.
 */
export async function loadOwnerLabels(userIdOverride?: string): Promise<OwnerLabels> {
  // O override existe pra TESTAR o guarda (apontando pra um usuário sem rótulos e exigindo que
  // ele exploda). Em produção ninguém passa nada: o dono vem do singleton.
  const ownerId = userIdOverride ?? (await getOwnerUserId())
  const supabase = createAdminClient()
  const byWorkId = new Map<string, WorkReadingColumns>()

  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("user_work_state")
      .select(
        `work_id, is_favorite, personal_status_id, chapters_read, last_read_at,
         user_score, observations, observation_adjustment,
         synopsis_quality, synopsis_quality_source, synopsis_quality_prediction_id,
         synopsis_interest_skipped,
         post_story_score, post_fl_score, post_ml_score, post_character_development_score,
         post_pacing_score, post_art_visual_score, post_impact_immersion_score,
         post_originality_score`,
      )
      .eq("user_id", ownerId)
      .order("work_id", { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`[owner-labels] falha lendo user_work_state: ${error.message}`)
    if (!data?.length) break
    for (const row of data) {
      byWorkId.set(row.work_id as string, row as WorkReadingColumns)
    }
    if (data.length < PAGE) break
  }

  const labelledCount = [...byWorkId.values()].filter((r) => r.user_score != null).length

  // 🔴 O GUARDA BARULHENTO. Se os rótulos sumirem — `user_id` errado, RLS mordendo, tabela
  // vazia —, o Ridge treinaria com nada e devolveria a média do treino em 878 obras, calado.
  // Falhar aqui, alto, é a única forma de esse erro ser NOTADO. Um recalc que não roda é um
  // problema visível; um recalc que roda errado, não.
  if (labelledCount < MIN_EXPECTED_LABELS) {
    throw new Error(
      `[owner-labels] só ${labelledCount} rótulos do dono em user_work_state (esperado ≥ ${MIN_EXPECTED_LABELS}). ` +
        `O scoring NÃO vai rodar com isso: sem rótulos, o Ridge cai na média do treino e devolve ` +
        `notas plausíveis e erradas para o catálogo inteiro. Confira o user_id do dono ` +
        `(${ownerId}) e o backfill (scripts/rebackfill-user-work-state.mjs).`,
    )
  }

  return { ownerId, byWorkId, labelledCount }
}

/**
 * Sobrepõe o estado do dono numa lista de linhas de `works` que o scoring já buscou.
 *
 * Devolve as MESMAS linhas, com as colunas pessoais trocadas pelas do espelho — o resto do
 * pipeline (features, Ridge, chance, bias) continua vendo exatamente a forma que sempre viu.
 * É o que torna esta fase testável: se a troca estiver certa, as 882 `expected_score` têm que
 * sair IDÊNTICAS.
 *
 * Obra sem linha no espelho → colunas pessoais em branco (é o que "sem estado" significa).
 */
export function withOwnerLabels<T extends { id: string }>(
  rows: T[],
  labels: OwnerLabels,
): T[] {
  return rows.map((row) => {
    const own = labels.byWorkId.get(row.id)
    const personal: Record<string, unknown> = {}
    for (const col of PERSONAL_COLUMNS) {
      personal[col] = own ? ((own as Record<string, unknown>)[col] ?? null) : null
    }
    return { ...row, ...personal }
  })
}
