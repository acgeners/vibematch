"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ACCENT_BUTTON } from "@/lib/settings-accent"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRefresh } from "@/lib/use-refresh"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { runTask } from "@/lib/tasks-store"
import { previewCost } from "@/lib/cost-preview/catalog"
import { formatUsdApprox } from "@/lib/format/money"
import { STATUS_CHIP_BASE, STATUS_TONE } from "@/lib/ui/status-tone"
import { enrichmentNeedsRecovery, enrichmentStatusView, recoveryState, stillNeedsRecovery } from "@/lib/tags/enrichment-view"
import type { RecoveryState } from "@/lib/tags/enrichment-view"
import {
  changeTagGroup,
  confirmNewTags,
  reprocessTagEnrichment,
  setTagAdult,
  type AdultLevel,
  type NewTagRow,
} from "@/server/actions/tag-review"

const AFFIRM_BTN = ACCENT_BUTTON.slate

const ADULT_LABEL: Record<AdultLevel, string> = {
  none: "Não é 18+",
  label: "18+ · rótulo",
  explicit: "18+ · explícito",
}

/**
 * O que o seletor de 18+ mostra. 🔴 Numa tag cuja classificação NÃO terminou, flag falsa quer dizer
 * "ninguém avaliou", não "avaliado e sem sinal": ela aparece como não avaliada, nunca "Não é 18+" —
 * salvo quando um HUMANO decidiu o 18+ (`humanDecisions.adult`), e aí "Não é 18+" é decisão dele.
 * Flag verdadeira é dado gravado (por alguém) e aparece como é.
 */
export function adultShownFor(
  t: Pick<NewTagRow, "adultLevel" | "enrichmentStatus" | "humanDecisions">,
): AdultLevel | undefined {
  if (enrichmentNeedsRecovery(t.enrichmentStatus) && !t.humanDecisions.adult && t.adultLevel === "none") return undefined
  return t.adultLevel
}

export function rowRecoveryState(t: Pick<NewTagRow, "enrichmentStatus" | "groupSlug" | "humanDecisions">): RecoveryState {
  return recoveryState({ enrichmentStatus: t.enrichmentStatus, hasGroup: Boolean(t.groupSlug), humanDecisions: t.humanDecisions })
}

/**
 * Campo a campo, quem decidiu — o que a recuperação precisa (grupo e 18+) e o que mais um humano tenha
 * decidido. Sem isto a tela ou esconderia a falha original, ou ignoraria a correção humana.
 */
function camposDaLinha(t: NewTagRow, shownAdult: AdultLevel | undefined): string[] {
  const hd = t.humanDecisions
  const recuperando = enrichmentNeedsRecovery(t.enrichmentStatus)
  const out: string[] = []
  if (hd.group) out.push("Grupo: decidido por você")
  else if (recuperando) out.push(t.groupSlug ? "Grupo: definido automaticamente" : "Grupo: pendente")
  if (hd.adult) out.push("18+: decidido por você")
  else if (recuperando) out.push("18+: pendente")
  if (hd.adult_score_tier) out.push("Piso: decidido por você")
  else if (recuperando && shownAdult && shownAdult !== "none") out.push("Piso: na fila Piso adulto")
  if (hd.subgroup) out.push("Subgrupo: decidido por você")
  return out
}

