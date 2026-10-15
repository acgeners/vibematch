import type { ReactNode } from "react"
import type { CriterionSlug } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { bandForScore, rubricSummary, rubricTitle } from "@/lib/criteria/justification"
import { cn } from "@/lib/utils"

/**
 * As duas peças de DAR NOTA a um critério (0–10): a linha (ícone, nome, rótulo da faixa e o campo) e o
 * painel que explica a faixa. Nasceram na avaliação pós-leitura e são compartilhadas com a nota por
 * versão ("Versões da obra…"). O CAMPO fica com quem chama: cada fluxo valida a nota do seu jeito.
 */

/**
 * Painel que explica a FAIXA da nota do critério ativo — o mesmo papel da dica de estrelas em "Como foi
 * pra você?". Fica visualmente separado das linhas (trilho + moldura violeta, e o critério nomeado antes
 * do texto) porque é um campo que MUDA conforme a linha ativa: sem isso lê-se como legenda fixa do card.
 * O violeta é exclusivo desta ligação painel↔linha.
 *
 * Faixa e rótulo vêm da rubrica canônica (`criteria.ranges` via `bandForScore`/`rubricTitle`), não da
 * justificativa da IA — ver `lib/criteria/justification.ts`.
 */
export function CriterionBandReadout({
  slug,
  score,
  idleHint = "Passe o mouse num atributo pra ver o que a faixa da nota significa.",
}: {
  slug: CriterionSlug | null
  score: number
  idleHint?: string
}) {
  const info = slug ? CRITERIA_INFO[slug] : null
  const band = slug ? bandForScore(score) : null
  const title = slug && band ? rubricTitle(slug, band) : null
  const summary = slug && band ? rubricSummary(slug, band) : null
  const active = Boolean(info && band)

  return (
    <div
      aria-live="polite"
      className={cn(
        // `flex-wrap`: dentro do diálogo o card é estreito — a explicação cai pra segunda linha
        // em vez de ser cortada.
        "relative flex min-h-[42px] flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden rounded-lg py-2 pl-3.5 pr-3 text-xs",
        active
          ? "bg-violet-500/10 ring-1 ring-inset ring-violet-500/35"
          : "ring-1 ring-inset ring-border/60",
      )}
    >
      {/* Trilho: `border-<cor>` é morta neste app (regra `*` em globals.css) — a cor vem de `bg`. */}
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-[3px]", active ? "bg-violet-500" : "bg-border")}
      />
      {active && info && band ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5 font-semibold">
            <span className="text-sm leading-none" aria-hidden>
              {info.emoji}
            </span>
            <span className="truncate">{info.name}</span>
          </span>
          <span aria-hidden className="h-4 w-px shrink-0 bg-violet-500/30" />
          <span className="shrink-0 font-bold tabular-nums text-violet-600 dark:text-violet-300">
            {band}
          </span>
          {title && (
            <span className="shrink-0 font-semibold text-violet-600 dark:text-violet-300">
              {title}
            </span>
          )}
          {/* Duas rubricas passam de 130 caracteres (couple_dynamics 4-6, protagonist 7-8): sem o
              clamp o painel cresce e empurra a grade ao trocar de linha. */}
          {summary && <span className="line-clamp-2 min-w-0 text-muted-foreground">{summary}</span>}
        </>
      ) : (
        <span className="italic text-muted-foreground/70">{idleHint}</span>
      )}
    </div>
  )
}

/**
 * Uma linha de nota de critério. `score` null = sem nota válida ⇒ sem rótulo de faixa. `aside` fica
 * antes do campo (na pós-leitura, a nota da IA quando o valor diverge); `children` é o campo.
 */
export function CriterionScoreRow({
  slug,
  score,
  active,
  aside,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  slug: CriterionSlug
  score: number | null
  active: boolean
  aside?: ReactNode
  children: ReactNode
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const info = CRITERIA_INFO[slug]
  // Faixa DERIVADA da nota vigente (nunca da prosa da IA) — troca sozinha ao digitar.
  const band = score == null ? null : bandForScore(score)
  const bandTitle = band ? rubricTitle(slug, band) : null
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 transition-colors",
        active && "bg-violet-500/5 ring-1 ring-inset ring-violet-500/40",
      )}
    >
      {/* `flex-wrap`: quando nome + rótulo da faixa não cabem na largura da coluna, o
          rótulo desce uma linha em vez de espremer o nome até "Dinâmica entre Prot…". */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-lg leading-none" aria-hidden>
          {info.emoji}
        </span>
        <span className="truncate text-sm font-medium">{info.name}</span>
        {bandTitle && (
          // Só o RÓTULO da faixa: os dígitos ("4-6") ficam no painel. Na linha eles roubavam ~35px do
          // nome — que passava a truncar em "Dinâmica entre Prot…" — pra repetir o que o próprio
          // campo de nota já mostra ao lado.
          <span
            className={cn(
              "shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-violet-600 dark:text-violet-300",
              active && "ring-1 ring-inset ring-violet-500/40",
            )}
            title={`Faixa ${band}`}
          >
            {bandTitle}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {aside}
        {children}
      </div>
    </div>
  )
}
