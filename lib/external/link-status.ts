import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ExternalSourceId } from "@/lib/external/types"

/**
 * O que a fonte disse sobre o código vinculado de uma obra, na ÚLTIMA vez que alguém o abriu.
 * `not_found` = a página devolveu 404/410; `ok` = a página existe. Indisponível (Cloudflare,
 * timeout, erro de rede) NÃO é status: não prova nada sobre o código e nunca chega aqui.
 */
export type SourceLinkStatus = "ok" | "not_found"

/**
 * Grava o status do código vinculado (migration 222). Dono único da escrita das colunas
 * `not_found_external_id`/`not_found_at`; quem LÊ é `classifySourceLink`.
 *
 * - `not_found` marca SÓ se o vínculo ainda é aquele código (`external_id = externalId`): uma
 *   checagem lenta que termina depois de alguém colar um código novo não pode marcar o novo.
 * - `ok` limpa SÓ a marca daquele código. Nunca toca marca de outro.
 * - Nunca cria linha (é UPDATE, não upsert) e nunca lança: o erro vai para o log. Quem chama está
 *   no meio de uma checagem ou de um lote, e perder a marca é melhor que perder o resto.
 */
export async function recordSourceLinkStatus(
  workId: string,
  source: ExternalSourceId,
  externalId: string,
  status: SourceLinkStatus,
): Promise<void> {
  if (!workId || !externalId) return
  try {
    const supabase = createAdminClient()
    const { error } =
      status === "not_found"
        ? await supabase
            .from("work_external_ids")
            .update({ not_found_external_id: externalId, not_found_at: new Date().toISOString() })
            .eq("work_id", workId)
            .eq("source", source)
            .eq("external_id", externalId)
        : await supabase
            .from("work_external_ids")
            .update({ not_found_external_id: null, not_found_at: null })
            .eq("work_id", workId)
            .eq("source", source)
            .eq("not_found_external_id", externalId)
    if (error) console.error(`[link-status] ${source} ${externalId} (${status}):`, error.message)
  } catch (err) {
    console.error(`[link-status] ${source} ${externalId} (${status}):`, err instanceof Error ? err.message : err)
  }
}

/** Grava vários de uma vez (um por fonte). Fontes sem status ficam como estão. */
export async function recordSourceLinkStatuses(
  workId: string,
  statuses: Partial<Record<ExternalSourceId, { externalId: string; status: SourceLinkStatus }>>,
): Promise<void> {
  for (const [source, s] of Object.entries(statuses)) {
    if (s) await recordSourceLinkStatus(workId, source as ExternalSourceId, s.externalId, s.status)
  }
}
