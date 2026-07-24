"use client"

import { useState } from "react"
import type { ComponentProps } from "react"
import { toast } from "sonner"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { runTask } from "@/lib/tasks-store"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { UpdateDataDialog } from "@/components/titles/update-data-dialog"
import { generateAllWorkData } from "@/server/actions/generate-all"
import type { CascadeStatus, GenerateAllResult, GenerateAllOpts } from "@/lib/generate-all/types"

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
  | { kind: "cost"; estimatedUsd: number; noReviewsReason: string | null }
  | { kind: "sources"; estimatedUsd: number }
  | null

export function GenerateAllBanner({
  workId,
  workTitle,
  initialStatus,
  currentWork,
  currentCovers,
  archivedCoverUrls,
  currentSynopses,
  compact = false,
}: {
  workId: string
  workTitle: string
  initialStatus: CascadeStatus
  /** Dados atuais da obra — alimentam o passo de escolha de fontes/capas (mesmo
   *  do "Atualizar dados") que abre ANTES da cascata. */
  currentWork: UpdateDataProps["currentWork"]
  currentCovers?: UpdateDataProps["currentCovers"]
  archivedCoverUrls?: UpdateDataProps["archivedCoverUrls"]
  currentSynopses?: UpdateDataProps["currentSynopses"]
  /** Modo botão inline (linha de ações da aba Geral) em vez do banner cheio. */
  compact?: boolean
}) {
  const [status, setStatus] = useState<CascadeStatus>(initialStatus)
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
          setDialog({ kind: "cost", estimatedUsd: r.estimatedUsd, noReviewsReason: r.noReviewsReason })
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
      href: `/titles/${workId}`,
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
  const startFlow = () => setSelectOpen(true)

  const dialogs = (
    <>
      {/* Passo de escolha de fontes+capas — mesmo dialog do "Atualizar dados".
          Ao salvar, emenda a cascata do Gerar tudo. */}
      <UpdateDataDialog
        workId={workId}
        currentWork={currentWork}
        currentCovers={currentCovers}
        archivedCoverUrls={archivedCoverUrls}
        currentSynopses={currentSynopses}
        open={selectOpen}
        onOpenChange={setSelectOpen}
        hideTrigger
        withSourceStep
        onSaved={() => kickoff({}, `Verificando fontes: ${workTitle}`, "verifying_sources")}
      />

      {/* Checkpoint de custo + sem-review (mesmo padrão do ai-eval) */}
      <ConfirmDialog
        open={dialog?.kind === "cost"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Gerar todos os dados"
        description={
          dialog?.kind === "cost"
            ? `Vai gerar tudo em ordem (~$${dialog.estimatedUsd.toFixed(2)}).` +
              (dialog.noReviewsReason
                ? ` ⚠️ Sem reviews: ${NO_REVIEWS_HINT[dialog.noReviewsReason] ?? "a obra não tem reviews"}. Os atributos ficam mais fracos.`
                : "")
            : undefined
        }
        confirmText="Autorizar e gerar"
        cancelText="Cancelar"
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
        onOpenChange={(o) => !o && setDialog(null)}
        title="Fontes não confirmadas"
        description="Não consegui confirmar Comix/ComicK (pode ser o FlareSolverr fora). Pode ser infra ou a obra realmente não existe nessas fontes. Seguir mesmo assim gera com o que as outras fontes derem."
        confirmText="Seguir mesmo assim"
        cancelText="Cancelar"
        onConfirm={() => kickoff({ ignoreSourceGate: true }, `Verificando fontes: ${workTitle}`, "verifying_sources")}
      />
    </>
  )

  if (compact) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={running}
          onClick={startFlow}
          title="Escolha fontes e capas; depois gera todos os dados da obra em ordem (fontes → sinopse → tags → atributos IA → notas → embedding)."
        >
          <Sparkles className="size-4 text-emerald-500" />
          {ctaLabel(status)}
        </Button>
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
