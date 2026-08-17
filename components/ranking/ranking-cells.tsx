"use client"

import { Loader2, Sparkles, RotateCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { QualityHearts } from "@/components/ui/quality-hearts"
import { InterestAppliedMark } from "@/components/ui/interest-applied-mark"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import { useRerankSingleWork } from "@/components/ranking/use-rerank-single-work"
import { AlignmentTooltipContent, VerdictTooltipContent } from "@/components/ranking/score-tooltip-content"
import type { AlignmentPayload } from "@/components/ranking/score-tooltip-content"
import { ART_BAND_LABELS, artBandFromPercentile } from "@/lib/art/bands"
import { verdictBandClass } from "@/lib/ui/verdict-band"
import { confidenceMarkClass } from "@/lib/ai-evaluation/confidence-tone"

/**
 * Botão pequeno que substitui o "—" da `AlignmentScoreCell` quando há um
 * `workId` mas ainda não há nota (primeiro re-rank da obra).
 */
function RerankSingleWorkButton({ workId }: { workId: string }) {
  const { isPending, run } = useRerankSingleWork(workId)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void run()}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-xs text-muted-foreground hover:border-violet-500/60 hover:text-violet-600 dark:hover:text-violet-400 disabled:opacity-50 disabled:cursor-wait"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            <span>{isPending ? "..." : "Rankear"}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          Rodar IA re-rank só pra esta obra. Conta uma execução do limite diário.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Ícone ⟳ clicável ao lado da nota quando o Veredito IA está DESATUALIZADO. Roda o
 * re-rank só desta obra (mesma action do "Rankear"), limpando o stale.
 */
function RerankStaleButton({ workId }: { workId: string }) {
  const { isPending, run } = useRerankSingleWork(workId)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void run()
            }}
            disabled={isPending}
            aria-label="Atualizar Veredito IA (desatualizado)"
            className="inline-flex items-center justify-center rounded p-0.5 text-amber-500 hover:bg-amber-500/10 hover:text-amber-600 disabled:cursor-wait disabled:opacity-50 dark:hover:text-amber-400"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCw className="h-3 w-3" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          Desatualizado — a obra mudou desde este re-rank. Clique pra rodar o IA re-rank
          só desta obra. Conta uma execução do limite diário.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Cell pra `alignment_score` (0–100) — badge azul/violet com tooltip da
 * justificativa do LLM. NULL vira "—" (obra ainda não passou pelo re-rank);
 * se `workId` está presente, vira um botão "Rankear" que dispara o re-rank
 * inline pra aquela obra.
 */
export function AlignmentScoreCell({
  score,
  justification,
  workId,
  payload,
  isPaid = true,
  stale = false,
}: {
  score: number | null
  justification: string | null
  workId?: string
  payload?: AlignmentPayload | null
  isPaid?: boolean
  /** True quando o Veredito IA ficou desatualizado (obra editada/re-avaliada). */
  stale?: boolean
}) {
  if (score == null) {
    if (workId && isPaid) {
      return <RerankSingleWorkButton workId={workId} />
    }
    if (workId && !isPaid) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-xs text-muted-foreground/70 cursor-help">
                <Sparkles className="h-3 w-3" />
                <span>Pago</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px]">
              O re-rank por IA (Veredito IA) é uma feature do plano Pago. No Free o ranking usa
              Nota Prevista × alinhamento.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm text-muted-foreground cursor-help">—</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[280px]">
            Esta obra ainda não passou pelo IA re-rank. Use o botão &quot;Recomendar do
            ranking&quot; aqui no topo da página pra incluí-la numa run — o
            <span className="font-semibold"> alignment_score</span> retornado fica salvo
            nessa coluna.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // 🔴 A rampa das faixas tem DONO (`lib/ui/verdict-band.ts`) — ela também desenha o card do
  // Veredito e o do Deep Dive na página da obra, e montá-la aqui de novo é o que fazia o mesmo
  // 55 poder sair de uma cor na lista e de outra na obra.
  const colorClass = verdictBandClass(score)

  // O TRAÇO de confiança (era uma bolinha de 6px até 17/08/2026): 15px × 2px centrados sob o
  // número, dentro do preenchimento. Largura CONSTANTE de propósito — no sublinhado do número
  // ela seguiria a quantidade de dígitos, e "100" marcaria mais que "35" sem significar nada.
  // Com largura e x fixos, a coluna vira uma tira que dá pra varrer na vertical.
  //
  // ⚠️ Ele NÃO encosta na borda: friso colado na base funde com a borda da pílula quando as
  // duas cores coincidem (âmbar/âmbar, cinza/cinza) e lê como "a borda engrossou". A cor sai
  // de `confidenceMarkClass`, nunca dos cortes reescritos aqui.
  const confidenceMark = payload?.confidence != null ? confidenceMarkClass(payload.confidence) : null

  // Quando desatualizado e o re-rank é possível (Pago + workId), o ⟳ vira um
  // botão clicável ao lado do badge. Senão, fica como indicador estático dentro
  // do badge (Free ou sem workId).
  const canRerankStale = stale && !!workId && isPaid

  return (
    <span className="inline-flex items-center gap-1">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex flex-col items-center gap-0.5 rounded-md border px-1.5 pt-[3px] pb-1 text-xs font-medium leading-4 cursor-help tabular-nums",
              colorClass,
              stale && "opacity-60",
            )}
          >
            <span>{Math.round(score)}</span>
            {/* Slot SEMPRE reservado — mesmo motivo do slot do ⟳ logo abaixo: sem ele o número
                muda de altura de uma linha pra outra. E ele leva uma TRILHA neutra quando não há
                confiança, em vez de ficar vazio: medido no app em 17/08/2026, **297 das 695
                obras com Veredito (43%) não têm confiança registrada**, então o vão vazio é o
                caso comum e lê como número desalinhado dentro da pílula. A trilha a 10% fica
                muito abaixo das três cores saturadas — diz "sem registro", não "confiança
                baixa", que é rose. */}
            <span
              className={cn("h-0.5 w-[15px] rounded-full", confidenceMark ?? "bg-foreground/10")}
              aria-hidden="true"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[400px] space-y-1.5">
          <VerdictTooltipContent
            score={score}
            justification={justification}
            payload={payload}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
      {/* Slot de largura fixa SEMPRE reservado: mantém o número do badge na mesma
          posição em todas as linhas, com ou sem o ícone de desatualizado. */}
      <span className="inline-flex w-4 shrink-0 items-center justify-center">
        {stale &&
          (canRerankStale ? (
            <RerankStaleButton workId={workId!} />
          ) : (
            <RotateCw className="h-3 w-3 text-amber-500" aria-label="Desatualizado" />
          ))}
      </span>
    </span>
  )
}

