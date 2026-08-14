"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Wrench } from "lucide-react"
import { getBalanceSummary } from "@/server/actions/account"
import type { BalanceStatus } from "@/server/queries/ai-usage"
import { useChromeData } from "@/lib/use-refresh"
import { alertDotTone, buildChromeAlerts } from "@/lib/curadoria/chrome-alerts"
import type { ChromeAlert } from "@/lib/curadoria/chrome-alerts"
import { totalPendingDecisions } from "@/lib/curadoria/decision-queues"
import { useChromeBadges } from "@/components/layout/chrome-badges"
import { NegativeBalanceDialog } from "@/components/layout/negative-balance-dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
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
 * 🔴 **O ponto SOZINHO não funcionou** (2026-08-14). Um círculo de 8px sem rótulo
 * provoca a pergunta "o que é isso?" e cobra uma navegação pra respondê-la; o
 * `title=` nativo dizia a frase genérica que serve pros dois problemas e não nomeia
 * nenhum. Hoje o tooltip nomeia cada um, com o número — e o texto e a COR saem da
 * mesma lista (`buildChromeAlerts`), senão o ponto vermelho e a explicação âmbar
 * discordariam sem nada acusar.
 *
 * ⚠️ **Saldo negativo não espera hover:** ver `NegativeBalanceDialog`, montado aqui
 * porque é este componente que já busca o saldo. Um componente novo com fetch
 * próprio duplicaria a chamada em toda navegação.
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

  // Uma lista só, que responde ao mesmo tempo "acende?", "de que cor?" e "dizendo o
  // quê?". O tile de saldo da Visão geral (pra onde o clique leva) deriva o tom da
  // mesma expressão — dois `remaining < 2` escritos em arquivos diferentes é como o
  // botão alerta e a página mostra verde.
  const alerts = buildChromeAlerts({ remainingUsd: balance?.remainingUsd, comixHealth })
  const dotTone = alertDotTone(alerts)
  const pending = totalPendingDecisions({ curadoria, requests })

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
    <>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/curadoria"
              // `aria-current="page"` só na PRÓPRIA `/curadoria`. O destaque visual é largo de
              // propósito (o botão é a porta do modo, fica aceso lá dentro), mas anunciar
              // "página atual" em `/settings` num link que leva pra outro lugar é mentira pra
              // quem navega por leitor de tela.
              aria-current={pathname === "/curadoria" ? "page" : undefined}
              // Sem `title=`: o nativo abriria um SEGUNDO balão por cima do tooltip, com
              // o texto achatado numa linha só. O `aria-label` continua carregando tudo
              // pra leitor de tela, que não recebe o conteúdo do tooltip do Radix.
              aria-label={label(pending, alerts)}
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
              {/* Estado que não é fila não vira número: um ponto basta pra trazer o olho,
                  e o QUE ele quer dizer está no tooltip logo abaixo. */}
              {dotTone && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-0.5 right-0.5 size-2 rounded-full ring-2 ring-background",
                    dotTone === "rose" ? "bg-rose-500" : "bg-amber-500",
                  )}
                />
              )}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[280px] px-3 py-2.5">
            <p className="font-semibold">
              Curadoria do catálogo
              {pending > 0 && (
                // `text-background/70` e NUNCA `text-muted-foreground`: o tooltip é
                // invertido (`bg-foreground`), e o token de página some no tema claro.
                <span className="font-normal text-background/70">
                  {" "}
                  · {pending} esperando decisão
                </span>
              )}
            </p>
            {alerts.map((alert) => (
              <div
                key={alert.key}
                className="mt-2 flex items-start gap-2 border-t border-background/20 pt-2"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    alert.severity === "critical" ? "bg-rose-400" : "bg-amber-400",
                  )}
                />
                <span>
                  <span className="font-semibold">{alert.title}</span>
                  <br />
                  <span className="text-background/70">{alert.detail}</span>
                </span>
              </div>
            ))}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <NegativeBalanceDialog balance={balance} />
    </>
  )
}

/**
 * O rótulo acessível carrega o que o ponto não consegue dizer.
 *
 * Sem isto, o alerta de saldo/fonte seria puramente visual — invisível pra leitor de
 * tela, que é justamente quem não tem como perceber "um pontinho âmbar apareceu".
 *
 * ⚠️ Ele NOMEIA os alertas, com o mesmo texto do tooltip. A versão antiga dizia
 * "saldo ou fonte externa precisando de atenção" — uma frase que serve pros dois
 * problemas e não identifica nenhum, deixando quem usa leitor de tela exatamente
 * onde o ponto mudo deixava todo mundo.
 */
function label(pending: number, alerts: readonly ChromeAlert[]): string {
  const parts = ["Curadoria do catálogo"]
  if (pending > 0) parts.push(`${pending} esperando decisão`)
  for (const alert of alerts) parts.push(alert.title)
  return parts.join(" — ")
}
