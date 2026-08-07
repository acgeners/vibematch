"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Wrench } from "lucide-react"
import { getBalanceSummary } from "@/server/actions/account"
import type { BalanceStatus } from "@/server/queries/ai-usage"
import { useChromeData } from "@/lib/use-refresh"
import { balanceAlerting, balanceTone } from "@/lib/ai-usage/balance"
import { totalPendingDecisions } from "@/lib/curadoria/decision-queues"
import { useChromeBadges } from "@/components/layout/chrome-badges"
import { cn } from "@/lib/utils"

/**
 * Janela mínima entre re-fetches do saldo por navegação. O delta otimista das mutações
 * cobre o intervalo; a navegação (passado o TTL) reconcilia a deriva entre custo
 * estimado e faturado.
 */
const BALANCE_TTL_MS = 120_000

/**
 * A PORTA da console de curadoria — um botão, não um menu.
 *
 * ## Por que deixou de ser dropdown (2026-08-07)
 *
 * Curadoria é um **modo de uso**, não uma ação pontual encaixada na navegação comum.
 * O curador também é leitor — tem lista, favoritos, obras que quer ler — mas os dois
 * focos não se intercalam: ninguém "gerencia um pouco enquanto procura o que ler".
 * Um dropdown com 6 destinos comunicava o contrário, e enfraquecia a console que já
 * existe (`components/curadoria/console-shell.tsx`) oferecendo atalhos pra dentro dela
 * a partir de qualquer tela.
 *
 * A régua da própria barra já dizia isto, e o menu a contrariava: a zona direita
 * responde **"o que está acontecendo?"** — "só o que tem número ou estado". Seis links
 * de navegação são a pergunta da zona ESQUERDA ("pra onde eu vou?"). O badge pertencia
 * ali; os destinos, não. Ver o cabeçalho de `top-nav.tsx`.
 *
 * Historicamente o menu nasceu pra consolidar três SINAIS (fila, saldo, saúde de fonte);
 * os destinos entraram de carona porque havia um dropdown à mão. Hoje os sinais moram
 * onde se age sobre eles — a Visão geral da console — e a barra fica só com o aviso.
 *
 * ## O que este botão promete
 *
 * 🔴 **O contador continua no GATILHO, e isso não é decoração.** A regra antiga ("dentro
 * de dropdown o número não é visto") sobrevive à remoção do menu: quem não entra na
 * console precisa ver, de fora, que há trabalho esperando. Some `totalPendingDecisions`
 * — a MESMA lista que a Visão geral detalha, então o número sempre tem destino.
 *
 * ⚠️ **O ponto colorido virou o único portador do alerta de saldo/fonte.** O VALOR
 * ("$3,10", "Comix instável") desceu pra `/curadoria`; aqui fica só "algo lá precisa de
 * você". Se o tile de saldo sair da Visão geral, este ponto passa a apontar pro nada —
 * ver o cabeçalho de `app/curadoria/page.tsx`.
 *
 * ⚠️ **O saldo continua sendo buscado aqui** mesmo sem ser exibido: o ponto depende do
 * tom. Trocar por "só busca dentro da console" apagaria o alerta justamente pra quem
 * está fora dela — que é o único momento em que ele serve.
 */
export function CurationMenu() {
  const pathname = usePathname()
  const { curadoria, requests, comixHealth } = useChromeBadges()
  const [balance, setBalance] = useState<BalanceStatus | null>(null)

  useChromeData(getBalanceSummary, setBalance, BALANCE_TTL_MS, (patch) => {
    if (patch.balanceDeltaUsd == null) return
    setBalance((prev) =>
      prev && prev.remainingUsd != null
        ? { ...prev, remainingUsd: prev.remainingUsd + patch.balanceDeltaUsd! }
        : prev,
    )
  })

  // Tom derivado do helper compartilhado: este ponto e o tile de saldo da Visão geral
  // (pra onde o clique leva) TÊM que concordar. Dois `remaining <= 5` escritos em
  // arquivos diferentes é como o botão alerta e a página mostra verde.
  const tone = balanceTone(balance?.remainingUsd ?? null)
  const sourcesDown = comixHealth === "down"
  const sourcesShaky = sourcesDown || comixHealth === "degraded"

  // `balanceAlerting`, não `tone === "low"`: os tons são exclusivos entre si, então um
  // saldo NEGATIVO não é "low". Enumerar apagaria o ponto no pior caso — o único em
  // que ele mais importa.
  const pending = totalPendingDecisions({ curadoria, requests })
  const alerting = balanceAlerting(tone) || sourcesShaky

  // Ativo em toda rota membro da console: o botão é a porta do MODO, então ele fica
  // aceso enquanto se está lá dentro — mesmo em `/settings`, que não tem "curadoria"
  // no caminho.
  const active =
    pathname.startsWith("/curadoria") ||
    pathname.startsWith("/ai-evaluation") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/ai-usage") ||
    pathname.startsWith("/admin/model-metrics")

  return (
    <Link
      href="/curadoria"
      // `aria-current="page"` só na PRÓPRIA `/curadoria`. O destaque visual é largo de
      // propósito (o botão é a porta do modo, fica aceso lá dentro), mas anunciar
      // "página atual" em `/settings` num link que leva pra outro lugar é mentira pra
      // quem navega por leitor de tela.
      aria-current={pathname === "/curadoria" ? "page" : undefined}
      title={label(pending, alerting)}
      aria-label={label(pending, alerting)}
      className={cn(
        "relative inline-flex h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-medium outline-none transition-colors",
        "text-violet-600 hover:bg-violet-500/10 dark:text-violet-300",
        active && "bg-violet-500/10",
      )}
    >
      <Wrench className="size-[18px]" />
      <span className="hidden xl:inline">Curadoria</span>
      {pending > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex min-w-[17px] items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold leading-[17px] text-white shadow-sm">
          {pending > 99 ? "99+" : pending}
        </span>
      )}
      {/* Estado que não é fila não vira número: um ponto basta pra trazer o olho, e o
          valor exato ("$3,10", "Comix instável") espera na Visão geral. */}
      {alerting && (
        <span
          aria-hidden
          className={cn(
            "absolute bottom-0.5 right-0.5 size-2 rounded-full ring-2 ring-background",
            tone === "negative" || sourcesDown ? "bg-rose-500" : "bg-amber-500",
          )}
        />
      )}
    </Link>
  )
}

/**
 * O rótulo acessível carrega o que o ponto não consegue dizer.
 *
 * Sem isto, o alerta de saldo/fonte seria puramente visual — invisível pra leitor de
 * tela, que é justamente quem não tem como perceber "um pontinho âmbar apareceu".
 */
function label(pending: number, alerting: boolean): string {
  const parts = ["Curadoria do catálogo"]
  if (pending > 0) parts.push(`${pending} esperando decisão`)
  if (alerting) parts.push("saldo ou fonte externa precisando de atenção")
  return parts.join(" — ")
}
