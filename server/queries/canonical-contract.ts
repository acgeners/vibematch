import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { decidirContratoCanonico } from "@/lib/canonical-contract"
import type { ContratoCanonico } from "@/lib/canonical-contract"
import { SCORING_CONTRACT } from "@/lib/calculations/scoring-contract"

/**
 * Lê a linha de `canonical_contract` (migration 202). `null` = contrato ausente: a tabela ainda não
 * existe neste banco, ou não tem linha — nos dois casos ele NÃO é imposto (ver `lib/canonical-contract.ts`).
 *
 * 🔴 Qualquer OUTRO erro LANÇA (fail closed). Não conseguir ler o contrato não é o mesmo que o
 * contrato não existir: tratar falha de rede como "liberado" é a porta pela qual a guarda some
 * calada. O custo de lançar é um recalc ou uma avaliação adiados — recuperável.
 */
export async function lerContratoCanonico(supabase: Pick<SupabaseClient, "from">): Promise<ContratoCanonico | null> {
  const { data, error } = await supabase
    .from("canonical_contract")
    .select("eval_prompt_versions, scoring_contracts, enforce")
    .eq("id", 1)
    .maybeSingle()
  if (error) {
    if (tabelaAusente(error)) return null
    throw new Error(`não consegui ler o contrato canônico (canonical_contract): ${error.message}`)
  }
  if (!data) return null
  const row = data as { eval_prompt_versions: string[] | null; scoring_contracts: string[] | null; enforce: boolean | null }
  return {
    evalPromptVersions: row.eval_prompt_versions ?? [],
    scoringContracts: row.scoring_contracts ?? [],
    enforce: row.enforce === true,
  }
}

/** PGRST205 = a tabela não está no schema cache do PostgREST; 42P01 = relação inexistente no Postgres. */
function tabelaAusente(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST205" || error.code === "42P01"
}

/**
 * PREFLIGHT do recalc: aborta ANTES de ler o catálogo, calcular ou gravar quando o banco impõe um
 * contrato de scoring que não é o deste código. Chamado no topo dos DOIS caminhos que gravam
 * resultado de scoring (`recalculateAll` e `recalculateForUser`).
 */
export async function exigirContratoDeScoring(supabase: Pick<SupabaseClient, "from">): Promise<void> {
  const decisao = decidirContratoCanonico("scoring", await lerContratoCanonico(supabase), SCORING_CONTRACT)
  if (!decisao.permitido) throw new Error(decisao.mensagem)
}
