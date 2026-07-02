"use client"

import { useCallback, useMemo, useState } from "react"

/**
 * Estado de seleção em lote para as filas de /ai-evaluation. Compartilhado por
 * todas as abas (todas ganham checkbox + ação em lote). A seleção vive no painel
 * (client), então trocar de aba desmonta o painel e zera naturalmente.
 *
 * `ids` = os ids atualmente exibidos (pós-sort/filtro). A seleção persiste entre
 * re-renders do mesmo painel, mas `selectedIds` é sempre a interseção com o que
 * está em tela — obras que saíram por filtro não são aplicadas nem contadas.
 */
export function useWorkSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const selectedIds = useMemo(() => ids.filter((id) => selected.has(id)), [ids, selected])
  const count = selectedIds.length
  const allSelected = ids.length > 0 && count === ids.length

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => setSelected(new Set(ids)), [ids])
  const clear = useCallback(() => setSelected(new Set()), [])
  const isSelected = useCallback((id: string) => selected.has(id), [selected])
  const toggleAll = useCallback((on: boolean) => (on ? setSelected(new Set(ids)) : setSelected(new Set())), [ids])

  return { selectedIds, count, allSelected, toggle, toggleAll, selectAll, clear, isSelected }
}
