"use client"

import { useState } from "react"
import { Clock, Globe, Loader2, Pencil, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AiProvenanceSeal } from "@/components/ui/ai-provenance"
import { STATUS_CHIP_BASE, STATUS_TONE } from "@/lib/ui/status-tone"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { useRefresh } from "@/lib/use-refresh"
import {
  analyzeOpeningStructureAction,
  analyzeOpeningStructureWebAction,
  setOpeningStructureOverrideAction,
  type OpeningStructureActionResult,
} from "@/server/actions/opening-structure"
import type { OpeningStructureRow } from "@/server/queries/opening-structure"

/**
 * Card "Estrutura de abertura" da página da obra.
 *
 * 🔴 O veredito é codificado por FORMA (um mini-diagrama de linha do tempo), não por cor. Azul
 * e âmbar já significam estado de TAREFA no chrome, e verde/vermelho implicariam um juízo que a
 * feature não faz — flashforward não é melhor nem pior que linear. É a mesma razão pela qual a
 * ênfase 2× das tags virou glifo em vez de "um verde mais escuro".
 *
 * 🔴 A citação fica NA TELA, não no tooltip. A régua do selo ✨ é: procedência (modelo, versão,
 * data, confiança) no tooltip; ESTADO e prova ficam visíveis. Sem a citação à vista, o veredito
 * é indistinguível de um palpite — e com 320 obras de reencarnação no catálogo, o palpite
 * plausível é sempre "flashforward".
 *
 * ⚠️ "Evidência insuficiente" NÃO é erro. Foi 13 de 19 no piloto; é a resposta honesta quando o
 * material só descreve o enredo. A borda âmbar reusa o padrão de "Desatualizado" do Veredito IA,
 * e a razão impressa é o que justifica o segundo botão existir.
 */

type Verdict = "flashforward" | "linear" | "indeterminado"

interface Props {
  workId: string
  row: OpeningStructureRow | null
  /** Só o curador marca à mão — é coluna de catálogo, o veredito vale para todo leitor. */
  canOverride: boolean
  canRunAi: boolean
}

function Timeline({ verdict }: { verdict: Verdict }) {
  const rail = "stroke-muted-foreground/35"
  const lit = "fill-violet-500 dark:fill-violet-300"
  const dim = "fill-muted-foreground/40"

  if (verdict === "flashforward") {
    return (
      <span className="flex shrink-0 flex-col items-center">
        <svg width="64" height="20" viewBox="0 0 64 20" role="img" aria-label="Abre com cena que a trama depois alcança">
          <line x1="4" y1="14" x2="60" y2="14" className={rail} strokeWidth="1.5" />
          <path
            d="M8 10 C 8 1, 56 1, 56 10"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="stroke-violet-500 dark:stroke-violet-300"
          />
          <circle cx="8" cy="14" r="3" className={lit} />
          <circle cx="32" cy="14" r="2.2" className={dim} />
          <circle cx="56" cy="14" r="3" className={lit} />
        </svg>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          fim → início
        </span>
      </span>
    )
  }
  if (verdict === "linear") {
    return (
      <span className="flex shrink-0 flex-col items-center">
        <svg width="64" height="20" viewBox="0 0 64 20" role="img" aria-label="Começa no início cronológico">
          <line x1="4" y1="14" x2="60" y2="14" className={rail} strokeWidth="1.5" />
          <circle cx="8" cy="14" r="3" className={lit} />
          <circle cx="32" cy="14" r="2.2" className={dim} />
          <circle cx="56" cy="14" r="2.2" className={dim} />
        </svg>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          cronológico
        </span>
      </span>
    )
  }
  return (
    <span className="flex shrink-0 flex-col items-center">
      <svg width="64" height="20" viewBox="0 0 64 20" role="img" aria-label="Evidência insuficiente">
        <line x1="4" y1="14" x2="60" y2="14" className={rail} strokeWidth="1.5" strokeDasharray="3 3" />
        <text x="32" y="8" textAnchor="middle" className="fill-muted-foreground text-[11px] font-bold">
          ?
        </text>
      </svg>
      <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        sem base
      </span>
    </span>
  )
}

