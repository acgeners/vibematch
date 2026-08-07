"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * Ações REQUEST-SCOPED — o contrapeso do indicador azul.
 *
 * A régua do app tem duas cores, e elas dizem coisas opostas:
 *
 * - **Azul** (`lib/tasks-store.ts` + `top-nav-tasks.tsx`): a ação é DURÁVEL, grava
 *   no banco enquanto roda. Mora na barra superior, segue a navegação, não trava
 *   nada. Perder de vista não perde nada.
 * - **Âmbar** (este arquivo): o resultado só existe NA TELA — "Buscar dados",
 *   "Atualizar dados", desempate de cluster, sugerir grupos/pesos. Nada disso é
 *   gravado até você aplicar. Mostrar essas no indicador azul seria dizer "pode
 *   navegar" para algo que, se você navegar, se perde.
 *
 * Por isso o âmbar NÃO entra no store global: ele fica ancorado onde a ação foi
 * disparada, e avisa antes de você sair.
 *
 * 🔴 **A porta de saída depende de onde a ação mora, e isso não é intuitivo.**
 * Quatro das seis vivem em `Dialog`/`Sheet` do Radix, que são MODAIS: o scrim já
 * bloqueia clique fora, então o link da barra nem é alcançável — a porta real é
 * fechar o diálogo (Cancelar · Esc · clicar fora). Só "sugerir pesos" e a prévia
 * da sinopse canônica vivem soltas numa página, e aí sim a porta é o link.
 * Use `guardNavigation` só nesse segundo caso.
 *
 * 🔴 **Voltar/avançar do browser NÃO é coberto.** Cobrir exigiria empurrar
 * entrada falsa no histórico e interceptar `popstate`, o que quebra o botão de
 * voltar para o app inteiro. `beforeunload` cobre fechar/recarregar a aba; o
 * botão de voltar sai direto e perde o resultado.
 */

/**
 * Segundos desde que `running` virou true. Zera quando termina.
 *
 * Conta TICKS, não `Date.now() - início`: o lint do projeto (`react-hooks/purity`)
 * barra `Date.now()` no corpo do render, e guardar o instante inicial exigiria
 * chamá-lo justamente ali. O preço é subcontar se a aba for pro fundo (o browser
 * estrangula `setInterval`) — e aqui isso é aceitável, porque a faixa âmbar
 * existe exatamente para quem está olhando a tela.
 */
function useElapsedSeconds(running: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  const [wasRunning, setWasRunning] = useState(false)

  // Ajuste durante o render: o lint barra setState síncrono dentro de efeito, e
  // aqui não há sistema externo a sincronizar — é estado derivado de `running`.
  if (running !== wasRunning) {
    setWasRunning(running)
    setElapsed(0)
  }

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  return elapsed
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/**
 * Faixa âmbar ancorada, para colocar DENTRO do diálogo/painel que disparou a ação.
 *
 * Cronômetro em vez de barra determinada de propósito: nessas ações não dá pra
 * saber quantas fontes vão responder, e um progresso inventado mente pior do que
 * progresso nenhum.
 */
export function ScopedTaskStrip({
  running,
  label,
  note,
  elapsed,
  className,
}: {
  running: boolean
  /** O que está acontecendo, no gerúndio. Ex.: "Buscando em 8 fontes externas…" */
  label: string
  /** O CUSTO de sair — não repita que está rodando, isso a faixa já diz. */
  note: string
  /** Cronômetro do `useScopedGuard`, pra haver um relógio só. Sem isto, conta o próprio. */
  elapsed?: number
  className?: string
}) {
  const ownElapsed = useElapsedSeconds(running && elapsed === undefined)
  if (!running) return null
  const seconds = elapsed ?? ownElapsed

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-r-lg border-l-[3px] border-amber-500 py-2.5 pl-3.5 pr-3.5",
        "bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent",
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/20 text-amber-300">
        <Clock className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-amber-50">{label}</p>
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-px font-mono text-[11px] font-bold tabular-nums text-amber-300">
            {formatElapsed(seconds)}
          </span>
        </div>
        <p className="mt-0.5 text-[11.5px] leading-snug text-amber-100/75">{note}</p>
        <div className="relative mt-2 h-[3px] overflow-hidden rounded-full bg-amber-500/20">
          <span className="task-indeterminate-bar bg-amber-400" />
        </div>
      </div>
    </div>
  )
}

/**
 * Trava de saída. Devolve:
 * - `guard(proceed)` — chame no lugar do fechamento/navegação. Se nada estiver
 *   rodando, executa `proceed` na hora; se estiver, abre a confirmação.
 * - `guardDialog` — renderize em qualquer lugar da árvore do componente.
 * - `elapsed` — o cronômetro, pra passar ao `ScopedTaskStrip`.
 */
export function useScopedGuard({
  running,
  title,
  what,
  confirmLabel,
  guardNavigation = false,
}: {
  running: boolean
  /** Manchete da confirmação. Ex.: "Fechar agora perde a busca" */
  title: string
  /** Nome da ação, do jeito que aparece no botão. Ex.: "Atualizar dados" */
  what: string
  /** Rótulo do botão destrutivo. Ex.: "Fechar mesmo assim" */
  confirmLabel: string
  /** true só para ação SOLTA numa página (sem modal). Ver a nota no topo. */
  guardNavigation?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<{ run: () => void } | null>(null)
  const elapsed = useElapsedSeconds(running)

  const guard = useCallback(
    (proceed: () => void) => {
      if (!running) {
        proceed()
        return
      }
      setPending({ run: proceed })
    },
    [running],
  )

  // Fechar/recarregar a aba. Vale para os DOIS casos (modal e página) — o scrim
  // do Radix não protege contra isso.
  useEffect(() => {
    if (!running) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [running])

  // Clique em link interno — só para ação solta na página.
  useEffect(() => {
    if (!running || !guardNavigation) return
    const onClick = (e: MouseEvent) => {
      // Deixa passar o que o browser trataria como "abrir noutro lugar": nesses
      // casos a página atual não é abandonada, então não há o que perder.
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target
      if (!(target instanceof Element)) return
      const anchor = target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#")) return
      const url = new URL(href, window.location.href)
      // Externo sai do app: quem cobre é o `beforeunload` acima.
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return

      // Fase de CAPTURA + stopPropagation: o handler do `next/link` está no
      // próprio elemento, então interceptar na bolha chegaria tarde demais.
      e.preventDefault()
      e.stopPropagation()
      setPending({ run: () => router.push(`${url.pathname}${url.search}`) })
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [running, guardNavigation, router])

  const guardDialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent className="max-w-md border-amber-500/35">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/20 text-amber-400">
              <AlertTriangle className="size-4" />
            </span>
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            “{what}” está rodando há{" "}
            <span className="font-semibold text-foreground tabular-nums">{elapsed}s</span>. O
            resultado só existe nesta tela — saindo, ele não é salvo e você precisa rodar de novo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* "Ficar" é o PRIMÁRIO: o caminho seguro não pode ser o mais discreto.
              Por isso os papéis do Radix aparecem invertidos aqui — o `Action`
              (destrutivo) é o que abandona, e o `Cancel` é o que fica. */}
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={() => {
              const proceed = pending?.run
              setPending(null)
              proceed?.()
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
          <AlertDialogCancel className={cn(buttonVariants())}>Ficar</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { guard, guardDialog, elapsed }
}
