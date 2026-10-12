import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { defaultMixedEdition, parseMixedEdition } from "@/lib/editions/mixed-edition"
import type { MixedEdition } from "@/lib/editions/mixed-edition"
import { EVALUATION_COLUMNS, planReadEdition, touchesEvaluation } from "@/lib/editions/read-edition"
import type { CurrentEvaluationRow, ReadEditionContext, ReadEditionWrite } from "@/lib/editions/read-edition"
import { loadMixedEditionSettingsFor } from "./edition-scores"

/**
 * O lado de I/O da regra de `lib/editions/read-edition.ts`: para uma escrita de estado pessoal, decide
 * a versão de cada obra `mixed` tocada. Usado pelos DOIS escritores centrais (`writeReadingState`,
 * `mirrorOwnerState`), e só por eles — é o que garante que nenhum caminho grava avaliação sem passar
 * pela regra.
 *
 * Custo: ZERO consulta quando a escrita não toca a avaliação (status, capítulos, favorito, ♥) e não é
 * uma troca explícita — o caso comum. Tocando, 1 leitura do estado de edição das obras; só se alguma for
 * `mixed`, +1 leitura da linha atual e, se for avaliação nova sem tela, +1 da preferência de 18+.
 *
 * ⚠️ FALHA FECHADA: se uma leitura falhar, a escrita é recusada. Gravar sem plano deixaria a avaliação
 * nova sem versão (o rótulo do treino cairia no legado em silêncio) — pior que pedir para salvar de novo.
 */
const LOTE = 200

const STATE_SELECT = ["work_id", "read_edition", ...EVALUATION_COLUMNS].join(", ")

export interface ReadEditionPlanDeps {
  /** Lê `user_work_state` de quem grava: o cliente de SESSÃO (RLS) ou a service role (dona). */
  stateClient: Pick<SupabaseClient, "from">
  /** Catálogo (`work_edition_state`): service role. */
  catalogClient?: Pick<SupabaseClient, "from">
  /** A preferência de 18+ de quem grava (só para avaliação nova sem tela). */
  loadHideAdult?: (userId: string) => Promise<boolean>
}

export async function planReadEditionsForWrite(
  opts: { userId: string; workIds: string[]; patch: Record<string, unknown>; context: ReadEditionContext },
  deps: ReadEditionPlanDeps,
): Promise<{ plans: Map<string, ReadEditionWrite>; error: string | null }> {
  const plans = new Map<string, ReadEditionWrite>()
  const { userId, workIds, patch, context } = opts
  if (!touchesEvaluation(patch) && context.kind !== "explicit") return { plans, error: null }

  const catalog = deps.catalogClient ?? createAdminClient()
  const mixed = new Map<string, { extras: boolean }>()
  for (let i = 0; i < workIds.length; i += LOTE) {
    const lote = workIds.slice(i, i + LOTE)
    const { data, error } = await catalog
      .from("work_edition_state")
      .select("work_id, r18_extra_chapters")
      .eq("state", "mixed")
      .in("work_id", lote)
    if (error) return { plans, error: `Falha lendo as versões da obra: ${error.message}` }
    for (const r of (data ?? []) as Array<{ work_id: string; r18_extra_chapters: boolean | null }>) {
      mixed.set(r.work_id, { extras: r.r18_extra_chapters === true })
    }
  }
  if (mixed.size === 0) return { plans, error: null }

  const mixedIds = [...mixed.keys()]
  const current = new Map<string, CurrentEvaluationRow>()
  for (let i = 0; i < mixedIds.length; i += LOTE) {
    const lote = mixedIds.slice(i, i + LOTE)
    const { data, error } = await deps.stateClient
      .from("user_work_state")
      .select(STATE_SELECT)
      .eq("user_id", userId)
      .in("work_id", lote)
    if (error) return { plans, error: `Falha lendo a versão da sua avaliação: ${error.message}` }
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const values: CurrentEvaluationRow["values"] = {}
      for (const c of EVALUATION_COLUMNS) values[c] = row[c]
      current.set(String(row.work_id), { readEdition: parseMixedEdition(row.read_edition), values })
    }
  }

  // A preferência só é lida se alguma avaliação NOVA precisar da padrão da conta.
  let hideAdult: boolean | null = null
  const padraoDa = async (workId: string): Promise<MixedEdition | null> => {
    if (context.kind !== "default") return null
    if (hideAdult == null) {
      hideAdult = deps.loadHideAdult
        ? await deps.loadHideAdult(userId)
        : (await loadMixedEditionSettingsFor(userId, catalog)).hideAdult
    }
    return defaultMixedEdition({ hideAdult, signedIn: true, r18OnlyInExtras: mixed.get(workId)?.extras === true })
  }

  try {
    for (const workId of mixedIds) {
      const atual = current.get(workId) ?? null
      const novaSemTela =
        context.kind === "default" && !Object.values(atual?.values ?? {}).some((v) => v != null)
      const plan = planReadEdition({
        isMixed: true,
        current: atual,
        patch,
        context,
        defaultEdition: novaSemTela ? await padraoDa(workId) : null,
      })
      if (plan) plans.set(workId, plan)
    }
  } catch (e) {
    return { plans: new Map(), error: `Falha lendo a sua preferência de 18+: ${e instanceof Error ? e.message : String(e)}` }
  }
  return { plans, error: null }
}

/**
 * Agrupa as linhas por PLANO de versão. Necessário porque o upsert em lote do supabase-js preenche com
 * NULL a coluna que falta em parte das linhas (`defaultToNull`): misturar no mesmo upsert uma linha COM
 * `read_edition` e outra SEM apagaria a versão da segunda. Cada grupo tem as mesmas chaves.
 */
export function groupRowsByPlan<T extends { work_id: string }>(
  rows: T[],
  plans: Map<string, ReadEditionWrite>,
): Array<Array<T | (T & ReadEditionWrite)>> {
  const grupos = new Map<string, Array<T | (T & ReadEditionWrite)>>()
  for (const row of rows) {
    const plan = plans.get(row.work_id)
    const chave = plan ? `${plan.read_edition}|${plan.read_edition_source}` : "-"
    const lista = grupos.get(chave) ?? []
    lista.push(plan ? { ...row, ...plan } : row)
    grupos.set(chave, lista)
  }
  return [...grupos.values()]
}
