import Link from "next/link"
import { cn } from "@/lib/utils"
import type { ScoreEntry, ScoreProducer } from "@/lib/scores/glossary"
import { RECALC_INPUT_LABELS } from "@/lib/scores/glossary"

/**
 * Um verbete do dicionário dos números.
 *
 * 🔴 A ressalva fica na COR do estado, não numa cor própria: `alerta` usa o âmbar que em
 * todo o app quer dizer "existe, mas olhe antes de aplicar" (`lib/ui/status-tone.ts`).
 * Inventar um tom aqui daria um quarto significado ao amarelo numa base que já pagou caro
 * por ele significar cinco coisas na mesma página.
 *
 * ⚠️ O fundo é alfa (`bg-<cor>-500/…`), nunca `bg-<cor>-50`: o app é escuro por padrão e
 * não tem seletor de tema, então fundo claro fixo é branco sobre card escuro em toda
 * visita. E o contorno é `ring-*` porque `border-<cor>` não pinta — o `* { border-color }`
 * do globals.css está fora de layer e vence as utilities do Tailwind v4.
 */
const PRODUCER_LABEL: Record<ScoreProducer, string> = {
  calculo: "cálculo",
  modelo: "modelo",
  ia: "IA (LLM)",
  voce: "você",
  externo: "fonte externa",
}

const PRODUCER_CLASS: Record<ScoreProducer, string> = {
  calculo: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  modelo: "bg-primary/15 text-primary ring-primary/30",
  ia: "bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300",
  voce: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300",
  externo: "bg-muted text-muted-foreground ring-border",
}

function ProducerPill({ producer }: { producer: ScoreProducer }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1",
        PRODUCER_CLASS[producer]
      )}
    >
      {PRODUCER_LABEL[producer]}
    </span>
  )
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-lg border border-border bg-background/40 px-2.5 py-1 text-xs text-muted-foreground">
      {children}
    </span>
  )
}

interface ScoreEntryCardProps {
  entry: ScoreEntry
  /** Quantas obras têm este número, e de quantas — `null` quando não há contagem. */
  coverage: { n: number; total: number } | null
  /** Verdadeiro quando a contagem existe mas exige sessão que não há. */
  coverageNeedsSession: boolean
  first: boolean
}

export function ScoreEntryCard({ entry, coverage, coverageNeedsSession, first }: ScoreEntryCardProps) {
  // 🔴 `floor`, não `round`: com 975 de 978 o arredondamento imprime "100%", que afirma
  // "todas" a dois centímetros de um numerador que diz o contrário. Aqui 100% só sai quando
  // é 100% de verdade. É a mesma régua do `formatTagShare`, que imprime "<1%" em vez de
  // arredondar para zero — nas pontas, arredondar troca o número por uma afirmação falsa.
  const pct =
    coverage && coverage.total > 0
      ? coverage.n >= coverage.total
        ? 100
        : Math.max(1, Math.floor((coverage.n / coverage.total) * 100))
      : null

  return (
    <article
      id={entry.key}
      className={cn(
        "grid scroll-mt-[72px] gap-4 py-7 md:grid-cols-[190px_minmax(0,1fr)] md:gap-8",
        first ? "pt-2" : "border-t border-border"
      )}
    >
      <div className="flex flex-col gap-2 self-start">
        <h3 className="text-xl font-semibold tracking-tight">{entry.name}</h3>
        <span className="break-all font-mono text-[11px] text-muted-foreground">{entry.slug}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{entry.scale}</span>
        <ProducerPill producer={entry.producer} />
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <p className="max-w-[70ch] text-[15px] leading-relaxed text-foreground/90">{entry.summary}</p>

        <div className="flex flex-wrap gap-1.5">
          {entry.feedsExpected && (
            <Fact>
              Na Nota Prevista: <b className="font-semibold text-foreground">{entry.feedsExpected}</b>
            </Fact>
          )}
          <Fact>
            Onde aparece: <b className="font-semibold text-foreground">{entry.where}</b>
          </Fact>
          {coverage && (
            <Fact>
              Existe em{" "}
              <b className="font-mono font-semibold tabular-nums text-foreground">
                {coverage.n.toLocaleString("pt-BR")} de {coverage.total.toLocaleString("pt-BR")}
              </b>
              {pct != null && <span className="font-mono tabular-nums"> · {pct}%</span>}
            </Fact>
          )}
          {coverageNeedsSession && <Fact>Entre para ver em quantas das suas obras ele existe</Fact>}
          {entry.movedBy.length > 0 && (
            <Fact>
              Muda quando muda:{" "}
              <b className="font-semibold text-foreground">
                {entry.movedBy.map((m) => RECALC_INPUT_LABELS[m]).join(" · ")}
              </b>
            </Fact>
          )}
        </div>

        {entry.note && (
          <p
            className={cn(
              "max-w-[82ch] rounded-r-lg border-l-[3px] px-4 py-3 text-sm leading-relaxed",
              entry.note.tone === "alerta"
                ? "border-amber-500/45 bg-amber-500/[0.09]"
                : "border-border bg-muted/40"
            )}
          >
            <b
              className={cn(
                "font-semibold",
                entry.note.tone === "alerta" ? "text-amber-700 dark:text-amber-300" : "text-foreground"
              )}
            >
              {entry.note.title}
            </b>{" "}
            {entry.note.body}
          </p>
        )}

        {entry.href && (
          <Link
            href={entry.href.url}
            className="w-fit text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            {entry.href.label} →
          </Link>
        )}
      </div>
    </article>
  )
}
