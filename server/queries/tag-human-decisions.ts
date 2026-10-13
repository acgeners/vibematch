import "server-only"
import type { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUserId } from "@/server/queries/current-user"
import { parseHumanDecisions } from "@/lib/tags/enrichment-view"
import type { HumanDecisionField, HumanDecisions } from "@/lib/tags/enrichment-view"

type Admin = ReturnType<typeof createAdminClient>

/**
 * Monta o novo `tags.human_decisions` (migration 219) de cada tag com `fields` carimbados agora, para
 * o chamador gravar JUNTO com o valor canônico. É assim que valor e proveniência nunca se separam: um
 * UPDATE só, com as duas coisas.
 *
 * `by` = o usuário da sessão. Toda ação de revisão passa antes por `ensureAdmin`, que só aceita quem
 * tem sessão — então ele existe sem infraestrutura nova (e `getSessionUserId` é memoizado por request).
 * Se mesmo assim vier nulo, o registro vai sem `by`, nunca com um id inventado.
 *
 * ⚠️ Lê-e-escreve (o PostgREST não faz `||` num UPDATE): duas decisões CONCORRENTES na mesma tag podem
 * perder uma chave. No painel isso não acontece — os controles ficam desabilitados enquanto uma ação
 * roda (`isPending`).
 *
 * ⚠️ Não registra VALOR: o JSON é proveniência, não uma 2ª fonte de verdade.
 */
export async function humanDecisionPatches(
  supabase: Admin,
  tagIds: string[],
  fields: HumanDecisionField[],
): Promise<{ ok: true; patches: Map<string, HumanDecisions> } | { ok: false; error: string }> {
  if (tagIds.length === 0) return { ok: true, patches: new Map() }
  const { data, error } = await supabase.from("tags").select("id, human_decisions").in("id", tagIds)
  if (error) return { ok: false, error: `não consegui ler a proveniência da tag (${error.message})` }
  const rows = (data ?? []) as Array<{ id: string; human_decisions: unknown }>
  if (rows.length !== new Set(tagIds).size) return { ok: false, error: "tag não encontrada" }

  const by = await getSessionUserId()
  const carimbo = by ? { at: new Date().toISOString(), by } : { at: new Date().toISOString() }
  const patches = new Map<string, HumanDecisions>()
  for (const r of rows) {
    const atual = parseHumanDecisions(r.human_decisions)
    for (const f of fields) atual[f] = carimbo
    patches.set(r.id, atual)
  }
  return { ok: true, patches }
}
