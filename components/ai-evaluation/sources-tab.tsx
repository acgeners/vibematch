"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Link2, ListChecks } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"
import { WorkQueueCard } from "@/components/ai-evaluation/queue/work-queue-card"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"
import { QueueToolbar, QueueSortSelect } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { SourceLinkDialog } from "@/components/ai-evaluation/source-link-dialog"
import { MarkAbsentAction } from "@/components/ai-evaluation/mark-absent-action"
import { sourceLabel } from "@/lib/external/source-labels"
import { MIN_USEFUL_REVIEWS_FOR_DIGEST } from "@/lib/reviews/digest-gate"
import { cn } from "@/lib/utils"
import type { SourceGapWork } from "@/server/queries/works-without-sources"
import type { ExternalSourceId } from "@/lib/external/types"

type SortField = "gaps" | "reviews" | "title" | "expected"

/**
 * Aba "Fontes" — obras cujo vínculo com alguma fonte externa NUNCA foi avaliado.
 *
 * 🔴 **A pergunta que ela responde é por FONTE, não por obra.** Medido em 2026-08-15
 * (978 obras ativas): nenhuma obra está sem vínculo nenhum e a mediana são 8 de 9
 * fontes — uma lista de "obras sem fonte" seria vazia. O que existe são 1.424 lacunas
 * concentradas em fontes específicas (kitsu 363 · MAL 338 · mangadex 251 …), e é por
 * isso que o mapa de chips vem ANTES da lista: sem ele, a única entrada seriam as 629
 * obras com ≥1 lacuna — 64% do catálogo, que é o alarme que sempre toca.
 *
 * ⚠️ **A fila é a LISTA EXIBIDA, na ordem exibida.** Filtrar por fonte e ordenar muda o
 * que "próxima" significa, e é isso que se quer: percorrer as 363 sem Kitsu é um
 * trabalho, percorrer as 7 sem review útil é outro. Com obras selecionadas, a fila são
 * só elas.
 */
