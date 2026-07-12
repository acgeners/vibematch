import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  buildCandidateFromExternalIds,
  fetchExternalEvaluationContextForCandidate,
} from "@/lib/external/index"
import { saveWorkReviews } from "@/lib/external/persist-reviews"
import type { ExternalSourceId } from "@/lib/external/types"

/**
 * Adquire reviews externas de uma obra na BORDA (ex.: ao "atualizar dados") e as
 * persiste em `work_reviews` — desacoplando a aquisição (cara/frágil, scraping)
 * do consumo (a avaliação). Roda o scraping uma vez aqui; a obra passa a exibir
 * reviews na própria página sem esperar uma avaliação.
 *
 * Só percorre o caminho por IDs ACEITOS (`fetchExternalEvaluationContextForCandidate`).
 * Obra sem IDs aceitos → no-op: NÃO faz title-search na borda (caro e ambíguo;
 * a avaliação ainda pode cair no fallback por título quando rodar). Persistência
 * é não-destrutiva (merge por fonte em `saveWorkReviews`), então uma fonte que
 * falhe nesta rodada não apaga o que já havia.
 *
 * Best-effort: qualquer falha loga e retorna 0. Pensado pra rodar em background
 * (Next `after()`) — não deve lançar para o chamador.
 *
 * @returns tamanho do pool de reviews colhido nesta rodada (0 se pulou/falhou).
 */
export async function acquireAndPersistWorkReviews(
  workId: string,
  opts: { skipPaidEnrichment?: boolean } = {},
): Promise<number> {
  if (!workId) return 0
  try {
    const supabase = createAdminClient()

    const { data: work } = await supabase
      .from("works")
      .select("title, original_title, alternative_titles")
      .eq("id", workId)
      .maybeSingle()
    if (!work?.title) return 0

    const { data: extIds } = await supabase
      .from("work_external_ids")
      .select("source, external_id, is_rejected")
      .eq("work_id", workId)
    const rejectedSources = (extIds ?? [])
      .filter((row) => row.is_rejected === true)
      .map((row) => row.source as string)
    const acceptedExternalIds = Object.fromEntries(
      (extIds ?? [])
        .filter((row) => row.is_rejected !== true && row.external_id)
        .map((row) => [row.source, String(row.external_id)]),
    ) as Partial<Record<ExternalSourceId, string>>

    // Sem IDs aceitos: não scrapeia por título na borda (custo/ambiguidade).
    if (Object.keys(acceptedExternalIds).length === 0) return 0

    const candidate = buildCandidateFromExternalIds(
      {
        title: work.title,
        originalTitle: work.original_title ?? undefined,
        alternativeTitles: work.alternative_titles ?? [],
      },
      acceptedExternalIds,
    )

    const { allReviews } = await fetchExternalEvaluationContextForCandidate(candidate, {
      rejectedSources,
      // INCREMENTAL + ACUMULATIVO: cada fonte grava assim que resolve
      // (skipPaidEnrichment=true → só as linhas; resumo/digest pagos rodam UMA vez no
      // save final abaixo). `accumulate` = um re-fetch NUNCA remove reviews boas por
      // trazer menos numa rodada (queda transitória). Se a task for interrompida no
      // meio (~35s pro Mangago), as fontes já concluídas ficam salvas.
      onSourceReviews: (reviews) =>
        saveWorkReviews(workId, reviews, { skipPaidEnrichment: true, accumulate: true }),
    })

    // Save final do pool COMPLETO (acumulativo, idempotente com o incremental): dispara
    // o enriquecimento pago (resumo/digest) UMA vez e cobre o caso de cache-hit (onde o
    // callback incremental não roda). Vazio = no-op.
    await saveWorkReviews(workId, allReviews ?? [], {
      skipPaidEnrichment: opts.skipPaidEnrichment,
      accumulate: true,
    })
    return allReviews?.length ?? 0
  } catch (err) {
    console.error(
      "[acquireWorkReviews] falha colhendo reviews:",
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
