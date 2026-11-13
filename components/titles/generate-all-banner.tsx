"use client"

import { useState } from "react"
import type { ComponentProps } from "react"
import { toast } from "sonner"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { runTask } from "@/lib/tasks-store"
import { Button } from "@/components/ui/button"
import { useCan } from "@/components/layout/admin-context"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"
import { generateAllWorkData } from "@/server/actions/generate-all"
import type { CascadeStatus, GenerateAllResult, GenerateAllOpts } from "@/lib/generate-all/types"
import { formatUsdApprox } from "@/lib/format/money"
import { describeFewReviews } from "@/lib/ai-evaluation/eval-evidence"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { GenerateAllCard } from "@/components/titles/generate-all-card"
import { describeGenerateAll, type GenerateAllWorkState } from "@/lib/generate-all/work-pieces"
import { restingCascadeStatus } from "@/lib/generate-all/status"

// Reaproveita os tipos do dialog de "Atualizar dados" (interfaces internas não
// exportadas) — o passo de escolha de fontes+capas do "Gerar tudo" é o mesmo dialog.
type UpdateDataProps = ComponentProps<typeof UpdateDataDialog>

const NO_REVIEWS_HINT: Record<string, string> = {
  no_external_ids: "A obra não tem fontes externas aceitas.",
  all_rejected: "Todas as fontes foram rejeitadas.",
  search_miss: "A busca não encontrou a obra nas fontes.",
  sources_returned_empty: "As fontes responderam, mas sem reviews.",
}

type Dialog =
  | {
      kind: "cost"
      estimatedUsd: number
      noReviewsReason: string | null
      /** Menos de 4 reviews úteis: a confirmação vira a pergunta das poucas reviews. */
      fewReviews?: { useful: number; total: number }
    }
  | { kind: "sources"; estimatedUsd: number }
  | null

