"use client"

import { useSyncExternalStore } from "react"
import Link from "next/link"
import { AlertTriangle, ExternalLink } from "lucide-react"
import type { BalanceStatus } from "@/server/queries/ai-usage"
import { balanceTone } from "@/lib/ai-usage/balance"
import { makeUsdScale } from "@/lib/format/money"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * O aviso de saldo NEGATIVO — o único estado do chrome que interrompe.
 *
 * ## Por que um modal, e só aqui
 *
 * O ponto colorido do gatilho de Curadoria depende de alguém passar o mouse por cima
 * pra dizer o que quer, e saldo negativo é a única condição em que isso não basta:
 * as chamadas de IA continuam saindo, cada uma custando dinheiro sem cobertura, e
 * um sinal que só aparece sob hover pode passar dias sem ser lido.
 *
 * 🔴 **Saldo BAIXO não abre modal, de propósito.** Âmbar informa, vermelho
 * interrompe. Um modal a cada sessão enquanto o saldo está acabando é o alarme que
 * toca por semanas até a pessoa aprender a fechá-lo sem ler — e aí ele também não
 * funciona no dia em que o saldo vira negativo de verdade. É a mesma régua do
 * `db:health` e do painel "Estado da obra": só o RARO e acionável interrompe.
 *
 * ## Uma vez por sessão do browser
 *
 * `sessionStorage`, não `localStorage`: a dispensa vale enquanto a aba viver e some
 * sozinha quando você fecha o app. Saldo negativo não se resolve com o tempo, então
 * "dispensei ontem" não pode significar "não me avise nunca mais" — mas repetir a
 * cada navegação transformaria o aviso em obstáculo.
 *
 * ⚠️ **`sessionStorage` entra por `useSyncExternalStore`, não por `useState` +
 * `useEffect`.** O servidor não enxerga o storage, então lê-lo no corpo do componente
 * faria o HTML do SSR divergir do primeiro render do cliente — a mesma quebra de
 * hidratação que a sidebar em `localStorage` custou meses
 * ([[project_sidebar_hydration_collapsed]]). O `getServerSnapshot` responde
 * "dispensado", de modo que o modal nunca faz parte do HTML inicial e aparece só
 * depois da hidratação. (A alternativa — abrir num efeito — é `setState` dentro de
 * `useEffect`, que o lint do React barra por cascatear render.)
 *
 * ⚠️ **Todo caminho de fechamento passa pelo `onOpenChange`** — X, Esc, clique fora e
 * "Agora não". Fechar por fora dele deixaria a dispensa sem gravar, e o modal
 * voltaria na página seguinte.
 */

const SESSION_KEY = "satoria.negative-balance.dismissed"

const BILLING_URL = "https://platform.claude.com/settings/billing"

/**
 * A dispensa como store externo, para o React poder assiná-la.
 *
 * É de MÓDULO de propósito: se um dia houver dois pontos montando este diálogo, os
 * dois têm que concordar sobre "já dispensei" — dois estados locais discordariam, e
 * o segundo reabriria o aviso que o primeiro acabou de fechar.
 */
const listeners = new Set<() => void>()

function subscribeDismissal(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1"
  } catch {
    // sessionStorage indisponível (modo privado, iframe restrito): mostrar o aviso é
    // melhor que engoli-lo — o pior caso é vê-lo de novo na próxima navegação.
    return false
  }
}

function writeDismissed(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1")
  } catch {
    // idem: sem persistência, o aviso reaparece na próxima navegação.
  }
  for (const notify of listeners) notify()
}

export function NegativeBalanceDialog({ balance }: { balance: BalanceStatus | null }) {
  const dismissed = useSyncExternalStore(
    subscribeDismissal,
    readDismissed,
    // No servidor não há storage nem dado de saldo: "dispensado" mantém o modal fora
    // do HTML inicial, e a hidratação o traz se for o caso.
    () => true,
  )

  const remaining = balance?.remainingUsd ?? null
  const isNegative = balanceTone(remaining) === "negative"
  // Derivado, não guardado em estado: o valor negativo não muda enquanto você olha,
  // e um `open` próprio precisaria ser sincronizado com a dispensa — dois donos do
  // mesmo fato, que é a classe de bug que este projeto mais paga.
  const open = isNegative && !dismissed

  function handleOpenChange(next: boolean) {
    // Só o fechamento é ação: abrir é consequência do saldo, não de um clique.
    if (!next) writeDismissed()
  }

  if (!balance) return null

  // Informado − gasto = restante são termos da MESMA conta e aparecem colados: uma
  // régua só, senão o dia em que o saldo é informado sai "$17,17 … 3¢" e a conta
  // para de fechar de olho. Ver `lib/format/money.ts`.
  const usd = makeUsdScale(balance.balanceUsd, balance.spentSinceUsd, remaining)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-600 ring-1 ring-rose-500/25 dark:text-rose-400">
              <AlertTriangle className="size-5" />
            </span>
            <div className="space-y-1">
              <DialogTitle>Seu saldo da Anthropic está negativo</DialogTitle>
              <DialogDescription>
                As chamadas de IA continuam saindo — agora sem cobertura.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border border-border/70 bg-muted/40 p-3 text-sm">
          <dt className="text-muted-foreground">
            Informado{balance.setAt ? ` em ${formatShortDate(balance.setAt)}` : ""}
          </dt>
          <dd className="text-right tabular-nums">{usd.format(balance.balanceUsd)}</dd>

          <dt className="text-muted-foreground">
            Gasto desde então{" "}
            <span className="text-xs">
              ({balance.callsSince.toLocaleString("pt-BR")} chamadas)
            </span>
          </dt>
          <dd className="text-right tabular-nums">−{usd.format(balance.spentSinceUsd)}</dd>

          <div className="col-span-2 my-1 h-px bg-border" />

          <dt className="font-semibold text-rose-600 dark:text-rose-400">Restante</dt>
          <dd className="text-right font-semibold text-rose-600 tabular-nums dark:text-rose-400">
            {usd.format(remaining)}
          </dd>
        </dl>

        {/* O app não consulta a Anthropic: ele subtrai o gasto do último valor
            digitado. Sem esta frase o aviso AFIRMA que a conta está zerada, o que
            pode ser falso — e mandaria você recarregar uma conta que já tem saldo. */}
        <p className="text-sm text-muted-foreground">
          Se você já recarregou, é só reinformar o valor: o app não consulta a Anthropic sozinho,
          ele subtrai o gasto do último saldo que você digitou.
        </p>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button asChild className="w-full">
            <a href={BILLING_URL} target="_blank" rel="noopener noreferrer">
              Adicionar créditos na Anthropic
              <ExternalLink className="size-4" />
            </a>
          </Button>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/curation/ai-usage" onClick={() => handleOpenChange(false)}>
              Reinformar o saldo
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => handleOpenChange(false)}
          >
            Agora não — não mostrar de novo nesta sessão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Só o dia/mês/ano — o instante exato do rebaseamento não muda nenhuma decisão aqui. */
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  })
}
