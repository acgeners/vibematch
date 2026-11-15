"use client"

import { useSyncExternalStore } from "react"
import type { ChapterCheckFailure } from "@/lib/reading/check-failures"

/**
 * A última checagem de capítulos da `/reading` NESTA aba: quando terminou, quantas obras olhou e
 * quais ficaram "não verificadas", com o motivo.
 *
 * Store de MÓDULO, não estado do componente, pelo mesmo motivo do `tasks-store`: a checagem roda
 * ~1 min e a pessoa pode navegar enquanto isso. Com `useState`, o resultado se perdia ao voltar à
 * página, e o "Ver motivos" do aviso, clicado em outra página, não teria o que abrir.
 *
 * ⚠️ Nada é gravado no banco (decisão de 14/11/2026, opção A): recarregar a aba apaga. O motivo
 * continua na linha `[reading-check]` do log do servidor.
 */
export interface CheckFailureItem {
  workId: string
  title: string
  failure: ChapterCheckFailure
}

export interface LastReadingCheck {
  checkedAt: string
  /** Quantas obras a checagem olhou. */
  total: number
  failures: CheckFailureItem[]
  /** A checagem inteira deu erro (não por obra): sem lista, só a linha vermelha. */
  aborted?: boolean
}

interface State {
  last: LastReadingCheck | null
  /** A lista de motivos está aberta. */
  open: boolean
}

/** O que o servidor desenha: sempre vazio. O estado do módulo no servidor seria de TODOS os visitantes. */
const INITIAL: State = { last: null, open: false }
let state: State = INITIAL
const listeners = new Set<() => void>()

function emit(next: State) {
  state = next
  for (const l of listeners) l()
}

export function setLastReadingCheck(last: LastReadingCheck): void {
  emit({ last, open: false })
}

export function setCheckFailuresOpen(open: boolean): void {
  if (state.open !== open) emit({ ...state, open })
}

export function readLastReadingCheck(): State {
  return state
}

/** Só para testes: volta ao estado inicial. */
export function resetLastReadingCheck(): void {
  emit({ last: null, open: false })
}

export function useLastReadingCheck(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => INITIAL,
  )
}
