"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogIn } from "lucide-react"
import { cn } from "@/lib/utils"
import { useChromeBadges } from "@/components/layout/chrome-badges"
import { AccountChip } from "@/components/layout/account-chip"
import { CurationMenu } from "@/components/layout/curation-menu"
import { useIsAdmin, useIsSignedIn } from "@/components/layout/admin-context"
import { RecalcPendingControl } from "@/components/recalc/recalc-pending-control"
import { LogoMark } from "@/components/ui/logo-mark"
import { GlobalSearch } from "@/components/search/global-search"
import { TasksChip, TasksProgressBar } from "@/components/tasks/top-nav-tasks"
import type { SearchEntry } from "@/server/queries/search-index"

interface NavLink {
  href: string
  label: string
  /**
   * Exige sessão. Não é só "some pra visitante": é a regra de que **destino que não
   * funciona pra quem está vendo não ocupa vaga**. `/recommendations` é per-user do
   * topo ao rodapé (histórico, chats, perfil de gosto) e `/ranking` ordena pela Nota
   * Prevista e lê presets de filtro — sem sessão, as duas entregam tela vazia ou o
   * modelo de outra pessoa, que é a família do [[gotcha-anonimo-vira-dono]].
   */
  requiresSignedIn?: boolean
}

/**
 * A barra de navegação do app.
 *
 * ## A régua: quatro perguntas, quatro lugares
 *
 * | Zona | Pergunta | O que entra |
 * |---|---|---|
 * | Esquerda | "pra onde eu vou?" | destinos, máx. 5, **todos planos** |
 * | Centro | "onde está aquilo?" | a busca (⌘K), elástica |
 * | Direita | "o que está acontecendo?" | só o que tem **número ou estado** |
 * | Avatar | "coisas minhas" | conta, preferências, importar, painel, pendências |
 *
 * A régua anterior ("o topo é sobre obras, o avatar é sobre você") quebrava no primeiro
 * item: "Minha lista" era sobre VOCÊ e morava no topo — e sem critério visível ninguém
 * sabia dizer o que subia e o que ficava escondido.
 *
 * ## O que mudou em 2026-08-07, e por quê
 *
 * - **Sem dropdown de destino.** "Minha lista ▾" enterrava Acompanhamento e Favoritos
 *   (os destinos nº 1 e nº 2) um clique abaixo, e "Explorar ▾" abria um menu de UM item.
 * - **O logo é o Início.** Libera a 5ª vaga; ele ganha `aria-current` e estado ativo.
 *   "Início" segue na busca (⌘K) e na bottom-nav do mobile.
 * - **A fila de recomendação existe em UM lugar só** — o menu do avatar, com o contador
 *   no gatilho. Antes aparecia duas vezes (dentro do menu e como relógio à direita).
 * - **Saldo, alerta de fontes e fila de curadoria viraram o `CurationMenu`**, com badge e
 *   ponto de alerta no gatilho. Ver o comentário lá: o badge é o que sustenta a mudança.
 *
 * ## A ordem do sacrifício (o que cede quando não cabe)
 *
 * Medido em 14 combinações de papel × largura: com o Curador em 980px e tudo ligado
 * (recalc + tarefa + saldo baixo + Comix), a barra precisa de 968px dos 978 disponíveis.
 * A ordem, do mais barato ao mais caro: rótulo do "Recalcular notas" (`xl:`) → nome no
 * avatar → rótulo de "Curadoria" (`xl:`) → a busca vira ícone (`md:`).
 *
 * 🔴 **Os destinos e os contadores NUNCA cedem.** Cortar "Recomendações" pela metade é
 * pior que qualquer alternativa, e ícone sem número é enfeite. Por isso a nav é
 * `shrink-0` e quem encolhe é a busca — na primeira versão era o contrário, e o texto
 * transbordava por cima dos vizinhos sem que nada acusasse.
 */
const NAV: NavLink[] = [
  { href: "/leitura", label: "Acompanhamento", requiresSignedIn: true },
  { href: "/favorites", label: "Favoritos", requiresSignedIn: true },
  { href: "/titles", label: "Catálogo" },
  { href: "/ranking", label: "Ranking", requiresSignedIn: true },
  { href: "/recommendations", label: "Recomendações", requiresSignedIn: true },
]

export function TopNav({ searchIndex }: { searchIndex: SearchEntry[] }) {
  const isAdmin = useIsAdmin()
  const signedIn = useIsSignedIn()
  const pathname = usePathname()

  const { recalcPending, clearRecalcPending } = useChromeBadges()

  const atHome = pathname === "/"
  const entries = NAV.filter((e) => !e.requiresSignedIn || signedIn)

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/92 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1560px] items-center gap-2 px-4 md:gap-3 md:px-7">
        {/* O logo É o Início: `aria-current` e estado ativo, senão a home vira um destino
            que só quem já sabe alcança. */}
        <Link
          href="/"
          aria-current={atHome ? "page" : undefined}
          title="Início"
          // `ring` e não `border`: utility de COR de borda é morta neste app — a regra
          // `* { border-color: hsl(var(--border)) }` fora de @layer vence tudo, e um
          // `border-transparent` vira uma borda cinza sempre visível. Medido aqui: o logo
          // aparecia emoldurado em toda rota. Ver [[project_border_color_utilities_dead]].
          className={cn(
            "flex shrink-0 items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors",
            atHome ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent",
          )}
        >
          <LogoMark className="size-9 rounded-xl shadow-md shadow-primary/25 ring-1 ring-white/10" />
          <span className="hidden text-[15px] font-bold tracking-tight sm:block">
            Sator<span className="text-primary">IA</span>
          </span>
        </Link>

        {/* Links: escondidos no mobile, onde a bottom-nav é quem navega. `shrink-0` é
            invariante, não estilo — ver "a ordem do sacrifício" acima. */}
        <nav className="ml-1 hidden shrink-0 items-center gap-0.5 md:flex" aria-label="Principal">
          {entries.map(({ href, label }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/12 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
              </Link>
            )
          })}
        </nav>

        {/* A busca é quem cede espaço — cresce até 460px e encolhe antes de qualquer
            rótulo cair. Ela é o único caminho pras dezenas de páginas fora da barra. */}
        <div className="ml-auto flex min-w-0 flex-1 justify-end md:ml-3">
          <GlobalSearch index={searchIndex} />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Tarefas em segundo plano: uma coisa que VOCÊ acabou de disparar, e o olho
              volta pra cá logo depois do clique. Ver components/tasks/top-nav-tasks.tsx. */}
          <TasksChip />

          {isAdmin && recalcPending && (
            <div className="hidden lg:block">
              <RecalcPendingControl
                pending={recalcPending}
                variant="compact"
                onDone={clearRecalcPending}
              />
            </div>
          )}

          {isAdmin && <CurationMenu />}

          {/* Visitante: o convite explícito. O menu do avatar também tem "Entrar", mas
              esconder a única ação disponível atrás de um ícone de pessoa é pedir que
              alguém adivinhe que existe conta. */}
          {!signedIn && (
            <Link
              href="/login"
              className="hidden h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:inline-flex"
            >
              <LogIn className="size-4" />
              Entrar
            </Link>
          )}

          <AccountChip compact />
        </div>
      </div>

      {/* Faixa indeterminada na borda de baixo do header. Absoluta contra o <header>
          (que é `sticky`, logo posicionado), então acompanha o scroll e a navegação
          sem ocupar uma linha de layout. */}
      <TasksProgressBar />
    </header>
  )
}
