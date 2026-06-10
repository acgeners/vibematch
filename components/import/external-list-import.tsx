"use client"

import { useState, useCallback } from "react"
import { Upload, FileText, Check, AlertCircle, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { analyzeExternalListImport, commitExternalListImport } from "@/server/actions/external-list-import"
import { getImportReviewWorks } from "@/server/actions/enrich"
import { ImportReview } from "@/components/titles/import-review"
import { EXTERNAL_LIST_SOURCE_LABELS } from "@/lib/import/external-list/types"
import type { ReviewWork } from "@/server/actions/enrich"
import type {
  AmbiguousDecision,
  AnalyzeExternalListResult,
  ExternalListDecisions,
  ExternalListSource,
  FieldChange,
  ReconcileField,
  CommitExternalListResult,
} from "@/lib/import/external-list/types"

type Phase = "upload" | "analyzing" | "review" | "committing" | "result"

const FIELD_LABELS: Record<ReconcileField, string> = {
  personal_status: "Status",
  user_score: "Nota",
  chapters_read: "Capítulos",
}

const SOURCES: ExternalListSource[] = ["myanimelist", "mangaupdates", "animeplanet"]

function fmt(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—"
  return String(value)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1] ?? "")
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function ExternalListImport({
  onReviewBatchComplete,
}: {
  // Chamado quando o lote de enriquecimento da etapa de revisão termina —
  // o caller (ImportModes) usa pra ir pra aba "Revisar pendentes".
  onReviewBatchComplete?: () => void
} = {}) {
  const [phase, setPhase] = useState<Phase>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [sourceOverride, setSourceOverride] = useState<ExternalListSource | "auto">("auto")
  const [contentBase64, setContentBase64] = useState<string>("")
  const [analysis, setAnalysis] = useState<AnalyzeExternalListResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commitResult, setCommitResult] = useState<CommitExternalListResult | null>(null)
  const [reviewWorks, setReviewWorks] = useState<ReviewWork[]>([])

  // Decisões do usuário
  const [conflictChoices, setConflictChoices] = useState<ExternalListDecisions["conflicts"]>({})
  const [ambiguousChoices, setAmbiguousChoices] = useState<ExternalListDecisions["ambiguous"]>({})
  const [skipCreates, setSkipCreates] = useState<Set<number>>(new Set())

  const reset = () => {
    setPhase("upload")
    setFile(null)
    setSourceOverride("auto")
    setContentBase64("")
    setAnalysis(null)
    setError(null)
    setCommitResult(null)
    setReviewWorks([])
    setConflictChoices({})
    setAmbiguousChoices({})
    setSkipCreates(new Set())
  }

  const runAnalyze = useCallback(async () => {
    if (!file) return
    setPhase("analyzing")
    setError(null)
    try {
      const base64 = await fileToBase64(file)
      setContentBase64(base64)
      const res = await analyzeExternalListImport({
        filename: file.name,
        contentBase64: base64,
        source: sourceOverride === "auto" ? undefined : sourceOverride,
      })
      if (res.error || !res.data) {
        setError(res.error ?? "Falha ao analisar o arquivo")
        setPhase("upload")
        return
      }
      // Inicializa decisões a partir dos defaults.
      const conflicts: ExternalListDecisions["conflicts"] = {}
      for (const plan of res.data.buckets.conflicts) {
        const perField: Partial<Record<ReconcileField, "local" | "imported">> = {}
        for (const c of plan.changes) {
          if (c.kind === "conflict") perField[c.field] = c.defaultChoice
        }
        conflicts[plan.entryIndex] = perField
      }
      const ambiguous: ExternalListDecisions["ambiguous"] = {}
      for (const a of res.data.buckets.ambiguous) {
        ambiguous[a.entryIndex] = a.candidates[0]
          ? { action: "match", workId: a.candidates[0].workId }
          : { action: "create" }
      }
      setConflictChoices(conflicts)
      setAmbiguousChoices(ambiguous)
      setSkipCreates(new Set())
      setAnalysis(res.data)
      setPhase("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ler o arquivo")
      setPhase("upload")
    }
  }, [file, sourceOverride])

  const runCommit = useCallback(async () => {
    if (!analysis) return
    setPhase("committing")
    setError(null)
    try {
      const res = await commitExternalListImport(
        { filename: file?.name ?? "lista", contentBase64, source: analysis.source },
        {
          conflicts: conflictChoices,
          ambiguous: ambiguousChoices,
          skipCreates: Array.from(skipCreates),
        }
      )
      if (res.error || !res.data) {
        setError(res.error ?? "Falha ao importar")
        setPhase("review")
        return
      }
      setCommitResult(res.data)
      if (res.data.createdWorkIds.length > 0) {
        setReviewWorks(await getImportReviewWorks(res.data.createdWorkIds))
      }
      setPhase("result")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na importação")
      setPhase("review")
    }
  }, [analysis, file, contentBase64, conflictChoices, ambiguousChoices, skipCreates])

  const reloadReview = useCallback(async () => {
    if (!commitResult) return
    setReviewWorks(await getImportReviewWorks(commitResult.createdWorkIds))
  }, [commitResult])

  // ── Upload ───────────────────────────────────────────────────────
  if (phase === "upload" || phase === "analyzing") {
    return (
      <div className="space-y-4">
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-card/50 px-6 py-10 text-center transition hover:bg-card/80"
        >
          <Upload className="h-7 w-7 text-muted-foreground" />
          <span className="text-sm font-medium">
            {file ? file.name : "Selecione um arquivo de lista"}
          </span>
          <span className="text-xs text-muted-foreground">
            MyAnimeList (.json) · MangaUpdates (.json) · Anime-Planet (.xml.gz)
          </span>
          <input
            type="file"
            accept=".json,.xml,.gz,.xml.gz,application/json,application/gzip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) {
                setFile(f)
                setError(null)
              }
            }}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Formato</span>
            <Select value={sourceOverride} onValueChange={(v) => setSourceOverride(v as ExternalListSource | "auto")}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Detectar automaticamente</SelectItem>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {EXTERNAL_LIST_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="mt-5"
            disabled={!file || phase === "analyzing"}
            onClick={runAnalyze}
          >
            {phase === "analyzing" ? "Analisando…" : "Analisar lista"}
          </Button>
        </div>

        {error && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        )}
      </div>
    )
  }

  // ── Result ───────────────────────────────────────────────────────
  if (phase === "result" && commitResult) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Check className="h-5 w-5 text-emerald-500" /> Importação concluída
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4 text-sm">
            <Counter label="Atualizadas" value={commitResult.updatedCount} />
            <Counter label="Criadas" value={commitResult.createdCount} />
            <Counter label="Puladas" value={commitResult.skippedCount} />
            <Counter label="Erros" value={commitResult.errorCount} tone={commitResult.errorCount > 0 ? "danger" : undefined} />
          </CardContent>
        </Card>
        {commitResult.errors.length > 0 && (
          <Card>
            <CardContent className="space-y-1 pt-6 text-sm text-destructive">
              {commitResult.errors.slice(0, 30).map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </CardContent>
          </Card>
        )}
        {reviewWorks.length > 0 && (
          <div className="space-y-3">
            <div>
              <h3 className="text-base font-semibold">Revisar importadas</h3>
              <p className="text-sm text-muted-foreground">
                Busque capa/sinopses das obras criadas e confira o que veio das fontes. As notas dos atributos são geradas depois, na Avaliação IA.
              </p>
            </div>
            <ImportReview works={reviewWorks} onReload={reloadReview} onBatchComplete={onReviewBatchComplete} />
          </div>
        )}
        <Button variant="outline" onClick={reset}>
          Importar outra lista
        </Button>
      </div>
    )
  }

  // ── Review ───────────────────────────────────────────────────────
  if (!analysis) return null
  const { buckets } = analysis
  const createCount = buckets.creates.length - skipCreates.size

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{EXTERNAL_LIST_SOURCE_LABELS[analysis.source]}</Badge>
        <span className="text-muted-foreground">
          {analysis.entryCount} entradas · {buckets.autoUpdate.length} atualizações ·{" "}
          {buckets.conflicts.length} conflitos · {buckets.ambiguous.length} a confirmar ·{" "}
          {buckets.creates.length} novas · {buckets.unchangedCount} sem mudança
        </span>
      </div>

      {/* Atualizar sem conflito */}
      {buckets.autoUpdate.length > 0 && (
        <CollapsibleCard
          title={`Atualizar sem conflito (${buckets.autoUpdate.length})`}
          description="Campos vazios serão preenchidos com os valores importados."
          defaultOpen={false}
        >
          <div className="space-y-2">
            {buckets.autoUpdate.map((plan) => (
              <div key={plan.entryIndex} className="rounded-md border border-border/60 p-2 text-sm">
                <div className="font-medium">{plan.workTitle}</div>
                <ChangeList changes={plan.changes} />
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {/* Conflitos */}
      {buckets.conflicts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conflitos ({buckets.conflicts.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {buckets.conflicts.map((plan) => (
              <div key={plan.entryIndex} className="rounded-md border border-border/60 p-3 text-sm">
                <div className="mb-2 font-medium">{plan.workTitle}</div>
                <div className="space-y-2">
                  {plan.changes.map((c) =>
                    c.kind === "fill" ? (
                      <p key={c.field} className="text-xs text-muted-foreground">
                        {FIELD_LABELS[c.field]}: {fmt(c.local)} <ArrowRight className="inline h-3 w-3" /> {fmt(c.imported)}
                      </p>
                    ) : (
                      <ConflictRow
                        key={c.field}
                        change={c}
                        choice={conflictChoices[plan.entryIndex]?.[c.field] ?? c.defaultChoice}
                        onChoose={(choice) =>
                          setConflictChoices((prev) => ({
                            ...prev,
                            [plan.entryIndex]: { ...prev[plan.entryIndex], [c.field]: choice },
                          }))
                        }
                      />
                    )
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Confirmar correspondência */}
      {buckets.ambiguous.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confirmar correspondência ({buckets.ambiguous.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {buckets.ambiguous.map((a) => {
              const decision = ambiguousChoices[a.entryIndex]
              return (
                <div key={a.entryIndex} className="rounded-md border border-border/60 p-3 text-sm">
                  <div className="mb-2 font-medium">{a.entry.title}</div>
                  <div className="flex flex-wrap gap-2">
                    {a.candidates.map((cand) => (
                      <ChoiceButton
                        key={cand.workId}
                        selected={decision?.action === "match" && decision.workId === cand.workId}
                        onClick={() => setAmbiguous(a.entryIndex, { action: "match", workId: cand.workId })}
                      >
                        {cand.title}{" "}
                        <span className="text-xs text-muted-foreground">({Math.round(cand.score * 100)}%)</span>
                      </ChoiceButton>
                    ))}
                    <ChoiceButton
                      selected={decision?.action === "create"}
                      onClick={() => setAmbiguous(a.entryIndex, { action: "create" })}
                    >
                      Criar nova
                    </ChoiceButton>
                    <ChoiceButton
                      selected={decision?.action === "skip"}
                      onClick={() => setAmbiguous(a.entryIndex, { action: "skip" })}
                    >
                      Pular
                    </ChoiceButton>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Criar novas */}
      {buckets.creates.length > 0 && (
        <CollapsibleCard
          title={`Criar novas (${createCount}/${buckets.creates.length})`}
          description="Novas obras entram como pendentes na fila de Avaliação IA."
          defaultOpen={false}
          action={
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() =>
                setSkipCreates((prev) =>
                  prev.size === buckets.creates.length
                    ? new Set()
                    : new Set(buckets.creates.map((c) => c.entryIndex))
                )
              }
            >
              {skipCreates.size === buckets.creates.length ? "Marcar todas" : "Desmarcar todas"}
            </button>
          }
        >
          <div className="space-y-1">
            {buckets.creates.map((c) => {
              const checked = !skipCreates.has(c.entryIndex)
              return (
                <label key={c.entryIndex} className="flex items-center gap-2 rounded-md p-1.5 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) =>
                      setSkipCreates((prev) => {
                        const next = new Set(prev)
                        if (v) next.delete(c.entryIndex)
                        else next.add(c.entryIndex)
                        return next
                      })
                    }
                  />
                  <span className="flex-1">{c.entry.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {[c.entry.personalStatus ?? "To read", c.entry.userScore != null ? `nota ${c.entry.userScore}` : null, c.entry.chaptersRead != null ? `${c.entry.chaptersRead} caps` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </label>
              )
            })}
          </div>
        </CollapsibleCard>
      )}

      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={runCommit} disabled={phase === "committing"}>
          {phase === "committing" ? "Importando…" : "Confirmar e importar"}
        </Button>
        <Button variant="ghost" onClick={reset} disabled={phase === "committing"}>
          Cancelar
        </Button>
      </div>
    </div>
  )

  function setAmbiguous(entryIndex: number, decision: AmbiguousDecision) {
    setAmbiguousChoices((prev) => ({ ...prev, [entryIndex]: decision }))
  }
}

function ChangeList({ changes }: { changes: FieldChange[] }) {
  return (
    <div className="text-xs text-muted-foreground">
      {changes.map((c) => (
        <span key={c.field} className="mr-3 inline-flex items-center gap-1">
          {FIELD_LABELS[c.field]}: {fmt(c.local)} <ArrowRight className="h-3 w-3" /> {fmt(c.imported)}
        </span>
      ))}
    </div>
  )
}

function ConflictRow({
  change,
  choice,
  onChoose,
}: {
  change: FieldChange
  choice: "local" | "imported"
  onChoose: (choice: "local" | "imported") => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{FIELD_LABELS[change.field]}</span>
      <ChoiceButton selected={choice === "local"} onClick={() => onChoose("local")}>
        Local: {fmt(change.local)}
      </ChoiceButton>
      <ChoiceButton selected={choice === "imported"} onClick={() => onChoose("imported")}>
        Importado: {fmt(change.imported)}
      </ChoiceButton>
    </div>
  )
}

function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs transition",
        selected
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border/60 text-muted-foreground hover:bg-card/80"
      )}
    >
      {children}
    </button>
  )
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className="flex items-center gap-2">
      <FileText className={cn("h-4 w-4", tone === "danger" ? "text-destructive" : "text-muted-foreground")} />
      <span className="font-medium">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}
