"use client"

import { useState, useTransition } from "react"
import { Clock, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { useRefresh } from "@/lib/use-refresh"
import { useCan, useIsSignedIn } from "@/components/layout/admin-context"
import { createCurationRequest, cancelCurationRequest } from "@/server/actions/curation-requests"
import type { CurationRequestKind } from "@/server/queries/curation-requests"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * O rótulo diz o VERBO, a tooltip diz o CUSTO e o que muda na ficha — os dois pedidos parecem
 * intercambiáveis pelo nome, e não são: um raspa fonte externa, o outro queima tokens.
 *
 * ⚠️ `TooltipContent` já é `bg-foreground` + `text-background` (fundo invertido). Não pôr
 * `text-foreground` aqui dentro, que é como o texto some ([[project_inverted_tooltip_text_foreground]]).
 *
 * 🔴 O `TooltipProvider` vai AQUI DENTRO porque **não existe um global** neste app — cada
 * componente traz o seu (`attr-color-mode-toggle` faz igual). Sem ele o Radix não avisa: ele
 * LANÇA "`Tooltip` must be used within `TooltipProvider`" no render, o que derrubaria a página
 * inteira da obra, não só o botão.
 */
function ComTooltip({ texto, children }: { texto: React.ReactNode; children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-center">{texto}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * O lado do LEITOR da curadoria centralizada (ver `project-curadoria-centralizada-solicitacoes`).
 * O curador tem "Atualizar dados" e "✨ Avaliar"; quem não pode raspar fonte externa em produção
 * tem estes dois botões, que só enfileiram trabalho.
 *
 * Amarelo = ESPERA, deliberadamente separado do vermelho de erro (`ArchivedBanner`) e do azul de
 * marca. Nada aqui está errado — está inacabado.
 *
 * ⚠️ O trilho lateral é um `<span>` com background, não `border-l-amber-*`: a regra
 * `* { border-color }` fora de `@layer` em globals.css sobrescreve TODA utility de cor de borda
 * do Tailwind v4 neste app ([[project_border_color_utilities_dead]]).
 */

function Faixa({
  titulo,
  children,
  acoes,
}: {
  titulo: string
  children: React.ReactNode
  acoes?: React.ReactNode
}) {
  return (
    <div className="relative flex flex-wrap items-start gap-3 overflow-hidden rounded-lg border bg-amber-50 px-3.5 py-2.5 pl-5 dark:bg-amber-950/30">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-amber-400 dark:bg-amber-500/70" />
      <Clock className="mt-0.5 h-[17px] w-[17px] shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-[240px] flex-1 space-y-1">
        <p className="text-sm font-bold text-amber-900 dark:text-amber-200">{titulo}</p>
        <p className="text-sm text-amber-700 dark:text-amber-300">{children}</p>
        {acoes && <div className="flex flex-wrap gap-2 pt-1.5">{acoes}</div>}
      </div>
    </div>
  )
}

/**
 * Obra cadastrada e ainda não enriquecida (`ai_eval_status = 'pending'`).
 *
 * Sem isto, ficha vazia parece obra ruim ou app quebrado — e é o estado mais comum de obra
 * recém-criada. Não tem botão de propósito: `pending` JÁ é a fila do curador (é o que alimenta o
 * badge), então pedir seria duplicar um pedido que o estado da obra já expressa.
 *
 * ⚠️ A cópia não diz "cadastrada por você", como o mockup: `works` não tem coluna de criador,
 * e a faixa aparece pra QUALQUER pessoa que abra a obra. Afirmar autoria seria mentira pra todo
 * mundo que não a criou.
 */
export function IncompleteWorkBanner() {
  return (
    <Faixa titulo="Ficha incompleta — esperando o curador">
      Esta obra ainda não passou pelo enriquecimento. Notas, tags e o que dizem as reviews
      aparecem quando ela for processada.
    </Faixa>
  )
}

/**
 * A busca não achou nada — o beco criado por "cadastro só pela busca".
 *
 * Obra que só existe no ComicK, Mangago ou Comix é invisível para a busca de PRODUÇÃO (as três
 * ficam atrás de Cloudflare, e lá não há sidecar). Sem esta saída o leitor procuraria, não
 * acharia, e travaria — então o pedido resolve sem abrir exceção à regra.
 */
export function RequestByNameBanner({ query }: { query: string }) {
  const signedIn = useIsSignedIn()
  const canRefresh = useCan("refresh_work")
  const [enviado, setEnviado] = useState(false)
  const [isPending, startTransition] = useTransition()

  const nome = query.trim()
  // O curador não pede — ele roda a busca completa local. Anônimo não tem identidade pra pedir.
  if (!signedIn || canRefresh || !nome) return null

  const pedir = () => {
    setEnviado(true)
    startTransition(async () => {
      const r = await createCurationRequest({ kind: "create_by_name", query: nome })
      if (!r.ok) {
        setEnviado(false)
        toast.error(r.error ?? "Não consegui registrar o pedido.")
        return
      }
      toast.success("Pedido enviado ao curador.")
    })
  }

  if (enviado) {
    return (
      <Faixa titulo="Pedido enviado ao curador">
        Ele busca nas 9 fontes e cadastra “{nome}”. O curador processa em lote — a obra aparece
        na sua lista quando entrar.
      </Faixa>
    )
  }

  return (
    <Faixa
      titulo="Peça o cadastro desta obra"
      acoes={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={pedir}
          className="bg-background font-semibold text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:text-amber-200 dark:hover:bg-amber-950/50 dark:hover:text-amber-100"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Pedir cadastro de “{nome}”
        </Button>
      }
    >
      Algumas fontes não respondem por aqui. O curador busca nas 9 e cadastra — você recebe a
      obra na sua lista quando ela entrar.
    </Faixa>
  )
}

const ROTULO: Record<
  Exclude<CurationRequestKind, "create_by_name">,
  { botao: string; feito: string; ajuda: React.ReactNode }
> = {
  update_data: {
    botao: "Pedir atualização dos dados",
    feito: "Você pediu uma atualização desta obra",
    ajuda: (
      <>
        O curador rebusca nas <strong>9 fontes</strong> e atualiza capa, sinopse, capítulos e
        status de publicação. Não mexe nas notas.
      </>
    ),
  },
  review_eval: {
    botao: "Pedir revisão da avaliação",
    feito: "Você pediu uma revisão da avaliação desta obra",
    ajuda: (
      <>
        Para quando você <strong>discorda das notas</strong> dos 9 critérios. O curador reexecuta
        a avaliação de IA sobre as reviews. Não altera os dados da ficha.
      </>
    ),
  },
}

export interface PedidoAberto {
  id: string
  kind: CurationRequestKind
  /** Rótulo relativo ("hoje", "ontem", "há 3 dias") — formatado NO SERVIDOR, ver abaixo. */
  quando: string
}

/**
 * Os dois pedidos sobre obra já enriquecida, e o aviso de que um deles está em aberto.
 *
 * `quando` chega pronto do servidor em vez de ser calculado aqui: formatar data relativa no
 * render depende de "agora", que difere entre o HTML do SSR e o primeiro render do cliente —
 * exatamente a divergência que quebra hidratação (o mesmo mecanismo do colapso da sidebar em
 * `lib/sidebar-preference.ts`).
 */
export function CurationRequestActions({
  workId,
  pedidosAbertos,
  fichaIncompleta = false,
}: {
  workId: string
  pedidosAbertos: PedidoAberto[]
  /**
   * A obra ainda está `ai_eval_status = 'pending'`.
   *
   * ⚠️ Nesse estado os dois pedidos SOMEM, e isto não é detalhe estético: `pending` já é a fila
   * do curador — é o que alimenta o badge. Pedir "atualizar os dados" de uma obra que ainda nem
   * foi enriquecida cria uma segunda linha para o MESMO trabalho, que é precisamente a dupla
   * fonte de verdade que a migration 177 recusa no comentário de cabeçalho. Quem explica a
   * espera aqui é a `IncompleteWorkBanner`, sem pedir nada.
   */
  fichaIncompleta?: boolean
}) {
  const signedIn = useIsSignedIn()
  // Quem pode raspar não pede: tem os botões de verdade ("Atualizar dados", "✨ Avaliar").
  const canRefresh = useCan("refresh_work")
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  // Otimista: `refresh()` re-renderiza o server component, mas o clique tem que responder na hora.
  const [enviados, setEnviados] = useState<Set<string>>(new Set())
  const [cancelados, setCancelados] = useState<Set<string>>(new Set())

  // Anônimo não pede — o que lhe falta não é permissão, é identidade (`ensureSignedIn` recusaria).
  // O default do contexto de papel é fail-closed, então isto também cobre a janela em que o
  // chrome ainda não respondeu: nada pisca antes de saber quem é.
  if (!signedIn || canRefresh) return null

  const abertos = pedidosAbertos.filter((p) => !cancelados.has(p.id))
  const kindsAbertos = new Set([...abertos.map((p) => p.kind), ...enviados])

  const pedir = (kind: CurationRequestKind) => {
    setEnviados((s) => new Set(s).add(kind))
    startTransition(async () => {
      const r = await createCurationRequest({ kind, workId })
      if (!r.ok) {
        setEnviados((s) => {
          const next = new Set(s)
          next.delete(kind)
          return next
        })
        toast.error(r.error ?? "Não consegui registrar o pedido.")
        return
      }
      toast.success("Pedido enviado ao curador.")
      refresh()
    })
  }

  const cancelar = (id: string) => {
    setCancelados((s) => new Set(s).add(id))
    startTransition(async () => {
      const r = await cancelCurationRequest(id)
      if (!r.ok) {
        setCancelados((s) => {
          const next = new Set(s)
          next.delete(id)
          return next
        })
        toast.error(r.error ?? "Não consegui cancelar o pedido.")
        return
      }
      toast.success("Pedido cancelado.")
      refresh()
    })
  }

  const kindsPendentes = fichaIncompleta
    ? []
    : (["update_data", "review_eval"] as const).filter((k) => !kindsAbertos.has(k))

  return (
    <div className="w-full space-y-3">
      {abertos.map((p) => {
        const rotulo = ROTULO[p.kind as keyof typeof ROTULO]
        if (!rotulo) return null
        return (
          <Faixa
            key={p.id}
            titulo={rotulo.feito}
            acoes={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => cancelar(p.id)}
                title="Retira o pedido da fila do curador. Você pode pedir de novo depois."
                className="bg-background font-semibold text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:text-amber-200 dark:hover:bg-amber-950/50 dark:hover:text-amber-100"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Cancelar pedido
              </Button>
            }
          >
            {/* Sem prazo: "em breve" é promessa que o app não controla. "Processa em lote" é o
                que de fato acontece — o curador roda local, quando roda. */}
            Enviado {p.quando}. O curador processa em lote — a ficha muda sozinha quando chegar.
          </Faixa>
        )
      })}

      {kindsPendentes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {kindsPendentes.map((k) => (
            <ComTooltip key={k} texto={ROTULO[k].ajuda}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => pedir(k)}
              >
                {k === "update_data" ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {ROTULO[k].botao}
              </Button>
            </ComTooltip>
          ))}
        </div>
      )}
    </div>
  )
}
