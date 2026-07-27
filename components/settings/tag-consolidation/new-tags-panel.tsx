"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ACCENT_BUTTON } from "@/lib/settings-accent"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRefresh } from "@/lib/use-refresh"
import { changeTagGroup, confirmNewTags, setTagAdult, type AdultLevel, type NewTagRow } from "@/server/actions/tag-review"

const AFFIRM_BTN = ACCENT_BUTTON.slate

const ADULT_LABEL: Record<AdultLevel, string> = {
  none: "Não é 18+",
  label: "18+ · rótulo",
  explicit: "18+ · explícito",
}

export function NewTagsPanel({
  tags,
  groups,
}: {
  tags: NewTagRow[]
  groups: Array<{ slug: string; label: string }>
}) {
  const doRefresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const visible = tags.filter((t) => !removed.has(t.id))

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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tags <strong className="text-foreground">criadas automaticamente</strong> das fontes externas, ainda
        não revisadas. A IA já atribuiu grupo, subgrupo e sinal 18+; confirmar apenas tira da fila. Ajuste
        grupo ou 18+ quando a IA errar.
      </p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border/65 bg-background/40 p-8 text-center text-sm text-muted-foreground">
          Nenhuma tag nova para revisar. 🎉
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((t) => (
            <div
              key={t.id}
              className={`flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-start sm:justify-between ${
                t.adultLevel !== "none" ? "border-l-2 border-l-rose-500/70 border-border" : "border-border"
              }`}
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[15px] font-semibold">{t.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{t.slug}</span>
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
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select value={t.adultLevel} onValueChange={(v) => updateAdult(t.id, v as AdultLevel)}>
                  <SelectTrigger className="h-8 w-[150px] text-xs" disabled={isPending}>
                    <SelectValue />
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

                <Button size="sm" className={`h-8 ${AFFIRM_BTN}`} disabled={isPending} onClick={() => confirm(t.id)}>
                  <Check className="mr-1 h-3.5 w-3.5" /> Confirmar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
