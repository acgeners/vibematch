/**
 * O limiar de "saldo baixo" e o tom derivado dele, num lugar só.
 *
 * Três superfícies opinam sobre o mesmo número: o ponto âmbar/vermelho no gatilho
 * de Curadoria, o tile de saldo da Visão geral e o card editável de `/curation/ai-usage`.
 * O `5` já estava copiado em duas delas — uma terceira cópia é exatamente como o
 * ponto do gatilho e a página pra onde ele aponta passam a discordar, sem erro e
 * sem log: o botão alerta, você entra, e o número aparece em verde.
 *
 * `balanceTone` existe pelo mesmo motivo, um nível acima: dot e tile precisam
 * derivar o tom da MESMA expressão, não de dois `remaining <= LOW` escritos
 * separadamente. O card de `/curation/ai-usage` mantém a lógica própria de propósito — ele
 * é o EDITOR do saldo (tem estado de formulário, "nunca informado", pendências de
 * submit), não uma superfície de sinal.
 */

/**
 * Abaixo disto o saldo pede atenção. Em dólares.
 *
 * ⚠️ Era 5 até 2026-08-14 (escolha da Ana). Com $5 o ponto âmbar acendia com folga
 * ainda suficiente pra dezenas de avaliações, e alarme que toca cedo demais ensina a
 * ignorar o ponto — o mesmo motivo que fez o `db:health` calar sobre escrita de
 * navegação e o painel "Estado da obra" só marcar o que é raro.
 */
export const LOW_BALANCE_USD = 2

export type BalanceTone =
  /** Saldo nunca informado — não há o que alertar, e zero não é a resposta. */
  | "unset"
  /** Folga. */
  | "ok"
  /** Acabando. */
  | "low"
  /** Estourou: as chamadas de IA já estão saindo do seu bolso sem cobertura. */
  | "negative"

export function balanceTone(remainingUsd: number | null | undefined): BalanceTone {
  if (remainingUsd == null) return "unset"
  if (remainingUsd < 0) return "negative"
  // `<`, não `<=`: o limiar é "abaixo de $2". Exatamente $2 ainda é folga.
  if (remainingUsd < LOW_BALANCE_USD) return "low"
  return "ok"
}

/** True quando o tom merece o ponto colorido no chrome. */
export function balanceAlerting(tone: BalanceTone): boolean {
  return tone === "low" || tone === "negative"
}
