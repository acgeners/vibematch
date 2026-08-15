import { classifySourceLink } from "./source-link-state"
import type { ExternalSourceId } from "./types"

export interface SourceStateRow {
  work_id: string
  source: string
  external_id: string | null
  is_rejected: boolean | null
}

export interface WorkSourceSplit {
  linked: ExternalSourceId[]
  absent: ExternalSourceId[]
  gaps: ExternalSourceId[]
}

export interface SourceGapTally {
  /** Split por obra, só das obras com ≥1 lacuna E que passam no filtro de fonte. */
  perWork: Map<string, WorkSourceSplit>
  /** Nº de obras com lacuna POR fonte — do universo INTEIRO, antes do filtro. */
  gapsBySource: Array<{ source: ExternalSourceId; missing: number }>
  /** Obras com ≥1 lacuna, antes do filtro de fonte. O tamanho real da fila. */
  withGapsCount: number
}

/**
 * O núcleo da fila de "Fontes", PURO: cruza obras × fontes e diz, por obra, o que está
 * vinculado, o que foi declarado ausente e o que nunca foi avaliado.
 *
 * 🔴 **A ordem das duas operações é a invariante desta função, e ela é fácil de
 * inverter sem perceber.** `gapsBySource` e `withGapsCount` são somados sobre o universo
 * INTEIRO; o filtro por fonte só decide quem entra em `perWork`. Contar depois do filtro
 * faz o mapa da aba encolher junto com o recorte: clicar em "Kitsu" zeraria os outros
 * oito chips e a única saída visível seria limpar o filtro — a aba deixaria de ser um
 * mapa e viraria um beco. É a razão de este cálculo ser puro em vez de inline na query:
 * é ele que precisa de teste, não o `select`.
 *
 * ⚠️ **Ausência de linha é lacuna.** Por isso o laço é sobre `sources`, e não sobre as
 * linhas de `work_external_ids`: iterar as linhas só enxergaria fonte já tocada, e as
 * nunca avaliadas — que são exatamente o trabalho — sumiriam em silêncio.
 */
export function tallySourceGaps({
  workIds,
  rows,
  sources,
  filterSource = null,
}: {
  workIds: string[]
  rows: SourceStateRow[]
  sources: readonly ExternalSourceId[]
  filterSource?: ExternalSourceId | null
}): SourceGapTally {
  const sourceSet = new Set<string>(sources)
  const stateByWork = new Map<string, Map<string, ReturnType<typeof classifySourceLink>>>()
  for (const r of rows) {
    if (!sourceSet.has(r.source)) continue
    let m = stateByWork.get(r.work_id)
    if (!m) {
      m = new Map()
      stateByWork.set(r.work_id, m)
    }
    m.set(r.source, classifySourceLink(r))
  }

  const missingBySource = new Map<string, number>()
  for (const s of sources) missingBySource.set(s, 0)

  const perWork = new Map<string, WorkSourceSplit>()
  let withGapsCount = 0

  for (const id of workIds) {
    const states = stateByWork.get(id)
    const split: WorkSourceSplit = { linked: [], absent: [], gaps: [] }
    for (const s of sources) {
      const state = states?.get(s) ?? "gap"
      if (state === "linked") split.linked.push(s)
      else if (state === "absent") split.absent.push(s)
      else {
        split.gaps.push(s)
        missingBySource.set(s, (missingBySource.get(s) ?? 0) + 1)
      }
    }
    if (split.gaps.length === 0) continue
    withGapsCount += 1
    // O filtro entra AQUI — depois de somar. Ver o 🔴 do cabeçalho.
    if (filterSource && !split.gaps.includes(filterSource)) continue
    perWork.set(id, split)
  }

  return {
    perWork,
    gapsBySource: sources.map((source) => ({ source, missing: missingBySource.get(source) ?? 0 })),
    withGapsCount,
  }
}
