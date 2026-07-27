"use client"

import { useState } from "react"
import { Upload, ClipboardCheck, History } from "lucide-react"
import { useRefresh } from "@/lib/use-refresh"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { StatCard } from "@/components/settings/stat-card"
import { ExternalListImport } from "@/components/import/external-list-import"
import { ExportHelp } from "@/components/import/export-help"
import { ImportHistory } from "@/components/import/import-history"
import { SourceTag } from "@/components/import/source-tag"
import { ImportReview } from "@/components/titles/import-review"
import type { ReviewWork } from "@/server/actions/enrich"
import type { ImportHistoryRow, ImportStats } from "@/server/queries/imports"

const RELATIVE = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" })

function relativeDays(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const days = Math.round((then - Date.now()) / 86_400_000)
  if (days === 0) return "hoje"
  return RELATIVE.format(days, "day")
}

export function ImportModes({
  pendingReviewWorks,
  history,
  stats,
}: {
  pendingReviewWorks: ReviewWork[]
  history: ImportHistoryRow[]
  stats: ImportStats
}) {
  const refresh = useRefresh()
  const [tab, setTab] = useState("import")
  // Obras revisadas nesta sessão — somem da contagem de pendentes.
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())

  const pending = pendingReviewWorks.filter((w) => !reviewed.has(w.id))
  const pendingCount = pending.length
  const coverless = pending.filter((w) => w.coverCount === 0).length
  const pct =
    stats.catalogCount > 0 ? Math.round((stats.evaluatedCount / stats.catalogCount) * 100) : 0

  return (
    <div className="space-y-6">
      {/* ── Panorama ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="No catálogo"
          value={<span className="tabular-nums">{stats.catalogCount}</span>}
          hint={`obras · ${pct}% já avaliadas pela IA`}
        />
        <StatCard
          label="Pendentes de revisão"
          value={
            <span className={pendingCount > 0 ? "tabular-nums text-amber-600 dark:text-amber-400" : "tabular-nums"}>
              {pendingCount}
            </span>
          }
          hint={pendingCount === 0 ? "nada a revisar" : coverless > 0 ? `${coverless} sem capa` : "todas com capa"}
        />
        <StatCard
          label="Última importação"
          value={stats.lastImport ? relativeDays(stats.lastImport.createdAt) : "—"}
          valueClassName="text-sm"
          hint={
            stats.lastImport ? (
              <span className="inline-flex items-center gap-1.5">
                <SourceTag source={stats.lastImport.source} className="px-1.5 py-0" />
                {stats.lastImport.createdCount > 0 ? `+${stats.lastImport.createdCount} novas` : "sem novas"}
              </span>
            ) : (
              "nenhuma ainda"
            )
          }
        />
      </div>

      {/* ── Abas ─────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="import">
            <Upload /> Importar
          </TabsTrigger>
          <TabsTrigger value="review">
            <ClipboardCheck /> Revisar pendentes
            {pendingCount > 0 && (
              <span className="tabular-nums text-xs text-muted-foreground">{pendingCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History /> Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4 pt-5">
          <ExternalListImport
            onReviewBatchComplete={() => {
              // Lote de "Buscar dados das sem capa" terminou → atualiza pendentes
              // (servidor) e vai pra aba de revisão.
              refresh()
              setTab("review")
            }}
          />
          <ExportHelp />
        </TabsContent>

        <TabsContent value="review" className="space-y-3 pt-5">
          <p className="text-sm text-muted-foreground">
            Obras importadas pendentes de avaliação. Busque capa/sinopses das que estão sem capa e
            confira o que veio das fontes. As notas dos atributos são geradas na Avaliação IA.
          </p>
          <ImportReview
            works={pendingReviewWorks}
            onReviewed={(id) => setReviewed((prev) => new Set(prev).add(id))}
          />
        </TabsContent>

        <TabsContent value="history" className="pt-5">
          <ImportHistory rows={history} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
