import { Activity } from "lucide-react"
import { Header } from "@/components/layout/header"
import { getModelMetricsDashboard, MIN_RANKING_GROUP_SIZE } from "@/server/queries/prediction-metrics"
import type { CollectionStatus } from "@/lib/server/predictions/collection-status"
import {
  MIN_PROSPECTIVE_SAMPLE_SIZE,
  parseModelEvaluationMetrics,
  selectPrimaryModelMetric,
  describeMetricSource,
  calculateRelativeErrorReduction,
} from "@/lib/metrics/model-evaluation"
import type { BucketErrorEntry, BaselineRow } from "@/lib/metrics/prediction-metrics"

export const dynamic = "force-dynamic"

function fmt(v: number | null | undefined, digits = 2): string {
  return v != null && Number.isFinite(v) ? v.toFixed(digits) : "—"
}

function pct(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : "—"
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR")
}

function fmtDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—"
  const days = ms / 86_400_000
  if (days >= 1) return `${days.toFixed(1)} d`
  const hours = ms / 3_600_000
  if (hours >= 1) return `${hours.toFixed(1)} h`
  return `${(ms / 60_000).toFixed(0)} min`
}

const STATUS_BANNER: Record<CollectionStatus, { tone: "ok" | "warn" | "err"; text: string }> = {
  active: { tone: "ok", text: "Coleta prospectiva ativa." },
  no_data: { tone: "ok", text: "Coleta prospectiva ativa — sem dados resolvidos ainda." },
  migration_missing: { tone: "warn", text: "Coleta indisponível: a migration 105 ainda não foi aplicada." },
  connection_error: { tone: "err", text: "Coleta indisponível: erro de conexão com o banco." },
  unexpected_error: { tone: "err", text: "Coleta indisponível: erro inesperado ao ler os snapshots." },
}

export const metadata = { title: "Métricas do modelo" }