export function SourcesTab({
  works,
  gapsBySource,
  totalWorks,
  withGapsCount,
  activeSource,
  activePubStatuses,
  activePersonalStatuses,
  activeInterest = [],
  activePredictionQualities = [],
  baseHref,
}: {
  works: SourceGapWork[]
  gapsBySource: Array<{ source: ExternalSourceId; missing: number }>
  totalWorks: number
  withGapsCount: number
  activeSource: ExternalSourceId | null
  activePubStatuses: string[]
  activePersonalStatuses: string[]
  activeInterest?: string[]
  activePredictionQualities?: string[]
  /** Href da aba SEM o parâmetro `source` — os chips o acrescentam. */
  baseHref: string
}) {
  const [sortField, setSortField] = useState<SortField>("gaps")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [startIndex, setStartIndex] = useState(0)

  const sorted = useMemo(() => {
    const arr = [...works]
    const mult = sortDir === "asc" ? 1 : -1
    if (sortField === "title") return arr.sort((a, b) => a.title.localeCompare(b.title, "pt-BR") * mult)
    const key = (w: SourceGapWork) =>
      sortField === "gaps" ? w.gaps.length : sortField === "reviews" ? w.usefulReviews : w.expectedScore
    return arr.sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      if (ka == null && kb == null) return 0
      if (ka == null) return 1
      if (kb == null) return -1
      return (ka - kb) * mult || a.title.localeCompare(b.title, "pt-BR")
    })
  }, [works, sortField, sortDir])

  const ids = useMemo(() => sorted.map((w) => w.id), [sorted])
  const selection = useWorkSelection(ids)

  // A fila que o diálogo percorre: as selecionadas quando há seleção, senão a lista
  // inteira como está na tela. Derivar de `sorted` (e não de `works`) é o que faz
  // "próxima" bater com o que se vê — ordenar por reviews e percorrer numa ordem
  // diferente seria a mesma classe de erro de dois critérios pro mesmo fato.
  const queue = useMemo(
    () =>
      (selection.count > 0 ? sorted.filter((w) => selection.isSelected(w.id)) : sorted).map((w) => ({
        id: w.id,
        title: w.title,
      })),
    [sorted, selection],
  )

  const openAt = (workId: string) => {
    const i = queue.findIndex((q) => q.id === workId)
    setStartIndex(i >= 0 ? i : 0)
    setDialogOpen(true)
  }

  const chipHref = (source: ExternalSourceId | null) => {
    const sep = baseHref.includes("?") ? "&" : "?"
    return source ? `${baseHref}${sep}source=${source}` : baseHref
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Uma <strong className="text-foreground">lacuna</strong> é uma fonte que nunca foi avaliada
        para a obra — não é &quot;a obra não existe lá&quot;. Fonte a mais é review a mais, e a
        relação é direta: obra sem lacuna tem <strong className="text-foreground">57 reviews úteis</strong>{" "}
        em média contra <strong className="text-foreground">7</strong> nas com 5 lacunas. A busca é{" "}
        <strong className="text-foreground">gratuita</strong> (nenhuma chamada de IA), mas leva alguns
        segundos por obra e cada match precisa da sua confirmação.
      </p>

      {/* O MAPA. Vem antes da lista porque é ele que transforma "629 obras" numa
          pergunta respondível ("quais não têm MangaDex?"). Os números são do catálogo
          inteiro e NÃO mudam com o chip ativo — senão filtrar por um zeraria os outros
          oito e a única saída visível seria limpar o filtro. */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 p-2.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Obras sem vínculo em
        </span>
        <Link
          href={chipHref(null)}
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
            activeSource == null
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          Qualquer uma ({withGapsCount})
        </Link>
        {gapsBySource.map(({ source, missing }) => (
          <Link
            key={source}
            href={chipHref(source)}
            title={`${sourceLabel(source)} — ${missing} de ${totalWorks} obras sem vínculo avaliado`}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs transition-colors",
              activeSource === source
                ? "border-primary bg-primary/10 font-medium text-primary"
                : missing === 0
                  ? "border-dashed border-border text-muted-foreground/50"
                  : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {sourceLabel(source)}{" "}
            <span className="tabular-nums font-semibold">{missing}</span>
          </Link>
        ))}
      </div>

      {/* ⚠️ Interesse é REPASSADO, não zerado: o painel desenha essa seção em toda aba,
          e passar `[]` faria o chip aceso na URL aparecer apagado enquanto a lista já
          está filtrada por ele — a mentira inversa da que a query resolve. */}
      <AiEvaluationFilters
        activeFilters={[]}
        activePubStatuses={activePubStatuses}
        activePersonalStatuses={activePersonalStatuses}
        activeSynopsisQualities={activeInterest}
        activePredictionQualities={activePredictionQualities}
        showEvalState={false}
      />

      <QueueToolbar
        count={selection.count}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clear}
        selectedIds={selection.selectedIds}
        sort={
          <QueueSortSelect
            value={sortField}
            onChange={(v) => setSortField(v as SortField)}
            options={[
              { value: "gaps", label: "Nº de lacunas" },
              { value: "reviews", label: "Reviews úteis" },
              { value: "expected", label: "Nota Prevista" },
              { value: "title", label: "Título" },
            ]}
            dir={sortDir}
            onToggleDir={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          />
        }
        idleExtras={
          <Button size="sm" onClick={() => openAt(queue[0]?.id ?? "")} disabled={queue.length === 0}>
            <ListChecks className="h-3.5 w-3.5" />
            Percorrer a fila ({queue.length})
          </Button>
        }
        selectedActions={
          <>
            {/* 🔴 O lote de ausência só aparece com um chip de fonte ATIVO: sem ele,
                "marcar como ausente" não tem sujeito — a obra tem lacuna em várias
                fontes e o lote gravaria na errada. Sem chip fica a dica de como chegar
                lá, que é melhor que um botão desabilitado sem explicação. */}
            {activeSource ? (
              <MarkAbsentAction
                workIds={selection.selectedIds}
                source={activeSource}
                onDone={selection.clear}
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                escolha uma fonte acima para marcar ausência em lote
              </span>
            )}
            <Button size="sm" onClick={() => openAt(queue[0]?.id ?? "")} disabled={queue.length === 0}>
              <ListChecks className="h-3.5 w-3.5" />
              Percorrer {queue.length} selecionada(s)
            </Button>
          </>
        }
      />

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
          {activeSource
            ? `Toda obra do catálogo já tem o vínculo com ${sourceLabel(activeSource)} avaliado. 🎉`
            : "Todo o catálogo tem as 9 fontes avaliadas. 🎉"}
        </p>
      ) : (
        <WorkQueueGrid>
          {sorted.map((w) => (
            <WorkQueueCard
              key={w.id}
              workId={w.id}
              title={w.title}
              coverUrl={w.coverUrl}
              isAdult={w.isAdult}
              userScore={w.userScore}
              expectedScore={w.expectedScore}
              publicationStatusId={w.publicationStatusId}
              hiatusKind={w.hiatusKind}
              hiatusKindConfidence={w.hiatusKindConfidence}
              publicationStatusNote={w.publicationStatusNote}
              personalStatusId={w.personalStatusId}
              tagCount={w.tagCount}
              reviewCount={w.usefulReviews}
              showCounts
              headline={<SourceGapLine work={w} />}
              state={{
                label: `${w.gaps.length} a checar`,
                // "sky" = nunca rodou / falta uma ação sua — a régua de cor de estado.
                // Âmbar seria "existe, mas os inputs mudaram", que não é o caso: aqui
                // não existe nada ainda.
                tone: "sky",
              }}
              selectable
              selected={selection.isSelected(w.id)}
              onToggleSelect={() => selection.toggle(w.id)}
              actions={
                <Button size="sm" variant="outline" onClick={() => openAt(w.id)}>
                  <Link2 className="h-3.5 w-3.5" />
                  Atribuir fontes
                </Button>
              }
            />
          ))}
        </WorkQueueGrid>
      )}

      {dialogOpen && (
        <SourceLinkDialog
          queue={queue}
          startIndex={startIndex}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </div>
  )
}

