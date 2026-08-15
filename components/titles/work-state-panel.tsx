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
  /**
   * Quantas tags a obra tem (`work_tags` inteiro — a mesma contagem que o
   * `netNameOverlap` do recalc itera; `work_genres` fica de fora porque o recalc
   * não a lê).
   *
   * 🔴 Mora na 1ª coluna porque ela pergunta *"com quanta evidência isso foi
   * feito?"*, e até 2026-08-15 ela contava reviews e fontes mas NÃO contava
   * tags — que são a matéria-prima EXCLUSIVA do Alinhamento. Medido no clone
   * local nas 988 obras: o percentil médio de Alinhamento vai de 8,5 (obras com
   * ≤10 tags) a 80,8 (100+ tags), Spearman +0,584 contra o nº de tags. Sem este
   * número, "Alinhamento 12" e "Alinhamento 89" saem idênticos na tela mesmo
   * quando o primeiro só quer dizer que a obra mal foi tagueada.
   *
   * ⚠️ NÚMERO, nunca chip: 21% do catálogo está abaixo de 25 tags, e chip nessa
   * frequência é o alarme que sempre toca (a régua desta 1ª coluna, no topo).
   */
  tagCount: number
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

const ROTULO = "text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground"

/** Um par rótulo-em-cima / valor-embaixo — o mesmo desenho da faixa de stats do topo. */
function Marco({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-1 first:pl-0">
      <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/75">
        {k}
      </span>
      <span
        className={cn(
          "truncate text-[12.5px] font-semibold tabular-nums",
          v ? "text-foreground/90" : "text-muted-foreground/60",
        )}
        title={v ?? undefined}
      >
        {v ?? "—"}
      </span>
    </div>
  )
}

export function WorkStatePanel({
  reviews,
  dates,
  externalIds,
  pending,
  tagCount,
}: WorkStatePanelProps) {
  const chips: string[] = []
  if (pending.verdictStale) chips.push("Veredito desatualizado")
  if (pending.reviewPending) chips.push("Avaliação a revisar")
  if (pending.neverEvaluated) chips.push("Nunca avaliada")
  if (pending.noDigest) chips.push("Sem síntese das reviews")

  return (
    <Card className="gap-0 border-border/70 bg-card/50 px-4 py-3">
      {/* FAIXA 1 — a evidência, e o que ela pede. Em três colunas verticais (a 1ª versão),
          a coluna de pendências ficava vazia na maioria das obras e as datas usavam metade
          da largura reservada: 490px de altura com vão à direita. Horizontal, a mesma
          informação cabe em ~200px e a largura inteira é usada. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <span className="text-[15px] font-bold tabular-nums text-foreground">
            {reviews.total} {reviews.total === 1 ? "review" : "reviews"}
            <span className="mx-1.5 font-normal text-muted-foreground/50">·</span>
            {reviews.sources} {reviews.sources === 1 ? "fonte" : "fontes"}
            <span className="mx-1.5 font-normal text-muted-foreground/50">·</span>
            {tagCount} {tagCount === 1 ? "tag" : "tags"}
          </span>
          {reviews.evalLabel && (
            <span className="text-[12.5px] text-muted-foreground">
              avaliação{" "}
              <span className="font-semibold tabular-nums text-foreground/90">{reviews.evalLabel}</span>
            </span>
          )}
          {reviews.digestN != null && (
            <span className="text-[12.5px] text-muted-foreground">
              síntese{" "}
              <span className="font-semibold tabular-nums text-foreground/90">
                {reviews.digestN} de {reviews.total}
              </span>
            </span>
          )}
          {reviews.newSinceEval && (
            // Vale pra 57% do catálogo: informação, não alerta (ver a régua no topo).
            <span className="text-[11.5px] text-muted-foreground/80">
              +reviews desde a avaliação
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {chips.length > 0 ? (
            chips.map((chip) => (
              <span key={chip} className={cn(STATUS_CHIP_BASE, STATUS_TONE.stale.chip)}>
                <AlertTriangle className="size-3 shrink-0" aria-hidden />
                {chip}
              </span>
            ))
          ) : (
            <span className={cn(STATUS_CHIP_BASE, STATUS_TONE.ok.chip)}>
              <CheckCircle2 className="size-3 shrink-0" aria-hidden />
              Nada pendente
            </span>
          )}
        </div>
      </div>

      {/* FAIXA 2 — frescor. Grid de marcos, como a faixa de stats do topo da página: rótulo
          minúsculo em cima, data embaixo. `auto-fit` porque "sua leitura" só existe pra
          quem leu, e uma coluna fixa deixaria um buraco no lugar dela. */}
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-y-1 border-t border-border/50 pt-2.5">
        <Marco k="criada" v={formatProvenanceWhen(dates.created)} />
        <Marco k="dados" v={formatProvenanceWhen(dates.refreshed)} />
        <Marco k="avaliada" v={formatProvenanceWhen(dates.evaluated)} />
        <Marco k="síntese" v={formatProvenanceWhen(dates.digest)} />
        <Marco k="tags" v={formatProvenanceWhen(dates.tags)} />
        {dates.lastRead && <Marco k="sua leitura" v={formatProvenanceWhen(dates.lastRead)} />}
      </div>

      {/* FAIXA 3 — as fontes ocupam a largura inteira, então os 9 chips cabem em uma linha
          ou duas em vez das quatro que sobravam dentro de uma coluna de 1/3. */}
      {/* `items-start` + `leading-5` alinham o rótulo com a PRIMEIRA linha de chips: com
          `items-center` ele descia até o meio do bloco quando os chips quebravam em duas
          linhas, e ficava boiando. */}
      <div className="mt-2.5 flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t border-border/50 pt-2.5">
        <span className={cn(ROTULO, "leading-5")}>Fontes</span>
        <LinkedSources externalIds={externalIds} variant="inline" />
      </div>
    </Card>
  )
}