export function NewTagsPanel({
  tags,
  groups,
}: {
  tags: NewTagRow[]
  groups: Array<{ slug: string; label: string }>
}) {
  const doRefresh = useRefresh()
  const confirmCost = useCostConfirm()
  const [isPending, startTransition] = useTransition()
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const visible = tags.filter((t) => !removed.has(t.id))
  const reprocessCost = formatUsdApprox(previewCost("enrich_tag").likelyUsd)

  const confirm = (id: string) => {
    setRemoved((p) => new Set(p).add(id))
    startTransition(async () => {
      const { ok } = await confirmNewTags([id])
      if (!ok) {
        setRemoved((p) => {
          const n = new Set(p)
          n.delete(id)
          return n
        })
        toast.error("Falha ao confirmar")
      } else {
        doRefresh()
      }
    })
  }

  const updateAdult = (id: string, level: AdultLevel) => {
    startTransition(async () => {
      const { ok } = await setTagAdult(id, level)
      toast[ok ? "success" : "error"](ok ? "Sinal 18+ atualizado" : "Falha ao atualizar 18+")
      if (ok) doRefresh()
    })
  }

  const updateGroup = (id: string, slug: string) => {
    startTransition(async () => {
      const { ok } = await changeTagGroup(id, slug)
      toast[ok ? "success" : "error"](ok ? "Grupo atualizado" : "Falha ao trocar grupo")
      if (ok) doRefresh()
    })
  }

  // 🔴 Chamada PAGA: só por clique, sempre depois do popup de custo. Nada aqui reprocessa sozinho.
  const reprocess = async (t: NewTagRow) => {
    const ok = await confirmCost({ action: "enrich_tag" })
    if (!ok) return
    runTask({
      id: `reprocess-tag-${t.id}`,
      kind: "tag-enrichment",
      label: `Classificar a tag "${t.name}" com IA`,
      run: async () => {
        const r = await reprocessTagEnrichment(t.id)
        // A action devolve `{ ok: false }` em vez de lançar; sem o throw, o indicador diria "pronto".
        if (!r.ok) throw new Error(r.error)
        if (r.status !== "done") {
          const view = enrichmentStatusView(r.status)
          throw new Error(`não concluiu — ${view?.label ?? r.status}${r.detail ? `: ${r.detail}` : ""}`)
        }
        return r
      },
      successToast: () => ({ message: `Tag "${t.name}" classificada pela IA` }),
      onDone: () => doRefresh(),
      // Falhou de novo: o motivo novo está gravado e a linha precisa mostrá-lo.
      onError: () => doRefresh(),
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tags <strong className="text-foreground">criadas automaticamente</strong> das fontes externas, ainda não
        revisadas, e tags de qualquer origem cuja <strong className="text-foreground">classificação automática não
        terminou</strong>. Quando a linha tem um aviso de estado, grupo e 18+ <strong className="text-foreground">não
        foram decididos pela IA</strong>: reprocesse (pago) ou decida à mão — com o grupo definido e o 18+ decidido
        por você, a tag sai da recuperação. Nas demais, grupo e 18+ vêm da classificação automática; confirmar
        apenas tira da fila.
      </p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border/65 bg-background/40 p-8 text-center text-sm text-muted-foreground">
          Nenhuma tag nova para revisar. 🎉
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((t) => {
            const view = enrichmentStatusView(t.enrichmentStatus)
            const shownAdult = adultShownFor(t)
            const estado = rowRecoveryState(t)
            const campos = camposDaLinha(t, shownAdult)
            return (
              <div
                key={t.id}
                data-testid={`tag-nova-${t.slug}`}
                className={`flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:justify-between ${
                  shownAdult && shownAdult !== "none" ? "border-l-2 border-l-rose-500/70 border-border" : "border-border"
                }`}
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[15px] font-semibold">{t.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{t.slug}</span>
                    {view && (
                      <span className={`${STATUS_CHIP_BASE} ${STATUS_TONE[view.tone].chip}`} title={view.hint}>
                        {view.label}
                      </span>
                    )}
                    {estado === "resolved_manually" && (
                      <span
                        className={`${STATUS_CHIP_BASE} ${STATUS_TONE.ok.chip}`}
                        title="A classificação automática não terminou, mas grupo e 18+ foram decididos à mão."
                      >
                        Recuperada manualmente
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="tabular-nums font-medium text-foreground">{t.workCount}</span> obra
                    {t.workCount === 1 ? "" : "s"}
                    {t.groupLabel && (
                      <>
                        {" · grupo "}
                        <span className="text-foreground">{t.groupLabel}</span>
                      </>
                    )}
                  </div>
                  {view && (
                    <div className="max-w-prose text-xs text-muted-foreground">
                      {t.enrichmentDetail ? `Motivo: ${t.enrichmentDetail}` : view.hint}
                    </div>
                  )}
                  {campos.length > 0 && (
                    <div className="text-xs text-muted-foreground" data-testid={`campos-${t.slug}`}>
                      {campos.join(" · ")}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Select value={shownAdult} onValueChange={(v) => updateAdult(t.id, v as AdultLevel)}>
                    <SelectTrigger className="h-8 w-[150px] text-xs" disabled={isPending} aria-label="Sinal 18+">
                      <SelectValue placeholder="18+ não avaliado">{shownAdult ? ADULT_LABEL[shownAdult] : undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{ADULT_LABEL.none}</SelectItem>
                      <SelectItem value="label">{ADULT_LABEL.label}</SelectItem>
                      <SelectItem value="explicit">{ADULT_LABEL.explicit}</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={t.groupSlug || undefined} onValueChange={(v) => updateGroup(t.id, v)}>
                    <SelectTrigger className="h-8 w-[150px] text-xs" disabled={isPending}>
                      <SelectValue placeholder="Trocar grupo" />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.slug} value={g.slug}>
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {stillNeedsRecovery(estado) ? (
                    <div className="flex flex-col items-start gap-0.5">
                      <Button size="sm" variant="outline" className="h-8" disabled={isPending} onClick={() => reprocess(t)}>
                        ✨ Reprocessar com IA
                      </Button>
                      <span className="text-[11px] text-muted-foreground">chamada paga · {reprocessCost}</span>
                    </div>
                  ) : (
                    <Button size="sm" className={`h-8 ${AFFIRM_BTN}`} disabled={isPending} onClick={() => confirm(t.id)}>
                      <Check className="mr-1 h-3.5 w-3.5" /> Confirmar
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
