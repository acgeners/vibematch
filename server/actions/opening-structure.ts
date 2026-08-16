"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin } from "@/server/queries/current-user"
import { ensureAiConsumption } from "@/server/queries/ai-quota"
import { getOpeningStructureContext } from "@/server/queries/opening-structure"
import {
  analyzeOpeningStructureLocal,
  analyzeOpeningStructureWeb,
  type OpeningStructureResult,
} from "@/lib/works/opening-structure"

/**
 * As três ações da estrutura de abertura, e elas são TRÊS de propósito.
 *
 * 🔴 O passo web é um SEGUNDO DISPARO do usuário, nunca um fallback automático dentro do
 * primeiro. Medido no piloto: a web custa ~US$0,25 contra US$0,016 do local e resgata ~1 em 5 —
 * encadeá-la transformaria uma ação de US$0,016 numa de US$0,14 para ganhar 12 pontos de
 * cobertura, sem o usuário decidir nada.
 *
 * ⚠️ E a separação também é o que dá indicador de progresso a esta feature. Uma ação única com
 * confirmação de custo no meio é exatamente o desenho que hoje deixa `predictInterestWithToast`
 * sem tarefa azul: o indicador diria "rodando" enquanto um modal espera clique.
 */

export interface OpeningStructureActionResult {
  ok?: boolean
  verdict?: "flashforward" | "linear" | "indeterminado"
  evidence?: string
  rationale?: string
  confidence?: number
  source?: "local" | "web"
  costUsd?: number
  error?: string
}

/**
 * Persiste o veredito da IA.
 *
 * ⚠️ Grava sempre as 7 colunas juntas, inclusive quando o veredito é "indeterminado" — nesse
 * caso a evidência vai a NULL. Deixar a citação anterior para trás faria a tela mostrar prova de
 * um veredito que já não vale, que é pior do que não mostrar prova nenhuma.
 *
 * ⚠️ NÃO chama `markRecalcPending`. `opening_structure` não está em `CATALOG_RECALC_INPUTS` —
 * não é feature do Ridge nem entra no GPT.N —, então marcar acenderia o badge "Recalcular notas"
 * por uma mudança que não move nota nenhuma.
 */
async function persist(workId: string, r: OpeningStructureResult): Promise<string | null> {
  const supabase = createAdminClient()
  const decided = r.verdict !== "indeterminado"
  const { error } = await supabase
    .from("works")
    .update({
      opening_structure_auto: r.verdict,
      opening_structure_auto_confidence: r.confidence,
      // O CHECK do banco recusa veredito afirmativo sem citação de ≥15 chars; o serviço já
      // rebaixa para "indeterminado" nesse caso, então aqui os dois lados concordam sempre.
      opening_structure_auto_evidence: decided ? r.evidence : null,
      opening_structure_auto_rationale: r.rationale || null,
      opening_structure_auto_source: r.source,
      opening_structure_auto_model: r.modelName,
      opening_structure_auto_at: new Date().toISOString(),
    })
    .eq("id", workId)
  return error ? error.message : null
}

/** ETAPA 1 — só o material já no banco. */
export async function analyzeOpeningStructureAction(
  workId: string,
): Promise<OpeningStructureActionResult> {
  try {
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }

    const ctx = await getOpeningStructureContext(workId)
    if (ctx.error || !ctx.data) return { error: ctx.error ?? "Falha carregando o material da obra." }

    const result = await analyzeOpeningStructureLocal(ctx.data)
    const err = await persist(workId, result)
    if (err) return { error: `Falha ao salvar: ${err}` }

    revalidatePath(`/catalog/${workId}`)
    return {
      ok: true,
      verdict: result.verdict,
      evidence: result.evidence,
      rationale: result.rationale,
      confidence: result.confidence,
      source: result.source,
      costUsd: result.costUsd,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha na análise da abertura." }
  }
}

/** ETAPA 2 — busca web, disparo explícito. Só faz sentido depois de a etapa 1 não decidir. */
export async function analyzeOpeningStructureWebAction(
  workId: string,
): Promise<OpeningStructureActionResult> {
  try {
    const gate = await ensureAiConsumption()
    if (!gate.ok) return { error: gate.error }

    const ctx = await getOpeningStructureContext(workId)
    if (ctx.error || !ctx.data) return { error: ctx.error ?? "Falha carregando o material da obra." }

    const result = await analyzeOpeningStructureWeb(ctx.data)
    const err = await persist(workId, result)
    if (err) return { error: `Falha ao salvar: ${err}` }

    revalidatePath(`/catalog/${workId}`)
    return {
      ok: true,
      verdict: result.verdict,
      evidence: result.evidence,
      rationale: result.rationale,
      confidence: result.confidence,
      source: result.source,
      costUsd: result.costUsd,
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha na busca web." }
  }
}

/**
 * Marcação humana. `null` desfaz e devolve o veredito da IA (a coluna gerada faz o COALESCE).
 *
 * 🔴 Aceita só os dois valores AFIRMATIVOS, e o banco impõe o mesmo. "Não sei" não é uma
 * marcação — é o estado que já existe sem override. Um override "indeterminado" seria
 * indistinguível de "ninguém olhou ainda".
 *
 * Gate: `ensureAdmin`, como `setAdultOverride`. É coluna de CATÁLOGO — o veredito vale para todo
 * leitor, então quem o afirma é a curadoria, não cada usuário na sua própria linha.
 */
export async function setOpeningStructureOverrideAction(
  workId: string,
  value: "flashforward" | "linear" | null,
): Promise<{ ok?: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }

  if (value !== null && value !== "flashforward" && value !== "linear") {
    return { error: "Marcação inválida." }
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("works")
    .update({ opening_structure_override: value })
    .eq("id", workId)
  if (error) return { error: error.message }

  revalidatePath(`/catalog/${workId}`)
  return { ok: true }
}
