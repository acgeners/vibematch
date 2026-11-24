import { canRateReadingState } from "@/lib/reading-gate"

/**
 * 🔴 Categorias de gosto completas, com a leitura liberada, SÃO a nota da obra (regra da Ana, 22/11/2026):
 * "não é pra acontecer de ter nota das categorias e não ter nota na obra" — e elas vencem toda outra fonte,
 * inclusive a avaliação antiga por critérios (craft).
 *
 * Medido na conta da dona em 22/11: 4 obras com as 7 categorias e sem nota (a causa não está provada: o
 * histórico só registra a remoção de uma) e 8 com a nota DIFERENTE, as 8 com craft. O craft saiu da tela,
 * mas 186 das 245 obras completas ainda o têm gravado, e dois caminhos recalculam a nota dele: o "Salvar"
 * do formulário de status e a aplicação em lote de pesos da pós-leitura. Por isso a regra mora no ESCRITOR
 * do estado de leitura (`writeReadingState`/`mirrorOwnerState`), por onde passa todo caminho, e decide
 * ANTES de gravar: gravar a outra nota e corrigir depois registraria uma troca que não houve.
 *
 * Esta é a decisão pura.
 */
export interface LabelState {
  workId: string
  /** O estado DEPOIS da escrita: o do patch quando ele o traz, senão o gravado. */
  personalStatusId: number | null
  chaptersRead: number | null
  totalChapters: number | null
  /** A nota gravada hoje. */
  score: number | null
}

/** A nota das categorias da obra, se ela vale: as 7 completas e a leitura liberada. */
function labelInForce(state: LabelState, labelByWork: Map<string, number | null>): number | null {
  const label = labelByWork.get(state.workId)
  if (label == null) return null
  const ok = canRateReadingState({
    personalStatus: state.personalStatusId,
    chaptersRead: state.chaptersRead,
    totalChapters: state.totalChapters,
  })
  return ok ? label : null
}

/** As obras cuja nota gravada não é a das categorias (vazia ou diferente) — o passivo a alinhar. */
export function tasteLabelsToApply(
  states: LabelState[],
  /** A nota das categorias (`computeTasteUserScore`) por obra; ausente ou `null` = incompleta. */
  labelByWork: Map<string, number | null>,
): { workId: string; label: number; previous: number | null }[] {
  return states.flatMap((s) => {
    const label = labelInForce(s, labelByWork)
    return label == null || s.score === label ? [] : [{ workId: s.workId, label, previous: s.score }]
  })
}

/**
 * Divide uma escrita pelo que cada obra deve receber: as sem categorias valendo levam o patch como veio; as
 * outras levam a nota das categorias. Quando a gravada JÁ é ela, a nota sai do patch — nada muda nela.
 */
export function splitByTasteLabel<P extends object>(
  ids: string[],
  patch: P,
  states: LabelState[],
  labelByWork: Map<string, number | null>,
): {
  groups: { ids: string[]; patch: P }[]
  changed: string[]
  /** As obras em que a nota das categorias decidiu (mantida ou restaurada): o `user_score` do patch não entrou. */
  won: string[]
} {
  const byId = new Map(states.map((s) => [s.workId, s]))
  const groups = new Map<string, { ids: string[]; patch: P }>()
  const changed: string[] = []
  const won: string[] = []
  const add = (key: string, id: string, make: () => P) => {
    const g = groups.get(key)
    if (g) g.ids.push(id)
    else groups.set(key, { ids: [id], patch: make() })
  }
  for (const id of ids) {
    const state = byId.get(id)
    const label = state ? labelInForce(state, labelByWork) : null
    if (!state || label == null) {
      add("as-is", id, () => patch)
    } else if (state.score === label) {
      won.push(id)
      add("keep", id, () => {
        const rest = { ...patch } as Record<string, unknown>
        delete rest.user_score
        return rest as P
      })
    } else {
      changed.push(id)
      won.push(id)
      add(`label:${label}`, id, () => ({ ...patch, user_score: label }))
    }
  }
  return { groups: [...groups.values()], changed, won }
}

/** O patch mexe no que decide a nota (ela mesma, o status ou os capítulos)? Só aí vale reconferir. */
export function touchesLabelOrGate(patch: object): boolean {
  return ["user_score", "personal_status_id", "chapters_read"].some((k) => Object.prototype.hasOwnProperty.call(patch, k))
}
