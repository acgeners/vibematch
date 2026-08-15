import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { classifySourceLink } from "@/lib/external/source-link-state"

export interface WorkMissingComix {
  id: string
  title: string
}

export interface ComixCoverageLists {
  /** Obras ativas SEM hid do Comix e NÃO marcadas como inexistentes — pendentes de fato. */
  missing: WorkMissingComix[]
  /** Obras marcadas pelo usuário como "não existem no Comix" (marcador da mig 038). */
  absent: WorkMissingComix[]
  /** Total de obras ativas (não arquivadas) no catálogo. Base do strip de cobertura;
   *  `com hid Comix` = total − missing − absent (derivado no cliente, reativo às ações). */
  total: number
}

/**
 * Classifica o catálogo ativo em 3 estados frente ao Comix, a partir de
 * `work_external_ids` (source='comix'):
 *   - ATIVO    → is_rejected=false E external_id preenchido (hid válido; reviews funcionam)
 *   - AUSENTE  → is_rejected=true  E external_id NULL ("não existe no Comix" — semântica da
 *                migration 038: rejeitado sem match válido). Marcado à mão em /settings.
 *   - PENDENTE → sem linha, ou linha que não é nem ativa nem ausente (ex.: rejeitou um
 *                candidato específico mas ainda cabe um hid certo).
 *
 * Só PENDENTE conta como "a resolver" (badge da sidebar/tópico e contador do card). AUSENTE
 * sai da contagem — mas fica listável pra restaurar. Memoizado por request (`cache`), então
 * a page (que precisa das duas listas) e o badge (só do count) compartilham uma leitura.
 *
 * Pagina os dois selects: o catálogo ativo já está perto de 1000 linhas e o `select` do
 * Supabase corta em 1000 SEM avisar — truncar aqui esconderia obras da análise (elas
 * sumiriam de "pendente" em silêncio).
 */
const loadComixCoverage = cache(async (): Promise<ComixCoverageLists> => {
  const supabase = createAdminClient()
  const [works, comixRows] = await Promise.all([
    fetchAllRows<{ id: string; title: string | null }>(
      (from, to) =>
        supabase.from("works").select("id, title").eq("is_archived", false).order("title").range(from, to),
      "loadComixCoverage.works",
    ),
    fetchAllRows<{ work_id: string; external_id: string | null; is_rejected: boolean }>(
      (from, to) =>
        supabase
          .from("work_external_ids")
          .select("work_id, external_id, is_rejected")
          .eq("source", "comix")
          .range(from, to),
      "loadComixCoverage.comix",
    ),
  ])

  // 🔴 A leitura dos 3 estados é `classifySourceLink` — DONO ÚNICO, compartilhado com a
  // fila da aba "Fontes" (`getSourceGapQueue`), que faz o mesmo pras 9 fontes. Eram duas
  // cópias do mesmo `if`, e duas telas discordando sobre a mesma obra é a classe de erro
  // mais cara daqui: a aba diria "pendente" e este card diria "resolvida", sem erro.
  const active = new Set<string>()
  const absent = new Set<string>()
  for (const r of comixRows) {
    const state = classifySourceLink(r)
    if (state === "linked") active.add(r.work_id)
    else if (state === "absent") absent.add(r.work_id)
  }

  const missing: WorkMissingComix[] = []
  const absentList: WorkMissingComix[] = []
  for (const w of works) {
    if (active.has(w.id)) continue
    const item = { id: w.id, title: w.title ?? "" }
    if (absent.has(w.id)) absentList.push(item)
    else missing.push(item)
  }
  return { missing, absent: absentList, total: works.length }
})

/**
 * Obras (ativas) pendentes de hid do Comix — sem hid ativo E sem o marcador de
 * "não existe". Usada no badge/contador de /settings e na lista de preenchimento manual.
 */
export async function getWorksMissingComixHid(): Promise<WorkMissingComix[]> {
  return (await loadComixCoverage()).missing
}

/** Listas de cobertura do Comix: pendentes de hid + marcadas como inexistentes. */
export async function getComixCoverageLists(): Promise<ComixCoverageLists> {
  return loadComixCoverage()
}
