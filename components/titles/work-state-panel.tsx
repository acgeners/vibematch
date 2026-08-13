import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { LinkedSources } from "@/components/titles/linked-sources"
import { formatProvenanceWhen } from "@/components/ui/ai-provenance"
import { STATUS_CHIP_BASE, STATUS_TONE } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

/**
 * "Estado da obra" — em que pé está esta ficha (2026-08-13).
 *
 * Nasceu de uma queixa concreta: pra saber com quanta evidência a obra foi avaliada, de
 * quando é cada peça e o que falta, era preciso visitar três lugares — duas caixinhas
 * embaixo da capa, o tooltip do selo ✨ (o número de reviews da avaliação) e um chip que
 * só existe dentro da aba de Notas (o Veredito desatualizado).
 *
 * Três colunas porque são três perguntas, e elas se respondem em ordem:
 *  1. **Matéria-prima** — com quanta evidência isso foi feito?
 *  2. **Frescor** — de quando é cada peça?
 *  3. **Precisa de você** — o que eu faço agora?
 *
 * 🔴 **Chip de pendência é o que é RARO e acionável.** Medido nas 988 obras do catálogo em
 * 13/08/2026: **562 (57%)** receberam reviews depois da última avaliação e **502 (51%)**
 * nunca tiveram tags inferidas. Se isso virasse alerta, o painel estaria âmbar em quase
 * toda obra — e alarme que sempre toca não é lido (a mesma armadilha do `db:health`). Por
 * isso o que é maioria vira NÚMERO na 1ª coluna, e só o raro vira chip: Veredito
 * desatualizado (17 obras · 1,7%), avaliação a revisar (1), nunca avaliada (6),
 * sem síntese (136).
 *
 * ⚠️ Os chips não navegam. As abas da página são `Tabs` não-controladas (`defaultValue`),
 * então um link daqui pra dentro da aba de Notas exigiria subir o estado das abas pro
 * cliente inteiro — custo desproporcional pro ganho. O chip diz o que fazer; a ação mora
 * junto do resultado, que é a régua dos botões desta página.
 */
export interface WorkStatePanelProps {
  reviews: {
    /** Total em `work_reviews` (externas + manuais já somadas pelo caller). */
    total: number
    /** Fontes distintas com review. */
    sources: number
    /** Quantas entraram na síntese (`review_digest_n`). */
    digestN: number | null
    /** Rótulo pronto de quantas foram ao prompt da avaliação ("30 de 46", "8 no contexto"). */
    evalLabel: string | null
    /** `works.ai_eval_reviews_stale` — chegaram reviews depois da avaliação. */
    newSinceEval: boolean
  }
  dates: {
    created: string | null
    refreshed: string | null
    evaluated: string | null
    digest: string | null
    tags: string | null
    /** `works.last_read_at` — a única data PESSOAL daqui; some pra quem não leu. */
    lastRead?: string | null
  }
  externalIds: Record<string, string>
  pending: {
    verdictStale: boolean
    reviewPending: boolean
    neverEvaluated: boolean
    noDigest: boolean
  }
}

function Linha({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex items-baseline gap-2 text-[12.5px]">
      <span className="w-[64px] shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("font-semibold tabular-nums", v ? "text-foreground/90" : "text-muted-foreground/70")}>
        {v ?? "—"}
      </span>
    </div>
  )
}

function Coluna({
  titulo,
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
        {titulo}
      </span>
      {children}
    </section>
  )
}

export function WorkStatePanel({ reviews, dates, externalIds, pending }: WorkStatePanelProps) {
  const chips: string[] = []
  if (pending.verdictStale) chips.push("Veredito desatualizado")
  if (pending.reviewPending) chips.push("Avaliação a revisar")
  if (pending.neverEvaluated) chips.push("Nunca avaliada")
  if (pending.noDigest) chips.push("Sem síntese das reviews")

  return (
    <Card className="gap-0 border-border/70 bg-card/50 px-4 py-3.5">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Coluna titulo="Matéria-prima">
          <p className="text-[15px] font-bold tabular-nums text-foreground">
            {reviews.total} {reviews.total === 1 ? "review" : "reviews"}
            <span className="mx-1.5 font-normal text-muted-foreground/50">·</span>
            {reviews.sources} {reviews.sources === 1 ? "fonte" : "fontes"}
          </p>
          <Linha k="avaliação" v={reviews.evalLabel} />
          <Linha
            k="síntese"
            v={reviews.digestN != null ? `${reviews.digestN} de ${reviews.total}` : null}
          />
          {reviews.newSinceEval && (
            // Vale pra 57% do catálogo: informação, não alerta (ver a régua no topo).
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              Chegaram reviews novas depois da avaliação.
            </p>
          )}
          <div className="mt-0.5">
            <LinkedSources externalIds={externalIds} />
          </div>
        </Coluna>

        <Coluna titulo="Frescor">
          <Linha k="criada" v={formatProvenanceWhen(dates.created)} />
          <Linha k="dados" v={formatProvenanceWhen(dates.refreshed)} />
          <Linha k="avaliada" v={formatProvenanceWhen(dates.evaluated)} />
          <Linha k="síntese" v={formatProvenanceWhen(dates.digest)} />
          <Linha k="tags" v={formatProvenanceWhen(dates.tags)} />
          {dates.lastRead && <Linha k="sua leitura" v={formatProvenanceWhen(dates.lastRead)} />}
        </Coluna>

        <Coluna titulo="Precisa de você">
          {chips.length > 0 ? (
            <div className="flex flex-col items-start gap-1.5">
              {chips.map((chip) => (
                <span key={chip} className={cn(STATUS_CHIP_BASE, STATUS_TONE.stale.chip)}>
                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                  {chip}
                </span>
              ))}
            </div>
          ) : (
            <span className={cn(STATUS_CHIP_BASE, STATUS_TONE.ok.chip, "w-fit")}>
              <CheckCircle2 className="size-3 shrink-0" aria-hidden />
              Nada pendente
            </span>
          )}
        </Coluna>
      </div>
    </Card>
  )
}
