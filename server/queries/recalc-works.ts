import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows } from "@/lib/supabase/paginate"

/** O select de `works` do recálculo global (catálogo; as colunas pessoais vêm do espelho). */
export const RECALC_WORKS_SELECT = `id, publication_status_id, total_chapters, is_archived,
         year, year_end, original_title,
         art_signal,
         category_scores(criterion_slug, score, source),
         platform_ratings(id, platform, rating, vote_count),
         work_tags(tags(name, slug, tag_group_id))`

/**
 * As obras ativas do recálculo, em ORDEM CANÔNICA (por `id`).
 *
 * 🔴 Sem `.order`, a resposta sai na ordem FÍSICA do heap, e ela muda com qualquer UPDATE —
 * inclusive um que não altera valor nenhum (medido em 2026-09-22: `year = year` numa obra a
 * levou da 1ª para a 303ª posição). E o recálculo DEPENDE da ordem: os folds de CV
 * (`kFoldIndices`) são sorteados por POSIÇÃO no array, e decidem o α do Ridge da Nota Prevista,
 * os pesos inferidos, o blend, o Chance e a arte. Medido sobre um snapshot da nuvem, só trocar
 * a ordem das mesmas 1.027 obras movia a Nota Prevista em até 0,12, a Nota.IA em até 0,44, o
 * Chance em até 1,76 e o percentil de arte em até 0,64 — mesmos dados, notas diferentes.
 *
 * ⚠️ E a paginação por `.range()` sem ordem não garante nem o CONJUNTO: cada página é uma
 * query separada, e uma linha que muda de lugar entre elas sai duplicada ou some. Com `id`
 * (chave única) as páginas são fatias disjuntas de uma sequência fixa.
 */
export function fetchRecalcWorks(supabase: Pick<SupabaseClient, "from">, page = 1000): Promise<unknown[]> {
  return fetchAllRows<unknown>(
    (from: number, to: number) =>
      supabase
        .from("works")
        .select(RECALC_WORKS_SELECT)
        .eq("is_archived", false)
        .order("id", { ascending: true })
        .range(from, to),
    "recalculateAll.works",
    page,
  )
}
