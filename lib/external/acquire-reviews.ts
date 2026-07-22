import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  buildCandidateFromExternalIds,
  fetchExternalEvaluationContextForCandidate,
} from "@/lib/external/index"
import { saveWorkReviews } from "@/lib/external/persist-reviews"
import type { ExternalSourceId, SourcedReview } from "@/lib/external/types"

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
  opts: { skipPaidEnrichment?: boolean; awaitDigest?: boolean } = {},
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

    const { allReviews, failedSources } = await fetchExternalEvaluationContextForCandidate(candidate, {
      rejectedSources,
      // INCREMENTAL + ACUMULATIVO: cada fonte grava assim que resolve
      // (skipPaidEnrichment=true → só as linhas; resumo/digest pagos rodam UMA vez no
      // save final abaixo). `accumulate` = um re-fetch NUNCA remove reviews boas por
      // trazer menos numa rodada (queda transitória). Se a task for interrompida no
      // meio (~35s pro Mangago), as fontes já concluídas ficam salvas.
      onSourceReviews: (reviews) =>
        saveWorkReviews(workId, reviews, { skipPaidEnrichment: true, accumulate: true }),
    })

    // 2ª PASSADA dirigida: alguma fonte foi tentada e FALHOU (timeout/erro). O pool
    // desta rodada é um recorte — e o gate de materialidade (crescimento ≥ max(2, 20%))
    // faria o resumo/digest ignorarem a chegada tardia dessas reviews, congelando o
    // recorte como se fosse o universo. Vale re-tentar SÓ quem falhou: o motivo mais
    // comum de timeout é contenção (9 fontes em paralelo, sidecar com fila), e sozinha
    // a fonte costuma responder.
    //
    // Vai ANTES do save final de propósito: assim o enriquecimento pago roda UMA vez,
    // já sobre o pool recuperado, em vez de pagar duas.
    let recovered: SourcedReview[] = []
    if (failedSources.length > 0) {
      console.warn(
        `[acquireWorkReviews] work ${workId}: ${failedSources.join(", ")} falhou(ram) — 2ª passada dirigida`,
      )
      // Chama o coletor DIRETO, sem passar pelo contexto cacheado: o cache tem TTL de
      // 5 min e a chave é a mesma da 1ª passada, então re-entrar por lá devolveria o
      // resultado parcial de novo — um retry que não retenta nada.
      const { collectReviewsFromCandidate } = await import("@/lib/external/index")
      const retry = await collectReviewsFromCandidate(candidate, undefined, failedSources)
      recovered = retry.reviews
      console.info(
        `[acquireWorkReviews] work ${workId}: 2ª passada recuperou ${recovered.length} review(s)` +
          (retry.failedSources.length ? ` · segue faltando ${retry.failedSources.join(", ")}` : ""),
      )
    }

    // Save final do pool COMPLETO (acumulativo, idempotente com o incremental): dispara
    // o enriquecimento pago (resumo/digest) UMA vez e cobre o caso de cache-hit (onde o
    // callback incremental não roda). Vazio = no-op.
    // `awaitDigest`: quem chama daqui em background e CONSOME o digest na sequência
    // (criação de obra → inferência de tags) precisa dele pronto na volta.
    // `forcePaidEnrichment`: houve recuperação tardia ⇒ fura o gate de materialidade,
    // que é justamente o que impediria essas reviews de entrarem no digest.
    const pool = [...(allReviews ?? []), ...recovered]
    await saveWorkReviews(workId, pool, {
      skipPaidEnrichment: opts.skipPaidEnrichment,
      accumulate: true,
      awaitDigest: opts.awaitDigest,
      forcePaidEnrichment: recovered.length > 0,
    })
    return pool.length
  } catch (err) {
    console.error(
      "[acquireWorkReviews] falha colhendo reviews:",
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