/**
 * Cell pra a PREVISÃO de Interesse Sinopse (♥..♥♥♥♥) gerada pela IA — distinta
 * da coluna "Sinopse" (valor manual). Corações LARANJA + selo "IA" (mesma paleta
 * dos cards/chips; o manual fica vermelho). NULL vira "—" (obra ainda não
 * prevista). Stale = a obra/perfil mudaram desde a previsão; esmaece com aviso.
 */
export function SynopsisPredictionCell({
  quality,
  stale = false,
  confidence = null,
}: {
  quality: string | null
  stale?: boolean
  confidence?: number | null
}) {
  if (!quality) {
    return <span className="font-mono text-sm text-muted-foreground">—</span>
  }
  const label = SYNOPSIS_QUALITY_LABELS[quality] ?? ""
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex cursor-help items-center gap-1 whitespace-nowrap", stale && "opacity-60")}>
            <QualityHearts quality={quality} variant="pred" showEmpty={false} className="text-[15px]" />
            <span className="rounded border border-orange-500/40 px-[3px] text-[8px] font-extrabold leading-[1.4] tracking-wide text-orange-500 dark:text-orange-400">
              IA
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] space-y-1">
          <p className="text-xs font-semibold">
            Previsão: {label || quality}
          </p>
          {confidence != null && (
            <p className="text-[11px] text-muted-foreground">
              Confiança: <span className="font-semibold">{Math.round(confidence * 100)}%</span>
            </p>
          )}
          {stale && (
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              Desatualizada — a obra ou o perfil mudaram desde a previsão.
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Interesse na Obra MANUAL (coluna "Sinopse") — corações VERMELHOS (mesma paleta
 * dos cards e dos chips de filtro; a previsão fica laranja). Quando o valor foi
 * APLICADO da previsão (`synopsis_quality_source = prediction_applied`) ganha o ✨
 * (rosa) + tooltip, sinalizando origem na IA. Valor definido à mão fica sem ✨.
 * NULL vira "—".
 */
export function ManualInterestCell({
  quality,
  fromPrediction = false,
}: {
  quality: string | null
  fromPrediction?: boolean
}) {
  if (!quality) return <span className="font-mono text-sm text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <QualityHearts quality={quality} variant="manual" showEmpty={false} className="text-[15px]" />
      {fromPrediction && <InterestAppliedMark size={11} />}
    </span>
  )
}

/**
 * Cell pra a Prioridade (0–10, exibida ×10 como 0–100) — número que ancora na
 * Prevista e ajusta pelo Veredito IA quando há. Distinta visualmente das outras notas
 * (tom primary) porque é o critério default de ordenação. O tooltip abre a
 * composição pra deixar claro que NÃO é uma previsão de nota, e sim "o que ler primeiro".
 */
export function DecisionCell({
  score,
  affinity,
  expected,
  fitPercentile,
  alignment,
  moodAdjusted = null,
}: {
  score: number | null
  /**
   * Afinidade 0–100 = Decisão × 10 (absoluta): "chance de você gostar". Quando
   * null, cai pro `score` 0–10. Ver decisionToAffinity em ranking-table.tsx.
   */
  affinity: number | null
  expected: number | null
  fitPercentile: number | null
  alignment: number | null
  /**
   * Prioridade ajustada pelo refino por mood, quando há um ativo na lista.
   *
   * 🔴 Quando existe, é ELA que a célula imprime — e não é cosmético: a lista
   * passa a estar ORDENADA por este número, e exibir a base enquanto se ordena
   * pelo ajustado é exatamente a invariante "quem ordena tem que ver o mesmo
   * número da tela" que custou 19.624 pares de empate na Prioridade. O valor
   * base continua no tooltip, que é onde ele responde "de quanto o refino moveu".
   */
  moodAdjusted?: number | null
}) {
  const base = score
  const refinada = moodAdjusted != null && base != null
  const shown = refinada ? (moodAdjusted as number) : score
  // ⚠️ A afinidade (0–100) é derivada da Prioridade BASE lá na tabela. Com refino
  // ativo ela descreveria outro número que não o da ordenação, então a célula
  // volta pra escala 0–10 — que é a única em que o ajustado existe.
  const affinityShown = refinada ? null : affinity
  if (shown == null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm text-muted-foreground cursor-help">—</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px]">
            Sem Prioridade — depende da Nota Prevista, que ainda não foi calculada pra esta obra.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  const colorClass =
    shown >= 8 ? "bg-primary/15 text-primary border-primary/40"
    : shown >= 6 ? "bg-sky-500/15 text-sky-700 border-sky-500/40 dark:text-sky-300"
    : shown >= 4 ? "bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300"
    : "bg-slate-500/15 text-slate-700 border-slate-500/40 dark:text-slate-300"

  // Estimativa SECUNDÁRIA (o tier é o sinal primário): prefixo "~" + visual
  // discreto pra não prometer uma ordem fina que o modelo não sustenta.
  const display = affinityShown != null ? `~${affinityShown}` : `~${shown.toFixed(1)}`

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium cursor-help tabular-nums",
              colorClass,
              // O refino é reversível e momentâneo: a borda tracejada diz que este
              // número não é o do banco, sem gastar uma cor de estado (âmbar já é
              // "desatualizado" e o refino não tem nada de desatualizado).
              refinada && "border-dashed",
            )}
          >
            {display}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px] space-y-1.5">
          <p className="text-xs font-semibold">
            Prioridade{affinityShown != null ? `: ${affinityShown}/100` : `: ${shown.toFixed(1)}/10`}
            {refinada && <span className="font-normal text-muted-foreground"> · refinada</span>}
          </p>
          {refinada && (
            <p className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-muted-foreground">Sem o refino</span>
              <span className="font-mono font-semibold">
                {(base as number).toFixed(1)}
                <span className="ml-1 text-muted-foreground">
                  ({shown - (base as number) >= 0 ? "+" : "−"}
                  {Math.abs(shown - (base as number)).toFixed(2)})
                </span>
              </span>
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Estimativa de satisfação pra priorizar o que ler primeiro (Prevista ajustada pelo
            Veredito IA, ×10). <span className="font-semibold">Diferenças pequenas entre obras da
            mesma faixa não indicam uma ordem confiável</span> — dentro de cada faixa a ordem usa
            compatibilidade e desempates, não o decimal.
            <span className="font-semibold"> Não é uma previsão de nota</span> (essa é a Prevista).
          </p>
          <div className="border-t border-border/40 pt-1.5 space-y-0.5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Prevista (âncora)</span>
              <span className="font-mono font-semibold">{expected != null ? expected.toFixed(1) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Veredito IA (quando há)</span>
              <span className="font-mono font-semibold">{alignment != null ? Math.round(alignment) : "não rankeada"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Alinhamento (desempate)</span>
              <span className="font-mono font-semibold">{fitPercentile != null ? `${Math.round(fitPercentile)}%` : "—"}</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Cell pra `personal_fit` — agora mostra o PERCENTIL dentro da biblioteca
 * (0-100) em vez do valor cru. O personal_fit cru tem teto matemático
 * baixo (~0.55 mesmo nas melhores obras), então "55%" lê como mediano
 * quando na verdade é o topo. Percentil comunica "Top X%" e é mais honesto.
 *
 * Fallback pro valor cru quando percentile é NULL (pré-migration 071 ou
 * perfil stub).
 */
export function AlignmentCell({
  value,
  percentile,
  tagCount,
  showBar = true,
  showTooltip = true,
}: {
  value: number | null
  /** Percentil (0-100) dentro da biblioteca. Quando presente, usado como display. */
  percentile?: number | null
  /**
   * Nº de tags da obra — a matéria-prima do número, exibida no tooltip. Só passe
   * onde as tags JÁ viajam no payload (`WORK_LIST_SELECT` embute `work_tags`):
   * o `/ranking` não embute de propósito (`server/queries/ranking.ts` devolve
   * `tags: []`, corte de egress), e ali a ausência é a escolha certa — medido em
   * 15/08/2026, o top 50 por Nota Prevista não tem NENHUMA obra abaixo de 25
   * tags, então é justo onde a ressalva menos serve.
   */
  tagCount?: number | null
  /** Quando false, mostra só o número colorido por faixa (sem a barra). */
  showBar?: boolean
  /** Quando false, exibe só o valor sem a tooltip (ex.: /favorites, texto redundante). */
  showTooltip?: boolean
}) {
  if (value == null) {
    if (!showTooltip) return <span className="font-mono text-sm text-muted-foreground">—</span>
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm text-muted-foreground cursor-help">—</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px]">
            Sem alinhamento computado — perfil de gosto ainda é stub ou a obra não tem critérios/tags
            que casem com o perfil.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Display preference: percentile (mais honesto) > valor cru (fallback)
  const displayPct = percentile != null ? Math.round(percentile) : Math.round(value * 100)
  const color =
    displayPct >= 75 ? "bg-emerald-500"
    : displayPct >= 50 ? "bg-amber-500"
    : displayPct >= 25 ? "bg-orange-500"
    : "bg-slate-400"
  // Versão text-only (showBar=false): mesma faixa do bar mapeada pra cor de texto.
  const textColor =
    displayPct >= 75 ? "text-emerald-600 dark:text-emerald-400"
    : displayPct >= 50 ? "text-amber-600 dark:text-amber-400"
    : displayPct >= 25 ? "text-orange-600 dark:text-orange-400"
    : "text-muted-foreground"

  const trigger = showBar ? (
    <div className="inline-flex items-center gap-1.5">
      <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all", color)} style={{ width: `${displayPct}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums">{displayPct}%</span>
    </div>
  ) : (
    <span className={cn("font-mono text-xs font-medium tabular-nums", textColor)}>
      {displayPct}%
    </span>
  )

  if (!showTooltip) return trigger

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{trigger}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] space-y-1">
          <AlignmentTooltipContent value={value} percentile={percentile} tagCount={tagCount} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}


/**
 * Cell da ARTE nas listas — o PERCENTIL (0–100), nunca a estimativa em pontos.
 *
 * 🔴 A estimativa em pontos é comprimida a ~0,49× a escala do rótulo, então um número
 * em pontos convida à comparação errada com uma nota de critério; a posição relativa é
 * a única coisa que significa algo (ver lib/art/model.ts). Por isso a coluna mostra
 * percentil e o nome da faixa vive no tooltip.
 *
 * ⚠️ Ela existe nas listas desde 2026-08-15 porque é um dos separadores mais fortes
 * entre obras EMPATADAS: medido, separa 79,8% dos pares dentro dos grupos de mesma
 * Prioridade exibida (cobertura 97,5%). Vivia só na página da obra — o único lugar onde
 * ela não ajuda a escolher ENTRE várias.
 *
 * ⚠️ Sem estimativa é "—", nunca 0 nem "média": é um terceiro estado. E para quem não é
 * o dono ela vem NULL de propósito (é treinada nos rótulos DELE — ver PERSONAL_SCORE_FIELDS).
 */
export function ArtCell({ percentile }: { percentile: number | null }) {
  const band = artBandFromPercentile(percentile)
  if (percentile == null || band == null) {
    return <span className="font-mono text-sm text-muted-foreground">—</span>
  }
  const pct = Math.round(percentile * 100)
  // Tom só nos EXTREMOS: a faixa do meio é "sem destaque", e pintá-la faria a coluna
  // inteira colorida — o alarme que sempre toca.
  const tone =
    band === "forte"
      ? "text-emerald-600 dark:text-emerald-400"
      : band === "fraca"
        ? "text-rose-600 dark:text-rose-400"
        : "text-muted-foreground"
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("cursor-help font-mono text-sm tabular-nums", tone)}>{pct}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] space-y-1">
          <p className="text-xs font-semibold">{ART_BAND_LABELS[band]}</p>
          <p className="text-[11px] text-background/70">
            Percentil {pct} do catálogo. É estimativa — a escala é comprimida, então serve pra
            comparar obras entre si, não como nota.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
