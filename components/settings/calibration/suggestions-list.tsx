"use client"

import { useCallback, useMemo, useState, useTransition } from "react"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { SuggestionRow } from "./suggestion-row"
import { bulkAcceptAction } from "@/server/actions/calibration"
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
  criterion_asc: "Critério A→Z",
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
  const [search, setSearch] = useState("")
  const [minDelta, setMinDelta] = useState("0.5")
  const [minConf, setMinConf] = useState("0")
  const [sort, setSort] = useState<SortKey>("conf_desc")
  const [bulkPending, startBulk] = useTransition()
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)

  const hasPending = useMemo(() => suggestions.some((s) => s.status === "pending"), [suggestions])

  const minDeltaNum = Number(minDelta.replace(",", ".")) || 0
  // Confiança no filtro é em % (0–100), igual ao "conf X%" do card; converte pra
  // 0–1 pra comparar com `s.confidence`.
  const minConfPct = Number(minConf.replace(",", ".")) || 0
  const minConfNum = minConfPct / 100

  // Condição ESTRUTURAL (critério + |Δ| mínimo + confiança mínima) — a mesma que
  // o "Aplicar em massa" usa no servidor. A busca por título NÃO entra aqui (é só
  // pra navegar) e por isso o bulk a ignora.
  const matchesStructural = useCallback(
    (s: SuggestionWithWork) =>
      (criterion === "all" || s.criterion_slug === criterion) &&
      Math.abs(s.delta) >= minDeltaNum &&
      s.confidence >= minConfNum,
    [criterion, minDeltaNum, minConfNum],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const out = suggestions.filter(
      (s) => matchesStructural(s) && (!term || s.work_title.toLowerCase().includes(term)),
    )
    return out.sort(SORT_CMP[sort])
  }, [suggestions, matchesStructural, search, sort])

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
    })
  }

  const visible = filtered.slice(0, RENDER_CAP)
  const truncatedLoad = totalAvailable != null && suggestions.length < totalAvailable

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-xs text-muted-foreground">Busca por título</label>
          <Input placeholder="Filtrar obras..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-44">
          <label className="mb-1 block text-xs text-muted-foreground">Critério</label>
          <Select value={criterion} onValueChange={setCriterion}>
            <SelectTrigger>
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
            Aplicar em massa nas pendentes que batem os filtros — conf ≥ {minConfPct}%, |Δ| ≥{" "}
            {minDeltaNum.toFixed(1)}
            {criterion !== "all" ? `, ${criterionName(criterion)}` : ""} (ignora a busca por título):
          </div>
          <Badge variant="outline">{eligible.length} elegível(eis)</Badge>
          <Button size="sm" onClick={handleBulk} disabled={bulkPending || eligible.length === 0}>
            {bulkPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Aplicar em massa
          </Button>
          {bulkMsg && <p className="ml-2 text-xs text-foreground/80">{bulkMsg}</p>}
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
          <SuggestionRow key={s.id} suggestion={s} />
        ))}
      </div>
    </div>
  )
}
