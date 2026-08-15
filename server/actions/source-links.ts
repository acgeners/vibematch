"use server"

// FACHADA de server actions da aba "Fontes".
//
// Um arquivo `"use server"` publica TODA função exportada como endpoint HTTP — o Next
// gera um id de action e qualquer um pode fazer POST nela, tenha ou não botão na tela.
// Por isso aqui só entra o que a UI chama; a implementação (com o gate de admin e a
// guarda que impede apagar vínculo válido) vive em `@/server/external-ids/absence`,
// que NÃO é `"use server"` e portanto não é endereçável de fora.

import { markSourcesAbsent, unmarkSourceAbsent } from "@/server/external-ids/absence"
import type { MarkAbsentResult } from "@/server/external-ids/absence"
import type { ExternalSourceId } from "@/lib/external/types"

export async function markWorksAbsentFromSource(
  workIds: string[],
  source: ExternalSourceId,
): Promise<MarkAbsentResult> {
  return markSourcesAbsent(workIds, source)
}

export async function restoreWorkSourceGap(
  workId: string,
  source: ExternalSourceId,
): Promise<{ ok: boolean; error?: string }> {
  return unmarkSourceAbsent(workId, source)
}
