// Store de MÓDULO com o resultado de avaliação IA que ainda espera revisão.
//
// 🔴 Existe porque o resultado morava em `useState` do `AiEvaluationButton`, e esse
// botão vive dentro de `<TabsContent value="ai">` — o Radix desmonta o conteúdo da
// aba inativa (`<Presence present={forceMount || isSelected}>`, sem `forceMount`
// aqui). A avaliação leva ~17,5s de mediana (p90 bem mais), então trocar de aba ou
// navegar enquanto ela roda é o comportamento NORMAL — e a própria tarefa azul
// convida a isso ("pode navegar, te aviso ao terminar"). Quando o `onDone` chegava
// com o componente desmontado, `setEvaluation` virava no-op silencioso: a avaliação
// ficava gravada em `review_pending` e o popup simplesmente não abria.
//
// Mesmo padrão do `lib/tasks-store.ts`: o dado vive no módulo, não na árvore, então
// sobrevive a desmontagem e à navegação client-side. Quem monta lê o pendente da
// própria obra e abre a revisão.
//
// ⚠️ A presença aqui É o "popup aberto". Um `reviewOpen` separado em estado de
// componente reintroduziria o bug pela outra metade — o resultado sobreviveria e o
// "aberto" não.

import { useSyncExternalStore } from "react"
import type { AiEvaluation } from "@/types/domain"
import type { CurrentEvaluationMeta } from "@/components/ai-evaluation/ai-evaluation-review-form"

export interface PendingAiReview {
  evaluation: AiEvaluation
  /** Notas em vigor na obra, pra coluna "Atual" do diff. */
  currentScores: Record<string, number>
  /** Avaliação que respalda as notas atuais (a anterior), não esta. */
  currentEvaluation: CurrentEvaluationMeta | null
}

let pending: Record<string, PendingAiReview> = {}
const listeners = new Set<() => void>()

function emit() {
  // Nova referência do mapa pro useSyncExternalStore detectar a mudança; os VALORES
  // seguem estáveis, que é o que o getSnapshot por obra precisa devolver.
  pending = { ...pending }
  for (const l of listeners) l()
}

export function setPendingAiReview(workId: string, data: PendingAiReview): void {
  pending[workId] = data
  emit()
}

export function clearPendingAiReview(workId: string): void {
  if (!(workId in pending)) return
  delete pending[workId]
  emit()
}

export function readPendingAiReview(workId: string): PendingAiReview | null {
  return pending[workId] ?? null
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Snapshot no servidor é sempre vazio (o store é client-side). */
const serverSnapshot = () => null

export function usePendingAiReview(workId: string): PendingAiReview | null {
  return useSyncExternalStore(subscribe, () => pending[workId] ?? null, serverSnapshot)
}