export default async function ModelMetricsPage() {
  const d = await getModelMetricsDashboard()

  // F4: métrica principal = prospectiva por OBRA (sem pseudorreplicação) > CV > indisponível.
  const metrics = parseModelEvaluationMetrics({
    crossValidationMae: d.cvMae,
    prospectiveMae: d.primary.mae,
    prospectiveSampleSize: d.primary.count,
    prospectiveEvaluatedAt: d.lastResolvedAt,
    baselineMae: d.primaryBaselines.find((b) => b.key === "mean")?.mae ?? null,
    sampleSize: d.primary.count,
  })
  const primary = selectPrimaryModelMetric(metrics)
  const copy = describeMetricSource(primary.source)
  const reduction =
    primary.mae != null && metrics.baselineMae != null
      ? calculateRelativeErrorReduction(primary.mae, metrics.baselineMae)
      : null
  const cvVsProspective =
    d.primary.mae != null && d.cvMae != null ? d.primary.mae - d.cvMae : null
  const smallSample = d.primary.count > 0 && d.primary.count < MIN_PROSPECTIVE_SAMPLE_SIZE

  const banner = STATUS_BANNER[d.status]

  return (
    <div className="w-full max-w-5xl space-y-6">
      <Header
        kicker="Diagnóstico técnico"
        title="Métricas do modelo (prospectivas)"
        description="Validação prequencial: previsões registradas ANTES da nota real (prediction_snapshots). Métrica principal = 1 previsão por obra; baselines no mesmo conjunto."
        icon={<Activity />}
      />

      <p
        className={
          "rounded-md border px-3 py-2 text-sm " +
          (banner.tone === "ok"
            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
            : banner.tone === "warn"
              ? "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400"
              : "border-rose-500/40 bg-rose-500/5 text-rose-600 dark:text-rose-400")
        }
      >
        {banner.text}
        {d.status === "migration_missing" && (
          <> Aplique <span className="font-mono">105_prediction_snapshots.sql</span> no SQL Editor.</>
        )}
      </p>

      {/* Aviso obrigatório de viés de seleção */}
      <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        As métricas consideram apenas obras posteriormente avaliadas. Obras ignoradas ou ainda não
        lidas permanecem pendentes, portanto os resultados podem não representar todas as
        recomendações exibidas. Previsões pendentes <span className="font-medium">não</span> são
        tratadas como erro nem nota zero.
      </p>

      {smallSample && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          Amostra inicial ({d.primary.count} obras resolvidas). As métricas ainda podem variar
          significativamente — abaixo de {MIN_PROSPECTIVE_SAMPLE_SIZE} a prospectiva não vira a métrica
          principal.
        </p>
      )}

      {/* ── Cobertura / viés de seleção ─────────────────────────── */}
      <Panel title="Cobertura da coleta" hint="Taxa de resolução = quantas previsões já têm nota real. Por obra única evita contar a mesma obra várias vezes.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Registradas" value={String(d.stats.recorded)} />
          <Kpi label="Resolvidas" value={String(d.stats.resolved)} />
          <Kpi label="Pendentes" value={String(d.stats.pending)} />
          <Kpi label="Superseded" value={String(d.stats.superseded)} />
          <Kpi label="Taxa de resolução" value={pct(d.stats.resolutionRate)} />
          <Kpi label="Taxa por obra única" value={pct(d.stats.resolutionRateByWork)} />
          <Kpi label="Obras previstas" value={String(d.stats.uniqueWorksPredicted)} />
          <Kpi label="Obras avaliadas" value={String(d.stats.uniqueWorksEvaluated)} />
          <Kpi label="Rankings registrados" value={String(d.stats.rankingsRecorded)} />
          <Kpi label="Rankings calculáveis" value={String(d.ranking.usableGroups)} />
          <Kpi label="Previsões stub (excl.)" value={String(d.stubResolved)} />
          <Kpi label="Tempo mediano até avaliar" value={fmtDuration(d.medianTimeToEvalMs)} />
          <Kpi label="Última resolução" value={fmtDate(d.lastResolvedAt)} />
        </div>
      </Panel>

      {/* ── Métrica principal (por obra) ────────────────────────── */}
      <Panel title="Métrica principal — uma previsão por obra" hint="Sem pseudorreplicação: cada obra entra uma vez (snapshot mais recente antes da 1ª avaliação real).">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{copy.title}</p>
            <p className="font-mono text-3xl font-semibold tabular-nums">{fmt(primary.mae)}</p>
            <p className="text-[11px] text-muted-foreground" title={copy.tooltip}>
              fonte: {primary.source} · {primary.sampleSize ?? 0} obras
            </p>
          </div>
          <Stat label="RMSE" value={fmt(d.primary.rmse)} />
          <Stat label="Erro c/ sinal (médio)" value={fmt(d.primary.meanSignedError)} sub="+ = subestima" />
          <Stat label="Mediana |erro|" value={fmt(d.primary.medianAbsError)} />
          <Stat label="MAE CV/OOF" value={fmt(d.cvMae)} sub="validação cruzada" />
          <Stat
            label="Prospectiva − CV"
            value={cvVsProspective != null ? (cvVsProspective >= 0 ? `+${fmt(cvVsProspective)}` : fmt(cvVsProspective)) : "—"}
            sub="+ = prospectiva pior"
          />
          <Stat
            label="Redução vs baseline"
            value={reduction != null ? `${(reduction * 100).toFixed(0)}%` : "—"}
            sub="menos erro que a média"
          />
        </div>
      </Panel>

      <Panel title="Baselines no mesmo conjunto (por obra)" hint="Comparação honesta: todos avaliados nas MESMAS obras (cobertura por preditor pode reduzir o count).">
        <BaselineTable rows={d.primaryBaselines} />
      </Panel>

      <Panel
        title={`Baselines no subconjunto comum (${d.primaryCommonSubset.subsetCount} obras)`}
        hint="Só obras com Nota Prevista, Nota.Calc e Prioridade presentes — comparação direta."
      >
        {d.primaryCommonSubset.subsetCount === 0 ? <Empty /> : <BaselineTable rows={d.primaryCommonSubset.rows} />}
      </Panel>

      <Panel title="Erro por faixa de nota prevista (por obra)">
        <BucketTable rows={d.byScoreBand} />
      </Panel>
      <Panel
        title="Erro por versão da fórmula"
        hint="Uma observação por obra POR fórmula (não só a mais recente) — permite comparação pareada entre versões no mesmo conjunto de obras. Stub/superseded excluídos."
      >
        <BucketTable rows={d.byFormula} />
      </Panel>
      <Panel title="Erro por período (mês de resolução, por obra)">
        <BucketTable rows={d.byPeriod} />
      </Panel>

      {/* ── Diagnóstico por snapshot ────────────────────────────── */}
      <Panel
        title="Métrica por snapshot (diagnóstica)"
        hint="Usa TODOS os snapshots resolvidos (uma obra vista N vezes pesa N×). Não substitui a métrica principal por obra."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
          <Stat label="Snapshots resolvidos" value={String(d.perSnapshot.count)} />
          <Stat label="MAE por snapshot" value={fmt(d.perSnapshot.mae)} />
          <Stat label="RMSE por snapshot" value={fmt(d.perSnapshot.rmse)} />
          <Stat label="Snapshots por obra (média)" value={fmt(d.avgSnapshotsPerWork, 1)} />
        </div>
      </Panel>

      {/* ── Ranking ─────────────────────────────────────────────── */}
      <Panel
        title="Ordenação (por grupo de recomendação)"
        hint={`Por ranking_snapshot_id, sem deduplicar obras entre rankings. Só grupos com ≥ ${MIN_RANKING_GROUP_SIZE} obras resolvidas. Média entre ${d.ranking.usableGroups} de ${d.ranking.totalGroups} grupo(s).`}
      >
        {d.ranking.aggregate == null ? (
          <p className="text-sm text-muted-foreground">Sem amostra suficiente para métricas de ordenação ainda.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
            <Stat label="Spearman" value={fmt(d.ranking.aggregate.spearman)} />
            <Stat label="Kendall τ" value={fmt(d.ranking.aggregate.kendallTau)} />
            <Stat label="Pairwise acc" value={fmt(d.ranking.aggregate.pairwiseAccuracy)} />
            <Stat label="NDCG@5" value={fmt(d.ranking.aggregate.ndcgAt5)} />
            <Stat label="NDCG@10" value={fmt(d.ranking.aggregate.ndcgAt10)} />
            <Stat label="P@5" value={fmt(d.ranking.aggregate.precisionAt5)} />
            <Stat label="P@10" value={fmt(d.ranking.aggregate.precisionAt10)} />
            <Stat label="Regret@10" value={fmt(d.ranking.aggregate.regretAt10)} />
          </div>
        )}
      </Panel>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Empty() {
  return <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
}

function BucketTable({ rows }: { rows: BucketErrorEntry[] }) {
  if (rows.length === 0) return <Empty />
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <th className="py-1 font-medium">Faixa</th>
          <th className="py-1 text-right font-medium">Obras</th>
          <th className="py-1 text-right font-medium">MAE</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-border/40">
            <td className="py-1 font-mono">{r.label}</td>
            <td className="py-1 text-right font-mono">{r.count}</td>
            <td className="py-1 text-right font-mono">{fmt(r.mae)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BaselineTable({ rows }: { rows: BaselineRow[] }) {
  if (rows.length === 0) return <Empty />
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <th className="py-1 font-medium">Preditor</th>
          <th className="py-1 text-right font-medium">Obras</th>
          <th className="py-1 text-right font-medium">MAE</th>
          <th className="py-1 text-right font-medium">RMSE</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-border/40">
            <td className="py-1">{r.label}</td>
            <td className="py-1 text-right font-mono">{r.count}</td>
            <td className="py-1 text-right font-mono">{fmt(r.mae)}</td>
            <td className="py-1 text-right font-mono">{fmt(r.rmse)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
