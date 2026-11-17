import "server-only"
import { recalculateForUser } from "@/server/recalc/user-recalc"

// ═══════════════════════════════════════════════════════════════════════════════════════
// Recálculo de UMA pessoa (não o dono), agrupado por rajada.
//
// Cada recálculo lê o catálogo inteiro. Sem agrupar, dez notas rápidas nas boas-vindas eram dez
// leituras completas, todas disparadas em `after()` ao mesmo tempo. Aqui roda UMA execução por vez
// por pessoa; o pedido que chega durante a execução não abre outra: marca a pessoa, e no fim roda
// UMA execução a mais, que lê o estado mais novo. Uma rajada de N pedidos custa no máximo 2.
//
// É por processo. Com mais de uma máquina cada uma agrupa o que recebe, e continua correto: toda
// execução lê o banco no começo, então a última sempre vê o estado final.
//
// Falha só loga: quem chama roda em `after()`, depois da resposta, e não tem a quem avisar.
// ═══════════════════════════════════════════════════════════════════════════════════════

const running = new Map<string, Promise<void>>()
const pendingAgain = new Set<string>()

/**
 * Agenda o recálculo de `userId`. Devolve a promise da execução em curso (que já inclui a repetição
 * pedida durante ela), para o `after()` de quem chama esperar o fim.
 *
 * ⚠️ Nunca para o dono: `recalculateForUser` recusa e o erro só iria para o log. O dono marca a
 * pendência global (`markRecalcPending`).
 */
export function scheduleUserRecalc(userId: string, context: string): Promise<void> {
  const current = running.get(userId)
  if (current) {
    pendingAgain.add(userId)
    return current
  }
  const run = (async () => {
    try {
      do {
        pendingAgain.delete(userId)
        try {
          await recalculateForUser(userId)
        } catch (err) {
          console.error(`[${context}] recalc do usuário falhou:`, err)
        }
      } while (pendingAgain.has(userId))
    } finally {
      running.delete(userId)
    }
  })()
  running.set(userId, run)
  return run
}