/**
 * A linha de destaque do card: quantas fontes já respondem pela obra, quais faltam e —
 * quando existe — quantas já foram decididas como ausentes.
 *
 * ⚠️ As faltantes são NOMEADAS, não contadas. O número sozinho ("faltam 3") não diz se
 * é trabalho de minutos ou uma fonte que não indexa esse tipo de obra, e é justamente
 * o nome que decide se vale abrir a fila.
 */
function SourceGapLine({ work }: { work: SourceGapWork }) {
  const scarce = work.usefulReviews < MIN_USEFUL_REVIEWS_FOR_DIGEST
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
      <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
        {work.linked.length} vinculada(s)
      </span>
      <span className="text-muted-foreground">
        · faltam <span className="text-foreground">{work.gaps.map(sourceLabel).join(", ")}</span>
      </span>
      {work.absent.length > 0 && (
        <span
          className="text-muted-foreground/70"
          title={`Marcada(s) como inexistente(s) nesta obra: ${work.absent.map(sourceLabel).join(", ")}`}
        >
          · {work.absent.length} sem a obra
        </span>
      )}
      {scarce && (
        <span
          className="text-amber-600 dark:text-amber-400"
          title={`Abaixo do piso de ${MIN_USEFUL_REVIEWS_FOR_DIGEST} reviews úteis do digest — aqui a lacuna custa evidência de verdade.`}
        >
          · evidência escassa
        </span>
      )}
    </span>
  )
}
