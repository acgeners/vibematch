import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { classifySourceLink } from "@/lib/external/source-link-state"

export interface WorkMissingComix {
  id: string
  title: string
}

/** Obra com código da Comix que devolveu 404 (migration 222): tem vínculo, mas ele está morto. */
export interface WorkDeadComix extends WorkMissingComix {
  /** O código que deu 404 — o que está salvo hoje. */
  hid: string
  /** Quando o 404 foi visto por último. */
  notFoundAt: string | null
}

export interface ComixCoverageLists {
  /** Obras ativas SEM hid do Comix e NÃO marcadas como inexistentes — pendentes de fato. */
  missing: WorkMissingComix[]
  /**
   * Obras COM hid que devolve 404 (`classifySourceLink` = "dead"). Até 2026-11-12 contavam como
   * cobertas — o card dizia "100%" e "nenhuma pendente" com 12 códigos mortos.
   */
  dead: WorkDeadComix[]
  /** Obras marcadas pelo usuário como "não existem no Comix" (marcador da mig 038). */
  absent: WorkMissingComix[]
  /** Total de obras ativas (não arquivadas) no catálogo. Base do strip de cobertura;
   *  "funcionando" = total − missing − dead − absent (derivado no cliente, reativo às ações). */
  total: number
}

/**
 * Classifica o catálogo ativo em 3 estados frente ao Comix, a partir de
 * `work_external_ids` (source='comix'):
 *   - ATIVO    → is_rejected=false E external_id preenchido (hid válido; reviews funcionam)
 *   - AUSENTE  → is_rejected=true  E external_id NULL ("não existe no Comix" — semântica da
 *                migration 038: rejeitado sem match válido). Marcado à mão em /curation/settings.
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
      () => supabase.from("works").select("id, title").eq("is_archived", false),
      { orderBy: ["title"], label: "loadComixCoverage.works" },
    ),
    fetchAllRows<{
      work_id: string
      external_id: string | null
      is_rejected: boolean
      not_found_external_id: string | null
      not_found_at: string | null
    }>(
      () =>
        supabase
          .from("work_external_ids")
          .select("work_id, external_id, is_rejected, not_found_external_id, not_found_at")
          .eq("source", "comix"),
      { orderBy: ["id"], label: "loadComixCoverage.comix" },
    ),
  ])

  // 🔴 A leitura dos 3 estados é `classifySourceLink` — DONO ÚNICO, compartilhado com a
  // fila da aba "Fontes" (`getSourceGapQueue`), que faz o mesmo pras 9 fontes. Eram duas
  // cópias do mesmo `if`, e duas telas discordando sobre a mesma obra é a classe de erro
  // mais cara daqui: a aba diria "pendente" e este card diria "resolvida", sem erro.
  const active = new Set<string>()
  const absent = new Set<string>()
  const deadBy = new Map<string, { hid: string; notFoundAt: string | null }>()
  for (const r of comixRows) {
    const state = classifySourceLink(r)
    if (state === "linked") active.add(r.work_id)
    else if (state === "absent") absent.add(r.work_id)
    else if (state === "dead") deadBy.set(r.work_id, { hid: r.external_id ?? "", notFoundAt: r.not_found_at })
  }

  const missing: WorkMissingComix[] = []
  const dead: WorkDeadComix[] = []
  const absentList: WorkMissingComix[] = []
  for (const w of works) {
    if (active.has(w.id)) continue
    const item = { id: w.id, title: w.title ?? "" }
    const d = deadBy.get(w.id)
    if (d) dead.push({ ...item, ...d })
    else if (absent.has(w.id)) absentList.push(item)
    else missing.push(item)
  }
  return { missing, dead, absent: absentList, total: works.length }
})

/**
 * Quantas obras pedem ação de curadoria na Comix: sem código + código com 404. É o número do
 * badge do tópico; as duas listas do card somam exatamente isto.
 */
export async function countComixNeedingAttention(): Promise<number> {
  const c = await loadComixCoverage()
  return c.missing.length + c.dead.length
}

/** Listas de cobertura do Comix: pendentes de hid, códigos com 404 e marcadas como inexistentes. */
export async function getComixCoverageLists(): Promise<ComixCoverageLists> {
  return loadComixCoverage()
}
