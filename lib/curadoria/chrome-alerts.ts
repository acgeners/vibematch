import type { ComixHealthState } from "@/lib/external/comix-gate"
import { LOW_BALANCE_USD, balanceTone } from "@/lib/ai-usage/balance"
import { formatUsd } from "@/lib/format/money"

/**
 * O que o ponto colorido do gatilho de Curadoria está tentando dizer — numa lista só.
 *
 * ## Por que isto existe
 *
 * O ponto nasceu MUDO de propósito: o VALOR ("−$11,10", "Comix instável") desceu pra
 * `/curadoria` e na barra ficou só "algo lá precisa de você". Na prática ninguém
 * decifra um ponto de 8px — a pergunta que ele provoca ("o que é isso?") custava uma
 * navegação pra ser respondida, e o `title=` nativo dizia a frase genérica "saldo ou
 * fonte externa precisando de atenção", que serve pros dois problemas e não nomeia
 * nenhum.
 *
 * 🔴 **A COR e o TEXTO saem da mesma lista.** São duas coisas afirmando o mesmo fato,
 * e a régua do projeto manda uma ser DERIVADA da outra: `alertDotTone` reduz os
 * mesmos alertas que o tooltip imprime. Um `if` de cor escrito à parte no componente
 * é como o ponto fica vermelho e o texto explica só o problema âmbar — plausível,
 * errado, sem erro nem log. Mesma armadilha do `LOW_BALANCE_USD` e do
 * `STRONG_TAG_WEIGHT`.
 *
 * ⚠️ **A lista é COMPLETA, nunca "o pior".** Um ponto pode representar dois problemas
 * ao mesmo tempo (saldo negativo E Comix fora do ar). Se o tooltip mostrasse só o mais
 * grave, resolver aquele apagaria o alerta do outro sem que ele tivesse sido resolvido
 * — o ponto some e o problema fica.
 */

export type ChromeAlertSeverity = "warn" | "critical"

export interface ChromeAlert {
  key: "balance" | "comix"
  severity: ChromeAlertSeverity
  /** Primeira linha: o que é, com o número quando existe. */
  title: string
  /** Segunda linha: a consequência prática de deixar como está. */
  detail: string
}

interface ChromeAlertInput {
  remainingUsd: number | null | undefined
  comixHealth: ComixHealthState
}

export function buildChromeAlerts({ remainingUsd, comixHealth }: ChromeAlertInput): ChromeAlert[] {
  const alerts: ChromeAlert[] = []

  // `balanceTone`, nunca `remaining < X` escrito aqui: os tons são exclusivos entre
  // si, e enumerá-los de novo é como um saldo NEGATIVO deixa de ser alerta por não
  // ser "low" — apagando o ponto justamente no pior caso.
  const tone = balanceTone(remainingUsd)
  if (tone === "negative") {
    alerts.push({
      key: "balance",
      severity: "critical",
      title: `Saldo da Anthropic: ${formatUsd(remainingUsd)}`,
      detail: "As chamadas de IA estão saindo sem cobertura.",
    })
  } else if (tone === "low") {
    alerts.push({
      key: "balance",
      severity: "warn",
      title: `Saldo da Anthropic: ${formatUsd(remainingUsd)}`,
      detail: `Abaixo de ${formatUsd(LOW_BALANCE_USD)} — recarregue antes do próximo lote.`,
    })
  }

  if (comixHealth === "down") {
    alerts.push({
      key: "comix",
      severity: "critical",
      title: "Comix: fora do ar",
      detail: "Reviews e detalhes não estão entrando nas avaliações.",
    })
  } else if (comixHealth === "degraded") {
    alerts.push({
      key: "comix",
      severity: "warn",
      title: "Comix: instável",
      detail: "Parte das coletas de review está falhando.",
    })
  }

  return alerts
}

/**
 * A cor do ponto: vermelho se QUALQUER alerta é crítico, âmbar se há algum, nada se
 * não há nenhum. Derivada da lista acima — ver o 🔴 do topo.
 */
export function alertDotTone(alerts: readonly ChromeAlert[]): "rose" | "amber" | null {
  if (alerts.length === 0) return null
  return alerts.some((a) => a.severity === "critical") ? "rose" : "amber"
}
