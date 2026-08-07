"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Cloud } from "lucide-react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { TaskCard } from "@/components/tasks/task-card"

/**
 * Indicador de tarefas em segundo plano na BARRA SUPERIOR (desktop).
 *
 * Por que existe: até 02-08 quem desenhava o store de tarefas no desktop era
 * `SidebarTasks`, dentro da sidebar. A sidebar saiu, e o wrapper ficou órfão —
 * o `TasksFab` que sobrou no layout é `md:hidden`. Resultado: no desktop a
 * tarefa entrava no store, com rótulo e barra, e NINGUÉM desenhava. Sobrava o
 * gerúndio do próprio botão ("Avaliando…"), que some assim que você navega.
 *
 * São duas peças, de propósito, e cada uma resolve um problema diferente:
 *
 * - `TasksProgressBar` — faixa varrendo a borda de baixo do header. Como o
 *   header é `sticky`, ela segue você por toda navegação e por todo scroll. É
 *   periférica: pega o olho sem cobrir conteúdo. Não diz O QUE roda.
 * - `TasksChip` — o endereço fixo, com contador, que abre o `TaskCard` (rótulo
 *   da obra, link pro resultado). Ele ABRE SOZINHO por alguns segundos quando
 *   uma tarefa nova começa: é o instante em que o olho ainda está no botão que
 *   você acabou de clicar. Depois recolhe e vira só o sinal periférico.
 *
 * Conclusão NÃO reabre a prévia: quem avisa que terminou é o toast do
 * `runTask` (com ação "Ver"). Abrir os dois seria dizer a mesma coisa duas vezes.
 */

/** Quanto tempo a prévia fica aberta sozinha ao começar uma tarefa. */
const PREVIEW_MS = 4500

export function TasksProgressBar() {
  const tasks = useAppTasks()
  if (tasks.length === 0) return null

  const running = tasks.some((t) => t.status === "running")
  const errored = tasks.some((t) => t.status === "error")

  return (
    <div
      aria-hidden
      className={cn(
        // `-bottom-px` cobre a própria borda do header: a faixa fica na linha
        // que separa a barra do conteúdo, sem empurrar layout nenhum.
        "pointer-events-none absolute inset-x-0 -bottom-px h-[3px] overflow-hidden",
        running ? "bg-sky-500/15" : errored ? "bg-rose-500/15" : "bg-emerald-500/20",
      )}
    >
      {running ? (
        <span className="task-indeterminate-bar bg-gradient-to-r from-transparent via-sky-400 to-transparent" />
      ) : (
        <span className={cn("absolute inset-0", errored ? "bg-rose-400/70" : "bg-emerald-400/70")} />
      )}
    </div>
  )
}

export function TasksChip() {
  const tasks = useAppTasks()
  // "closed" | "preview" (abriu sozinha, recolhe) | "pinned" (o usuário abriu).
  // Os dois modos abertos existem separados porque só a prévia expira sozinha —
  // com um booleano só, clicar no chip fecharia em 4,5s na cara do usuário.
  const [mode, setMode] = useState<"closed" | "preview" | "pinned">("closed")
  const [announced, setAnnounced] = useState<string[]>([])

  const runningIds = tasks.filter((t) => t.status === "running").map((t) => t.id)
  const liveIds = tasks.map((t) => t.id)
  const fresh = runningIds.filter((id) => !announced.includes(id))
  // Esquecer o que saiu do store é obrigatório: sem isso, re-disparar a MESMA
  // tarefa depois (mesmo `id` — o caso do "avaliar mesmo assim") nunca mais
  // abriria a prévia.
  const kept = announced.filter((id) => liveIds.includes(id))

  // Ajuste durante o render, e não num efeito: o lint do projeto barra setState
  // síncrono dentro de efeito, e aqui não há sistema externo a sincronizar — é
  // estado derivado de `tasks`. Converge no render seguinte (aí `fresh` está
  // vazio e `kept` já bate com `announced`).
  if (fresh.length > 0) {
    setAnnounced([...kept, ...fresh])
    setMode("preview")
  } else if (kept.length !== announced.length) {
    setAnnounced(kept)
  }

  useEffect(() => {
    if (mode !== "preview") return
    const timer = setTimeout(() => setMode("closed"), PREVIEW_MS)
    // O timer mora NESTE efeito (e não no que detecta tarefa nova) porque em
    // StrictMode o efeito de detecção roda duas vezes: na 2ª não há nada
    // "fresh", ele sai cedo, e a prévia ficaria aberta pra sempre sem timer.
    return () => clearTimeout(timer)
  }, [mode])

  if (tasks.length === 0) return null

  const running = runningIds.length
  const errored = tasks.some((t) => t.status === "error")
  const status = running > 0 ? "running" : errored ? "error" : "done"

  const label =
    running > 0
      ? `${running} em andamento`
      : errored
        ? "Concluído com avisos"
        : tasks.length > 1
          ? "Tudo pronto"
          : "Pronto"

  const Icon = running > 0 ? Cloud : errored ? AlertTriangle : CheckCircle2

  return (
    <Popover open={mode !== "closed"} onOpenChange={(o) => setMode(o ? "pinned" : "closed")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={`Tarefas em segundo plano: ${label}`}
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 rounded-full border pl-2.5 pr-3 text-xs font-semibold transition-colors",
            status === "running" &&
              "border-sky-400/40 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25 dark:text-sky-50",
            status === "error" && "border-rose-400/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25",
            status === "done" &&
              "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25",
          )}
        >
          {status === "running" ? <PulseDot /> : <Icon className="size-3.5" />}
          {/* Em tela estreita sobra só o ponto pulsante: o contador nunca some,
              mas o texto cede espaço pros links da barra. */}
          <span className="hidden lg:inline">{label}</span>
          <span className="lg:hidden">{running > 0 ? running : ""}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[22rem] border-0 bg-transparent p-0 shadow-none"
        // A prévia abre SOZINHA. Sem isto o Radix move o foco pra dentro dela no
        // instante em que ela aparece — e devolve pro chip ao recolher, 4,5s
        // depois, quando o usuário já está digitando em outro lugar. Um
        // indicador não pode tomar o teclado de ninguém.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // 🔴 Sem isto a prévia NÃO APARECE nas ações que passam por um modal de
        // custo, que são quase todas. `PopoverContentNonModal` do Radix fecha em
        // `focusOutside` (o `preventDefault` que existe na fonte é da variante
        // MODAL), e a sequência real é: modal de custo fecha → o Radix devolve o
        // foco ao botão que o abriu → esse `focusin` cai fora da prévia recém-
        // aberta → ela fecha em milissegundos. O chip continua lá, então o
        // sintoma é "o popup não apareceu" — sem erro, sem log.
        // Clique fora e Esc continuam fechando; só o foco deixa de fechar.
        onFocusOutside={(e) => e.preventDefault()}
      >
        <TaskCard />
      </PopoverContent>
    </Popover>
  )
}

/** Ponto que pulsa enquanto há tarefa rodando (mesma linguagem do `TaskCard`). */
function PulseDot() {
  return (
    <span className="relative flex size-2 shrink-0 items-center justify-center">
      <span className="absolute inline-flex size-full rounded-full bg-sky-400/60 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-sky-300" />
    </span>
  )
}
