import "server-only"
// ============================================================================
// MEDIDA TEMPORÁRIA — painel do shadow A/B (arm A = v3.3 exibido; arm B = v4+ItemA).
// Auto-gated pela flag INTEREST_SHADOW. Remover junto com a medida quando a
// decisão A×B for tomada. Ver PLANO-INTERESSE-PREFS-CONFIANCA.md §Shadow.
// ============================================================================
import { isInterestShadowEnabled } from "@/lib/ai-evaluation/compiled-preferences"
import {
  getShadowComparisonRows,
  getSynopsisVersionComparison,
  type ShadowCompareRow,
  type SynopsisVersionComparison,
} from "@/server/queries/synopsis-quality"

function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}
function conf(c: number | null): string {
  return c == null ? "—" : c.toFixed(2)
}
function q(v: string | null): string {
  return v ?? "—"
}

/** Veredito simples: B vence só se ficou mais perto com significância, sem perder mais gems nem inundar ♥♥♥♥. */
function verdict(c: SynopsisVersionComparison): { label: string; tone: "b" | "a" | "tie" } {
  const bBetterRate = c.worseRate // A pior = B melhor
  const bWins =
    bBetterRate > c.betterRate &&
    c.signP < 0.05 &&
    c.gemsLostPrevious <= c.gemsLostCurrent &&
    (c.highPrecPrevious == null || c.highPrecCurrent == null || c.highPrecPrevious >= c.highPrecCurrent)
  const aWins =
    c.betterRate > bBetterRate &&
    c.signP < 0.05
  if (bWins) return { label: "B (novo) parece melhor — significativo", tone: "b" }
  if (aWins) return { label: "A (atual) parece melhor — significativo", tone: "a" }
  return { label: "Inconclusivo — sem diferença significativa ainda", tone: "tie" }
}

export async function ShadowComparePanel({
  comparison: comparisonProp,
}: {
  /** Reusa a comparação já buscada pela página (SynopsisAccuracyBar) — evita
   *  refazer `getSynopsisVersionComparison()` na aba Interesse. */
  comparison?: SynopsisVersionComparison | null
} = {}) {
  if (!isInterestShadowEnabled()) return null
  const rows = await getShadowComparisonRows()
  const comparison = comparisonProp !== undefined ? comparisonProp : await getSynopsisVersionComparison()
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          Shadow A/B · ativo
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          Sem obras com o arm B ainda. Clique <b>&quot;Reprever&quot;</b> numa obra (perfil precisa estar
          fresco), espere ~30s e recarregue — o arm B roda em background.
        </span>
      </div>
    )
  }

  const withManual = rows.filter((r) => r.manual != null).length
  const discordant = rows.filter((r) => r.discordant).length

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          Shadow A/B · temporário
        </span>
        <span className="text-muted-foreground">
          A = atual (v3.3) · B = novo (v4 + tags declaradas). B não é exibido como headline.
        </span>
      </div>

      {comparison ? (
        <ShadowMetrics c={comparison} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {rows.length} obra(s) com os 2 arms · {withManual} com nota manual · {discordant} discordante(s).
          Métricas de decisão aparecem quando houver pares com nota manual.
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Ver por obra ({rows.length}) — discordantes primeiro
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3 font-medium">Obra</th>
                <th className="py-1 pr-3 font-medium">A (♥ · conf)</th>
                <th className="py-1 pr-3 font-medium">B (♥ · conf)</th>
                <th className="py-1 pr-3 font-medium">Manual</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: ShadowCompareRow) => (
                <tr
                  key={r.workId}
                  className={r.discordant ? "bg-amber-500/10" : undefined}
                >
                  <td className="py-1 pr-3">{r.title}</td>
                  <td className="py-1 pr-3 tabular-nums">
                    {q(r.armA.quality)} · {conf(r.armA.confidence)}
                  </td>
                  <td className="py-1 pr-3 tabular-nums">
                    {q(r.armB.quality)} · {conf(r.armB.confidence)}
                  </td>
                  <td className="py-1 pr-3 tabular-nums">{q(r.manual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function ShadowMetrics({ c }: { c: SynopsisVersionComparison }) {
  const v = verdict(c)
  const toneClass =
    v.tone === "b"
      ? "text-emerald-700 dark:text-emerald-300"
      : v.tone === "a"
        ? "text-sky-700 dark:text-sky-300"
        : "text-muted-foreground"
  return (
    <div className="space-y-1.5">
      <p className={`text-xs font-medium ${toneClass}`}>{v.label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-3">
        <span>pares: <b className="text-foreground">{c.nPaired}</b> ({c.discordant} discordantes)</span>
        <span>MAE — A {c.maeCurrent.toFixed(2)} · B {c.maePrevious.toFixed(2)}</span>
        <span>bias — A {c.biasCurrent >= 0 ? "+" : ""}{c.biasCurrent.toFixed(2)} · B {c.biasPrevious >= 0 ? "+" : ""}{c.biasPrevious.toFixed(2)}</span>
        <span>B mais perto: <b className="text-foreground">{pct(c.worseRate)}</b> · A: {pct(c.betterRate)}</span>
        <span>gems perdidas — A {c.gemsLostCurrent} · B {c.gemsLostPrevious}</span>
        <span>precisão ♥♥♥♥ — A {c.highPrecCurrent == null ? "—" : pct(c.highPrecCurrent)} · B {c.highPrecPrevious == null ? "—" : pct(c.highPrecPrevious)}</span>
        <span>teste de sinal p = <b className="text-foreground">{c.signP.toFixed(3)}</b></span>
      </div>
    </div>
  )
}