const TITULO: Record<Verdict, string> = {
  flashforward: "Começa com flashforward",
  linear: "Começa no início cronológico",
  indeterminado: "Evidência insuficiente",
}

export function OpeningStructureCard({ workId, row, canOverride, canRunAi }: Props) {
  const tasks = useAppTasks()
  const confirmCost = useCostConfirm()
  const refresh = useRefresh()
  const [local, setLocal] = useState<OpeningStructureActionResult | null>(null)

  const localId = `opening-structure:${workId}`
  const webId = `opening-structure-web:${workId}`
  const runningLocal = tasks.some((t) => t.id === localId && t.status === "running")
  const runningWeb = tasks.some((t) => t.id === webId && t.status === "running")
  const running = runningLocal || runningWeb

  // O optimistic do onDone convive com o revalidatePath do servidor: o primeiro pinta a tela
  // agora, o segundo é a verdade quando a página remonta.
  const auto = local?.verdict ?? row?.opening_structure_auto ?? null
  const override = row?.opening_structure_override ?? null
  const effective: Verdict | null = override ?? auto
  const evidence = local?.evidence ?? row?.opening_structure_auto_evidence ?? ""
  const rationale = local?.rationale ?? row?.opening_structure_auto_rationale ?? ""
  const confidence = local?.confidence ?? row?.opening_structure_auto_confidence ?? null
  const source = local?.source ?? row?.opening_structure_auto_source ?? null
  const jaTentouWeb = source === "web"
  const analisado = auto != null

  const start = (kind: "local" | "web") => {
    const web = kind === "web"
    runTask({
      id: web ? webId : localId,
      kind: web ? "opening-structure-web" : "opening-structure",
      label: web ? "Buscando a abertura na web" : "Analisando estrutura de abertura",
      run: async () => {
        const r = web
          ? await analyzeOpeningStructureWebAction(workId)
          : await analyzeOpeningStructureAction(workId)
        // 🔴 A action devolve `{ error }` em vez de lançar, e o runTask só distingue falha por
        // rejeição da promise. Sem o throw, o indicador anunciaria "pronto" para uma falha.
        if (r.error) throw new Error(r.error)
        return r
      },
      onDone: (r) => {
        setLocal(r)
        refresh()
      },
      successToast: (r) =>
        r.verdict === "indeterminado"
          ? { message: web ? "A web também não descreveu a abertura." : "Evidência insuficiente — veja a razão no card." }
          : { message: `Abertura: ${TITULO[r.verdict!].toLowerCase()}` },
    })
  }

  const onAnalyze = async (kind: "local" | "web") => {
    const action = kind === "web" ? "opening_structure_web" : "opening_structure"
    if (!(await confirmCost({ action }))) return
    start(kind)
  }

  const onOverride = async (value: "flashforward" | "linear" | null) => {
    const r = await setOpeningStructureOverrideAction(workId, value)
    if (!r.error) refresh()
  }

  const provenance =
    analisado && !running ? (
      <AiProvenanceSeal
        title="Estrutura de abertura por IA"
        model={row?.opening_structure_auto_model ?? undefined}
        promptVersion={undefined}
        at={row?.opening_structure_auto_at ?? undefined}
        extra={[
          { label: "Confiança", value: confidence != null ? `${(confidence * 100).toFixed(0)}%` : null },
          { label: "Fonte", value: source === "web" ? "busca na web" : "reviews + síntese" },
        ]}
        note="A ordem dos eventos é inferida do que leitores escreveram sobre a obra — o modelo não lê o capítulo."
      />
    ) : null

  return (
    // Card com header, e não o molde compacto dos vereditos: este card mora na VISÃO GERAL, ao
    // lado de "Sinopses" e "Resumo da avaliação IA", onde todo bloco é um <Card> com título em
    // negrito e ícone. O molde de veredito (`rounded-xl` + label de 12px) pertence ao grid da aba
    // de Notas, onde vários deles dividem a linha — solto aqui, ele lê como fragmento.
    <Card
      className={cn(
        // ⚠️ O realce do "indeterminado" deixou de ser âmbar em 2026-08-12: âmbar passou a
        // significar SÓ "desatualizado" (lib/ui/status-tone.ts). E "evidência insuficiente"
        // não é resultado velho nem falha — é ausência de resposta, com o caminho ao lado.
        "gap-2 py-4 transition-colors",
        effective === "indeterminado" ? "border-slate-500/45 bg-card/50" : "bg-card/50",
      )}
    >
      <CardHeader className="px-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4.5 w-4.5 text-muted-foreground" />
          <CardTitle className="text-base font-bold text-foreground">Estrutura de abertura</CardTitle>
          {provenance}
        </div>
      </CardHeader>
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          {running ? (
            <p className="text-sm font-medium text-muted-foreground">
              {runningWeb ? "Buscando na web…" : "Lendo reviews e síntese…"}
            </p>
          ) : effective ? (
            <>
              {effective === "indeterminado" ? (
                <span className={cn(STATUS_CHIP_BASE, STATUS_TONE.absent.chip)}>
                  Evidência insuficiente
                </span>
              ) : (
                <p className="text-sm font-semibold leading-snug">{TITULO[effective]}</p>
              )}

              {override ? (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Marcado por você. A análise automática não prevalece sobre a sua marcação.
                </p>
              ) : (
                <>
                  {evidence && (
                    <blockquote className="m-0 rounded-r-md border-l-2 border-violet-500/40 bg-muted/40 px-2.5 py-2 text-xs leading-relaxed text-foreground/80">
                      {evidence}
                    </blockquote>
                  )}
                  {rationale && (
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">{rationale}</p>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-muted-foreground">Ainda não analisado</p>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Determina se a obra abre com uma cena que a narrativa depois alcança. Lê a síntese e as
                reviews — não lê o capítulo.
              </p>
            </>
          )}
        </div>

        {effective && !running && <Timeline verdict={effective} />}
      </CardContent>

      <CardContent className="flex flex-wrap items-center gap-2 px-4 pt-0">
        {running ? (
          <Button variant="outline" size="sm" disabled className="gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {runningWeb ? "Buscando…" : "Analisando…"}
          </Button>
        ) : !analisado ? (
          <>
            <Button size="sm" className="gap-1.5" disabled={!canRunAi} onClick={() => void onAnalyze("local")}>
              <Sparkles className="h-3.5 w-3.5" />
              Analisar abertura
            </Button>
            <span className="text-[11px] text-muted-foreground/80">~$0,016 · ~15s · decide ~1 em 5</span>
          </>
        ) : effective === "indeterminado" ? (
          <>
            {!jaTentouWeb && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={!canRunAi}
                  onClick={() => void onAnalyze("web")}
                >
                  <Globe className="h-3.5 w-3.5" />
                  Buscar na web
                </Button>
                <span className="text-[11px] text-muted-foreground/80">~$0,25 · resgata ~1 em 5</span>
              </>
            )}
            {jaTentouWeb && (
              <span className="text-[11px] text-muted-foreground/80">
                A busca na web também não encontrou descrição da estrutura.
              </span>
            )}
            {canOverride && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  onClick={() => void onOverride("flashforward")}
                >
                  <Pencil className="h-3 w-3" />É flashforward
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  onClick={() => void onOverride("linear")}
                >
                  É cronológico
                </Button>
              </>
            )}
          </>
        ) : override ? (
          canOverride && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => void onOverride(null)}
            >
              <Pencil className="h-3 w-3" />
              Desfazer marcação
            </Button>
          )
        ) : (
          canRunAi && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => void onAnalyze("local")}
            >
              Analisar de novo
            </Button>
          )
        )}
      </CardContent>
    </Card>
  )
}