export function GenerateAllBanner({
  workId,
  workTitle,
  initialStatus,
  currentWork,
  currentCovers,
  archivedCovers,
  currentSynopses,
  workState,
  compact = false,
}: {
  workId: string
  workTitle: string
  initialStatus: CascadeStatus
  /** Dados atuais da obra — alimentam o passo de escolha de fontes/capas (mesmo
   *  do "Atualizar dados") que abre ANTES da cascata. */
  currentWork: UpdateDataProps["currentWork"]
  currentCovers?: UpdateDataProps["currentCovers"]
  archivedCovers?: UpdateDataProps["archivedCovers"]
  currentSynopses?: UpdateDataProps["currentSynopses"]
  /**
   * O que a obra já tem (`lib/generate-all/work-pieces.ts`). Com ele o botão vira
   * "Refazer tudo", discreto, quando a obra já tem notas, e abre o cartão com o que falta.
   * Sem ele (dado não carregado), o botão fica como sempre foi.
   */
  workState?: GenerateAllWorkState | null
  /** Modo botão inline (linha de ações da aba Geral) em vez do banner cheio. */
  compact?: boolean
}) {
  // A cascata é IA que ESCREVE no catálogo (`curate_ai`) e raspa fonte externa — as duas coisas
  // que a curadoria centralizada põe no curador. `generateAllWorkData` já recusa por
  // `ensureAdmin()`, então isto não é proteção: é parar de OFERECER um clique que o servidor
  // nega. O leitor via "Gerar tudo" ao lado de "Pedir atualização dos dados" — um pedindo
  // favor, o outro prometendo fazer sozinho a mesma coisa.
  const canCurateAi = useCan("curate_ai")

  const [status, setStatus] = useState<CascadeStatus>(initialStatus)
  // Para onde o botão volta se a pergunta da cascata ficar sem resposta. O servidor já não
  // grava "aguardando autorização" (lib/generate-all/status.ts); aqui é a mesma régua na tela.
  const [resting, setResting] = useState<CascadeStatus>(() => restingCascadeStatus(initialStatus))
  const [dialog, setDialog] = useState<Dialog>(null)
  // Passo de escolha de fontes+capas (UpdateDataDialog) que precede a cascata.
  const [selectOpen, setSelectOpen] = useState(false)

  const handleResult = (r: GenerateAllResult) => {
    switch (r.status) {
      case "needs_authorization":
        setStatus("needs_authorization")
        if (r.reason === "sources_unconfirmed") {
          setDialog({ kind: "sources", estimatedUsd: r.estimatedUsd })
        } else {
          setDialog({
            kind: "cost",
            estimatedUsd: r.estimatedUsd,
            noReviewsReason: r.noReviewsReason,
            fewReviews: r.fewReviews,
          })
        }
        break
      case "blocked_manual":
        setStatus("blocked_manual")
        toast.error(r.instruction)
        break
      case "ready":
        setStatus("done")
        toast.success(`Todos os dados gerados: ${workTitle}`)
        break
      case "failed":
        setStatus("failed")
        toast.error(`Cascata parou em "${r.failed}": ${r.error}`)
        break
      default:
        break
    }
  }

  const kickoff = (opts: GenerateAllOpts, label: string, next: CascadeStatus) => {
    setDialog(null)
    setStatus(next)
    runTask<GenerateAllResult>({
      id: `generate-all:${workId}`,
      kind: "generate-all",
      label,
      href: `/catalog/${workId}`,
      run: () => generateAllWorkData(workId, opts),
      onDone: handleResult,
      onError: (e) => {
        setStatus("failed")
        toast.error(e instanceof Error ? e.message : "Falha na cascata")
      },
      successToast: () => null, // toast tratado no handleResult
    })
  }

  const running = status === "verifying_sources" || status === "generating"

  // Abre o passo de escolha (fontes → sinopse → capas → conflitos). Ao salvar,
  // `onSaved` emenda a cascata (Fase 0). Cancelar/fechar não gera nada.
  const startFlow = () => {
    setResting(restingCascadeStatus(status))
    setSelectOpen(true)
  }

  // Cancelar ou fechar a pergunta devolve o estado de antes. Confirmar também fecha o diálogo
  // (o Radix chama `onOpenChange(false)` depois do clique), mas o `kickoff` já trocou o estado
  // para "verificando"/"gerando" — por isso a troca só vale se ainda estiver aguardando.
  const closeDialog = () => {
    setDialog(null)
    setStatus((s) => (s === "needs_authorization" ? resting : s))
  }

  const dialogs = (
    <>
      {/* Passo de escolha de fontes+capas — mesmo dialog do "Atualizar dados".
          Ao salvar, emenda a cascata do Gerar tudo. */}
      <UpdateDataDialog
        workId={workId}
        currentWork={currentWork}
        currentCovers={currentCovers}
        archivedCovers={archivedCovers}
        currentSynopses={currentSynopses}
        open={selectOpen}
        onOpenChange={setSelectOpen}
        hideTrigger
        withSourceStep
        onSaved={() => kickoff({}, `Verificando fontes: ${workTitle}`, "verifying_sources")}
      />

      {/* Checkpoint de custo + sem-review + poucas reviews (mesma régua da criação) */}
      <ConfirmDialog
        open={dialog?.kind === "cost"}
        onOpenChange={(o) => !o && closeDialog()}
        title={dialog?.kind === "cost" && dialog.fewReviews ? "Poucas reviews para gerar tudo" : "Gerar todos os dados"}
        description={
          dialog?.kind === "cost"
            ? `Vai gerar tudo em ordem (${formatUsdApprox(dialog.estimatedUsd)}).` +
              (dialog.noReviewsReason
                ? ` ⚠️ Sem reviews: ${NO_REVIEWS_HINT[dialog.noReviewsReason] ?? "a obra não tem reviews"}. Os atributos ficam mais fracos.`
                : "") +
              (dialog.fewReviews
                ? ` ⚠️ ${describeFewReviews(dialog.fewReviews.useful, dialog.fewReviews.total)} Aqui as notas são aceitas sem revisão, e Interesse, Veredito e embedding saem em cima delas.`
                : "")
            : undefined
        }
        confirmText={dialog?.kind === "cost" && dialog.fewReviews ? "Gerar mesmo assim" : "Autorizar e gerar"}
        cancelText={dialog?.kind === "cost" && dialog.fewReviews ? "Deixar para depois" : "Cancelar"}
        onConfirm={() =>
          kickoff(
            {
              proceed: true,
              proceedWithoutReviews: true,
              allowPaidUsd: dialog?.kind === "cost" ? dialog.estimatedUsd : undefined,
            },
            `Gerando dados: ${workTitle}`,
            "generating",
          )
        }
      />

      {/* Fontes não confirmadas (FlareSolverr/Comix/ComicK) */}
      <ConfirmDialog
        open={dialog?.kind === "sources"}
        onOpenChange={(o) => !o && closeDialog()}
        title="Fontes não confirmadas"
        description="Não consegui confirmar Comix/ComicK (pode ser o FlareSolverr fora). Pode ser infra ou a obra realmente não existe nessas fontes. Seguir mesmo assim gera com o que as outras fontes derem."
        confirmText="Seguir mesmo assim"
        cancelText="Cancelar"
        onConfirm={() => kickoff({ ignoreSourceGate: true }, `Verificando fontes: ${workTitle}`, "verifying_sources")}
      />
    </>
  )

  // Depois de todos os hooks — retorno antecipado acima deles mudaria a ordem entre renders.
  if (!canCurateAi) return null

  if (compact) {
    const view = workState ? describeGenerateAll(workState) : null
    // Obra que já tem notas: o botão sai do primeiro plano (sem contorno, ícone cinza) e
    // diz o que faria. Só em repouso — verificando, gerando ou parado numa pergunta, o
    // estado da cascata é o que importa e o botão volta ao normal.
    const quiet = view?.mode === "redo" && (status === "idle" || status === "done")
    const button = (
      <Button
        type="button"
        variant={quiet ? "ghost" : "outline"}
        size="sm"
        disabled={running}
        onClick={startFlow}
        className={quiet ? "text-muted-foreground" : undefined}
        title={
          view
            ? undefined
            : "Escolha fontes e capas; depois gera todos os dados da obra em ordem (fontes → sinopse → tags → atributos IA → notas → embedding)."
        }
      >
        <Sparkles className={cn("size-4", quiet ? "text-muted-foreground" : "text-emerald-500")} />
        {quiet ? view.label : ctaLabel(status)}
      </Button>
    )
    return (
      <>
        {view ? (
          <HoverCard openDelay={250} closeDelay={120}>
            <HoverCardTrigger asChild>{button}</HoverCardTrigger>
            {/* Ao LADO do botão, não embaixo: o cartão tem ~520px e o botão fica no meio da tela,
                então embaixo ele não cabia e, virado pra cima, saía cortado no topo (medido a
                900px de altura). De lado, o Radix o desliza na vertical até caber; o teto de
                altura é a rede para tela baixa. */}
            <HoverCardContent
              side="right"
              align="start"
              collisionPadding={12}
              className="w-[22rem] max-w-[calc(100vw-2rem)] max-h-(--radix-hover-card-content-available-height) overflow-y-auto"
            >
              <GenerateAllCard view={view} />
            </HoverCardContent>
          </HoverCard>
        ) : (
          button
        )}
        {status === "blocked_manual" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => kickoff({ proceedWithoutComix: true }, "Verificando fontes", "verifying_sources")}
          >
            Seguir sem Comix
          </Button>
        )}
        <StatusPill status={status} />
        {dialogs}
      </>
    )
  }

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-emerald-500" />
          <span className="font-medium text-foreground">Gerar todos os dados</span>
          <StatusPill status={status} />
        </div>

        <div className="flex items-center gap-2">
          {status === "blocked_manual" && (
            <button
              type="button"
              onClick={() => kickoff({ proceedWithoutComix: true }, "Verificando fontes", "verifying_sources")}
              className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Seguir sem Comix
            </button>
          )}
          <button
            type="button"
            disabled={running}
            onClick={startFlow}
            className={cn(
              "rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-600",
              running && "opacity-50 cursor-not-allowed",
            )}
          >
            {ctaLabel(status)}
          </button>
        </div>
      </div>

      {status === "blocked_manual" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Cole o hid do Comix na obra (Revalidar fontes) — o Comix é a fonte principal de reviews. Ou{" "}
          <span className="font-medium">Seguir sem Comix</span> pra gerar com fontes reduzidas.
        </p>
      )}

      {dialogs}
    </div>
  )
}

function ctaLabel(status: CascadeStatus): string {
  switch (status) {
    case "verifying_sources":
      return "Verificando…"
    case "generating":
      return "Gerando…"
    case "needs_authorization":
      return "Revisar e gerar"
    case "failed":
      return "Tentar de novo"
    case "done":
      return "Gerar de novo"
    default:
      return "Gerar tudo"
  }
}

function StatusPill({ status }: { status: CascadeStatus }) {
  const map: Record<CascadeStatus, { label: string; cls: string } | null> = {
    idle: null,
    verifying_sources: { label: "verificando fontes", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
    blocked_manual: { label: "falta hid do Comix", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    needs_authorization: { label: "aguardando autorização", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    generating: { label: "gerando", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
    done: { label: "concluído", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
    failed: { label: "falhou", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
  }
  const pill = map[status]
  if (!pill) return null
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", pill.cls)}>{pill.label}</span>
}
