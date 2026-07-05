"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
import { Check, Loader2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import { useRefresh } from "@/lib/use-refresh"
import { SuggestionRow } from "./suggestion-row"
import {
  bulkAcceptAction,
  bulkAcceptByIdsAction,
  bulkRejectByIdsAction,
} from "@/server/actions/calibration"
import type { SuggestionWithWork } from "@/lib/ai-calibration/types"

// Teto de cards renderizados (a lista carrega TODAS as pendentes pra filtro/ordem
// exatos, mas renderizar 800+ trava). Refine os filtros pra ver além disso.
const RENDER_CAP = 150

type SortKey = "conf_desc" | "conf_asc" | "delta_desc" | "delta_asc" | "title_asc" | "criterion_asc"

const SORT_LABELS: Record<SortKey, string> = {
  conf_desc: "Confiança ↓",
  conf_asc: "Confiança ↑",
  delta_desc: "|Δ| ↓",
  delta_asc: "|Δ| ↑",
  title_asc: "Obra A→Z",
  criterion_asc: "Atributo A→Z",
}

const criterionName = (slug: string) => CRITERIA_INFO[slug]?.name ?? slug

const SORT_CMP: Record<SortKey, (a: SuggestionWithWork, b: SuggestionWithWork) => number> = {
  conf_desc: (a, b) => b.confidence - a.confidence,
  conf_asc: (a, b) => a.confidence - b.confidence,
  delta_desc: (a, b) => Math.abs(b.delta) - Math.abs(a.delta),
  delta_asc: (a, b) => Math.abs(a.delta) - Math.abs(b.delta),
  title_asc: (a, b) => a.work_title.localeCompare(b.work_title),
  criterion_asc: (a, b) => criterionName(a.criterion_slug).localeCompare(criterionName(b.criterion_slug)),
}

interface SuggestionsListProps {
  suggestions: SuggestionWithWork[]
  /** Total desse status no banco — pode ser > que as carregadas (mostra no rodapé). */
  totalAvailable?: number
}

export function SuggestionsList({ suggestions, totalAvailable }: SuggestionsListProps) {
  const [criterion, setCriterion] = useState<string>("all")
  const [minDelta, setMinDelta] = useState("0.5")
  const [minConf, setMinConf] = useState("90")
  const [sort, setSort] = useState<SortKey>("conf_desc")
  const [bulkPending, startBulk] = useTransition()
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selPending, startSel] = useTransition()
  const [selMsg, setSelMsg] = useState<string | null>(null)
  const refresh = useRefresh()

  const hasPending = useMemo(() => suggestions.some((s) => s.status === "pending"), [suggestions])

  const minDeltaNum = Number(minDelta.replace(",", ".")) || 0
  // Confiança no filtro é em % (0–100), igual ao "conf X%" do card; converte pra
  // 0–1 pra comparar com `s.confidence`.
  const minConfPct = Number(minConf.replace(",", ".")) || 0
  const minConfNum = minConfPct / 100

  // Condição ESTRUTURAL (atributo + |Δ| mínimo + confiança mínima) — a mesma que
  // o "Aplicar em massa" usa no servidor.
  const matchesStructural = useCallback(
    (s: SuggestionWithWork) =>
      (criterion === "all" || s.criterion_slug === criterion) &&
      Math.abs(s.delta) >= minDeltaNum &&
      s.confidence >= minConfNum,
    [criterion, minDeltaNum, minConfNum],
  )

  const filtered = useMemo(
    () => suggestions.filter(matchesStructural).sort(SORT_CMP[sort]),
    [suggestions, matchesStructural, sort],
  )

  // Elegíveis pro bulk: pendentes que batem a condição estrutural (sobre TODAS as
  // carregadas — com a carga de pendentes completa, = todas as pendentes).
  const eligible = useMemo(
    () => suggestions.filter((s) => s.status === "pending" && matchesStructural(s)),
    [suggestions, matchesStructural],
  )

  const handleBulk = () => {
    setBulkMsg(null)
    if (eligible.length === 0) return
    if (
      typeof window !== "undefined" &&
      eligible.length > 25 &&
      !window.confirm(`Aceitar ${eligible.length} sugestões em massa? Grava as notas e recalcula.`)
    ) {
      return
    }
    startBulk(async () => {
      const res = await bulkAcceptAction({
        minConfidence: minConfNum,
        minAbsDelta: minDeltaNum > 0 ? minDeltaNum : undefined,
        criterionSlug: criterion !== "all" ? criterion : undefined,
      })
      const errPart = res.errors.length ? ` Erros: ${res.errors.slice(0, 2).join("; ")}` : ""
      setBulkMsg(`${res.accepted} aceita(s), ${res.failed} falha(s).${errPart}`)
      refresh()
    })
  }

  const visible = filtered.slice(0, RENDER_CAP)
  const truncatedLoad = totalAvailable != null && suggestions.length < totalAvailable

  // --- Multi-select (checkbox) ---
  // Selecionáveis: só as linhas PENDENTES atualmente visíveis.
  const visiblePendingIds = useMemo(
    () => visible.filter((s) => s.status === "pending").map((s) => s.id),
    [visible],
  )
  const selectedVisibleCount = visiblePendingIds.filter((id) => selected.has(id)).length
  const allVisibleSelected = visiblePendingIds.length > 0 && selectedVisibleCount === visiblePendingIds.length
  const headerCheckState = allVisibleSelected
    ? true
    : selectedVisibleCount > 0
      ? "indeterminate"
      : false

  const toggleOne = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })

  const toggleAllVisible = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of visiblePendingIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const clearSelection = () => {
    setSelected(new Set())
    setSelMsg(null)
  }

  const handleAcceptSelected = () => {
    const ids = [...selected]
    if (ids.length === 0) return
    setSelMsg(null)
    startSel(async () => {
      const res = await bulkAcceptByIdsAction(ids)
      const errPart = res.errors.length ? ` Erros: ${res.errors.slice(0, 2).join("; ")}` : ""
      setSelMsg(`${res.accepted} aceita(s), ${res.failed} falha(s).${errPart}`)
      setSelected(new Set())
      refresh()
    })
  }

  const handleRejectSelected = () => {
    const ids = [...selected]
    if (ids.length === 0) return
    setSelMsg(null)
    startSel(async () => {
      const res = await bulkRejectByIdsAction(ids)
      setSelMsg(res.error ? `Erro: ${res.error}` : `${res.rejected} rejeitada(s).`)
      setSelected(new Set())
      refresh()
    })
  }

  const busy = bulkPending || selPending

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-72">
          <label className="mb-1 block text-sm font-semibold text-foreground">Atributo</label>
          <Select value={criterion} onValueChange={setCriterion}>
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {CRITERION_SLUGS.map((slug) => (
                <SelectItem key={slug} value={slug}>
                  {CRITERIA_INFO[slug]?.emoji} {CRITERIA_INFO[slug]?.name ?? slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs text-muted-foreground">|Δ| mínimo</label>
          <Input type="number" step="0.1" min="0" value={minDelta} onChange={(e) => setMinDelta(e.target.value)} />
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs text-muted-foreground">Confiança mín. (%)</label>
          <Input type="number" step="5" min="0" max="100" placeholder="0–100" value={minConf} onChange={(e) => setMinConf(e.target.value)} />
        </div>
        <div className="w-40">
          <label className="mb-1 block text-xs text-muted-foreground">Ordenar</label>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {hasPending && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
          <div className="text-xs text-muted-foreground">
            Aceitar em massa as pendentes que batem os filtros acima:
          </div>
          <Badge variant="outline">{eligible.length} elegível(eis)</Badge>
          <Button size="sm" onClick={handleBulk} disabled={busy || eligible.length === 0}>
            {bulkPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Aplicar em massa
          </Button>
          {bulkMsg && <p className="ml-2 text-xs text-foreground/80">{bulkMsg}</p>}
        </div>
      )}

      {visiblePendingIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={headerCheckState}
              onCheckedChange={(c) => toggleAllVisible(c === true)}
            />
            Selecionar visíveis ({visiblePendingIds.length})
          </label>
          {selected.size > 0 && (
            <>
              <Badge variant="outline">{selected.size} selecionada(s)</Badge>
              <Button size="sm" variant="outline" onClick={handleAcceptSelected} disabled={busy}>
                {selPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                )}
                Aceitar selecionadas
              </Button>
              <Button size="sm" variant="ghost" onClick={handleRejectSelected} disabled={busy}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                Rejeitar selecionadas
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection} disabled={busy}>
                Limpar
              </Button>
              {selMsg && <p className="ml-1 text-xs text-foreground/80">{selMsg}</p>}
            </>
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {filtered.length} filtrada(s) de {suggestions.length} carregada(s)
        {truncatedLoad ? ` · ${totalAvailable} no total (carregadas as ${suggestions.length} mais recentes)` : ""}
        {visible.length < filtered.length ? ` · mostrando ${visible.length} — refine os filtros pra ver as demais` : ""}
        .
      </div>

      <div className="space-y-2">
        {visible.map((s) => (
          <SuggestionRow
            key={s.id}
            suggestion={s}
            selectable={s.status === "pending"}
            selected={selected.has(s.id)}
            onSelectChange={(checked) => toggleOne(s.id, checked)}
          />
        ))}
      </div>
    </div>
  )
}
