import { Check, CircleDashed, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatUsdApprox } from "@/lib/format/money"
import { STATUS_CHIP_BASE, STATUS_TONE } from "@/lib/ui/status-tone"
import { WORK_ACTION_LABELS } from "@/lib/ui/work-action-labels"
import type { GenerateAllView, MissingPiece } from "@/lib/generate-all/work-pieces"

/**
 * O corpo do cartão que abre ao passar o mouse no "Gerar tudo" / "Refazer tudo".
 *
 * Substitui o `title=` de texto corrido, que dizia o mesmo em toda obra e não respondia à
 * pergunta de quem está diante do botão: "isto vale para ESTA obra?". Aqui ela vê o custo,
 * o que a obra já tem e qual botão resolve o que falta.
 *
 * Componente próprio, e sem hook, para ser testado por render: no jsdom o HoverCard do
 * Radix não abre.
 */
export function GenerateAllCard({ view }: { view: GenerateAllView }) {
  const { advice } = view
  const go = advice.kind === "generate" && advice.fewReviews == null
  return (
    <div className="grid gap-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <Sparkles className={cn("size-4", view.mode === "generate" ? "text-emerald-500" : "text-muted-foreground")} />
          {view.label}
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {formatUsdApprox(view.estimatedUsd)}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Busca as reviews e roda as {view.total} etapas de IA desta obra, em ordem. As notas entram sem revisão.
      </p>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Nesta obra</span>
          <span className="font-medium normal-case tracking-normal tabular-nums">
            {view.ready} de {view.total} prontas
          </span>
        </div>
        <ul className="grid gap-0.5" aria-label="Etapas do Gerar tudo nesta obra">
          {view.rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 py-0.5">
              {r.has ? (
                <Check aria-label="já tem" className={cn("size-3.5", STATUS_TONE.ok.text)} strokeWidth={2.6} />
              ) : (
                <CircleDashed aria-label="falta" className={cn("size-3.5", STATUS_TONE.pending.text)} />
              )}
              <span className={r.has ? "text-muted-foreground" : "text-foreground"}>{r.label}</span>
              <RowNote rowKey={r.key} has={r.has} reviewPending={view.reviewPending} />
            </li>
          ))}
        </ul>
      </div>

      {view.usefulReviews != null && (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            💬 {view.usefulReviews} {view.usefulReviews === 1 ? "review útil" : "reviews úteis"}
          </span>
          {view.fewReviews && <span className={cn(STATUS_CHIP_BASE, STATUS_TONE.failed.chip)}>mínimo {view.minUsefulReviews}</span>}
        </div>
      )}

      <div className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-foreground/90">
        <span
          className={cn(
            "mb-1 block text-[11px] font-semibold uppercase tracking-wide",
            go ? STATUS_TONE.ok.text : "text-muted-foreground",
          )}
        >
          {go ? "Indicado aqui" : "Melhor caminho"}
        </span>
        <Advice view={view} />
      </div>
    </div>
  )
}

function RowNote({ rowKey, has, reviewPending }: { rowKey: string; has: boolean; reviewPending: boolean }) {
  if (rowKey === "scores" && reviewPending) {
    return <span className={cn(STATUS_CHIP_BASE, STATUS_TONE.pending.chip)}>esperando revisão</span>
  }
  if (rowKey === "scores" && has) {
    return <span className="text-[11px] text-muted-foreground">seriam refeitas sem revisão</span>
  }
  if (!has) return <span className={cn(STATUS_CHIP_BASE, STATUS_TONE.pending.chip)}>falta</span>
  return null
}

function Advice({ view }: { view: GenerateAllView }) {
  const { advice } = view
  switch (advice.kind) {
    case "generate":
      return (
        <p>
          É o caso do Gerar tudo: a obra ainda não tem notas.
          {advice.fewReviews && (
            <>
              {" "}
              Mas ela tem <b className="font-semibold">{advice.fewReviews.useful} de {advice.fewReviews.min}</b> reviews
              úteis. Espere ela aparecer em “Prontas para avaliar”.
            </>
          )}
        </p>
      )
    case "review":
      return (
        <div className="grid gap-1.5">
          <p>
            Há uma avaliação esperando a sua revisão, e refazer a descartaria. Revise em{" "}
            <b className="font-semibold">Curadoria da Obra › IA Atributos</b>.
          </p>
          <MissingList missing={advice.missing} />
        </div>
      )
    case "missing":
      return (
        <div className="grid gap-1.5">
          <p>Falta {advice.missing.length === 1 ? "só esta peça" : "pouco"}. Use o botão de cada uma:</p>
          <MissingList missing={advice.missing} />
        </div>
      )
    case "complete":
      return (
        <p>
          Esta obra já tem tudo. Se as reviews mudaram, “{WORK_ACTION_LABELS.reevaluate}” na aba Análise da IA refaz só
          as notas, e com revisão.
        </p>
      )
  }
}

function MissingList({ missing }: { missing: MissingPiece[] }) {
  if (missing.length === 0) return null
  return (
    <ul className="grid gap-1">
      {missing.map((m) => (
        <li key={m.key}>
          <b className="font-semibold">{m.label}</b>:{" "}
          {m.blocked ? (
            <span className="text-muted-foreground">{m.blocked}</span>
          ) : (
            <>
              “{m.action}” {m.where}
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
