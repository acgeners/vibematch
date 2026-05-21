"use client"

import { useMemo, useState, useTransition } from "react"
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

interface SuggestionsListProps {
  suggestions: SuggestionWithWork[]
}

export function SuggestionsList({ suggestions }: SuggestionsListProps) {
  const [criterion, setCriterion] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [minDelta, setMinDelta] = useState("0.5")
  const [bulkConf, setBulkConf] = useState("0.9")
  const [bulkPending, startBulk] = useTransition()
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const minDeltaNum = Number(minDelta.replace(",", ".")) || 0
    const term = search.trim().toLowerCase()
    return suggestions.filter((s) => {
      if (criterion !== "all" && s.criterion_slug !== criterion) return false
      if (Math.abs(s.delta) < minDeltaNum) return false
      if (term && !s.work_title.toLowerCase().includes(term)) return false
      return true
    })
  }, [suggestions, criterion, minDelta, search])

  const eligibleForBulk = useMemo(() => {
    const min = Number(bulkConf.replace(",", ".")) || 0
    return suggestions.filter((s) => s.status === "pending" && s.confidence >= min).length
  }, [suggestions, bulkConf])

  const handleBulk = () => {
    setBulkMsg(null)
    const min = Number(bulkConf.replace(",", "."))
    if (!Number.isFinite(min) || min <= 0 || min > 1) {
      setBulkMsg("Confidence precisa estar entre 0 e 1.")
      return
    }
    startBulk(async () => {
      const res = await bulkAcceptAction({ minConfidence: min })
      const errPart = res.errors.length ? ` Erros: ${res.errors.slice(0, 2).join("; ")}` : ""
      setBulkMsg(`${res.accepted} aceita(s), ${res.failed} falha(s).${errPart}`)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1 block text-xs text-muted-foreground">Busca por título</label>
          <Input
            placeholder="Filtrar obras..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
        <div className="w-32">
          <label className="mb-1 block text-xs text-muted-foreground">|Δ| mínimo</label>
          <Input
            type="number"
            step="0.1"
            min="0"
            value={minDelta}
            onChange={(e) => setMinDelta(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2">
        <div className="text-xs text-muted-foreground">
          Bulk-aceitar pendentes com confidence ≥
        </div>
        <Input
          type="number"
          step="0.05"
          min="0.5"
          max="1"
          value={bulkConf}
          onChange={(e) => setBulkConf(e.target.value)}
          className="w-20"
        />
        <Badge variant="outline">{eligibleForBulk} elegível(eis)</Badge>
        <Button size="sm" onClick={handleBulk} disabled={bulkPending || eligibleForBulk === 0}>
          {bulkPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          Aplicar em massa
        </Button>
        {bulkMsg && <p className="ml-2 text-xs text-foreground/80">{bulkMsg}</p>}
      </div>

      <div className="text-xs text-muted-foreground">
        {filtered.length} sugestão(ões) listada(s) (de {suggestions.length} no total).
      </div>

      <div className="space-y-2">
        {filtered.map((s) => (
          <SuggestionRow key={s.id} suggestion={s} />
        ))}
      </div>
    </div>
  )
}
