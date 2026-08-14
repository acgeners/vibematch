import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { workCardCountsRpc, getWorkTagReviewCounts } from "@/server/queries/work-card-meta"
import { pickPrimaryCover } from "@/lib/work-derived"
import { REVIEW_DIGEST_VERSION } from "@/lib/ai-recommendation/review-summarizer"
import { hasEnoughReviewsForDigest } from "@/lib/reviews/digest-gate"

/**
 * A fila do DIGEST estruturado — obras com reviews e sem digest na versão vigente.
 *
 * Substitui a contagem cega de `countReviewDigestCoverage` (que só sabia dizer
 * "125 pendentes") pela LISTA, com o número de reviews úteis de cada obra. Era o
 * que faltava pra decidir o que rodar: o painel antigo processava 10 pendentes
 * que ninguém escolhia nem via.
 *
 * 🔴 **A contagem de review é a ÚTIL (≥40 chars), pela mesma RPC que os cards das
 * outras abas usam.** A contagem CRUA (`work_reviews(count)`) inclui reviews de
 * duas palavras, que o digest descarta antes do prompt — e as duas divergem o
 * bastante pra mudar quem passa no gate: medido em 2026-08-14, o corte "<3" pega
 * 8 obras na contagem crua e 18 na útil. Um número na tela que não é o número que
 * o gate aplica é a armadilha "dois critérios pro mesmo fato".
 *
 * ⚠️ **Elegibilidade sai de `hasEnoughReviewsForDigest`, nunca de um `>= 4` aqui.**
 * A aba mostra o que o gate vai aceitar; reescrever a comparação é como a lista
 * oferece uma obra que o botão recusa.
 */

export interface DigestQueueWork {
  id: string
  title: string
  coverUrl: string | null
  publicationStatusId: number | null
  personalStatusId: number | null
  expectedScore: number | null
  isAdult: boolean
  /** Reviews ÚTEIS (≥40 chars) — a mesma medida que o gate aplica. */
  usefulReviews: number
  /** ⚠️ Vem da MESMA chamada (a RPC devolve os dois). Sem ele o card imprime
   *  "🏷 0" — o `WorkQueueCard` mostra contagens por padrão, e `undefined` vira
   *  zero na tela: uma obra com 40 tags afirmando não ter nenhuma. */
  tagCount: number
  /** Passa no piso de reviews ⇒ o botão gera. */
  eligible: boolean
  /** Por que está na fila: nunca teve digest, ou tem um de versão antiga. */
  pending: "absent" | "version"
}

export interface DigestQueueResult {
  works: DigestQueueWork[]
  /** Prontas pra rodar. É este o número da aba. */
  eligibleCount: number
  /** Na fila, mas sem reviews suficientes — precisam de "Buscar reviews" antes. */
  blockedCount: number
  /** Obras com digest na versão vigente (o denominador da cobertura). */
  doneCount: number
}

interface WorkRow {
  id: string
  title: string
  // ⚠️ Capa NÃO é coluna de `works` — mora em `work_covers` (várias por obra, com
  // `is_primary`/`position`). A 1ª versão pediu `cover_url` e a página inteira caiu
  // com "column works.cover_url does not exist": `tsc` não confere nome de coluna,
  // e a suíte não abre a página.
  work_covers: Array<{ url: string; is_primary: boolean | null; position: number | null }> | null
  publication_status_id: number | null
  is_adult: boolean | null
  review_digest: unknown
  review_digest_version: string | null
}

export async function getReviewDigestQueue(): Promise<DigestQueueResult> {
  const sb = createAdminClient()

  const rows = await fetchAllRows<WorkRow>(
    (from, to) =>
      sb
        .from("works")
        .select(
          "id, title, publication_status_id, is_adult, review_digest, review_digest_version, work_covers(url, is_primary, position)",
        )
        .eq("is_archived", false)
        .range(from, to),
    "getReviewDigestQueue",
  )

  const pendingRows = rows.filter(
    (w) => w.review_digest == null || w.review_digest_version !== REVIEW_DIGEST_VERSION,
  )
  const doneCount = rows.length - pendingRows.length

  // Contagem ÚTIL por obra. A RPC agregada resolve tudo numa chamada; o fallback
  // (`getWorkTagReviewCounts`) é escopado só aos pendentes, que é o universo desta
  // tela — varrer as duas tabelas de review inteiras aqui seria pagar pelo que a
  // aba nunca mostra.
  const ids = pendingRows.map((w) => w.id)
  const counts =
    (await workCardCountsRpc(sb, ids)) ?? (await getWorkTagReviewCounts(ids))

  const works: DigestQueueWork[] = pendingRows.map((w) => {
    const usefulReviews = counts.get(w.id)?.reviewCount ?? 0
    return {
      id: w.id,
      title: w.title,
      coverUrl: pickPrimaryCover(w.work_covers),
      publicationStatusId: w.publication_status_id,
      personalStatusId: null,
      expectedScore: null,
      isAdult: w.is_adult === true,
      usefulReviews,
      tagCount: counts.get(w.id)?.tagCount ?? 0,
      eligible: hasEnoughReviewsForDigest(usefulReviews),
      pending: w.review_digest == null ? "absent" : "version",
    }
  })

  // Mais reviews primeiro: é onde o digest tem mais material e o gasto rende mais.
  // Empate pelo título só pra a ordem não depender da ordem de chegada do banco.
  works.sort((a, b) => b.usefulReviews - a.usefulReviews || a.title.localeCompare(b.title, "pt-BR"))

  return {
    works,
    eligibleCount: works.filter((w) => w.eligible).length,
    blockedCount: works.filter((w) => !w.eligible).length,
    doneCount,
  }
}
