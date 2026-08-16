"use client"

import { useState, useCallback } from "react"
import {
  Upload,
  FileText,
  Check,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  User,
  Search,
  ClipboardList,
  Info,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectedOptionLabel,
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
import { DEFAULT_PERSONAL_STATUS } from "@/lib/constants/criteria"

type Phase = "upload" | "analyzing" | "review" | "committing" | "result"
type Method = "file" | "anilist" | "titles"

type ImportInput = {
  filename: string
  contentBase64: string
  source?: ExternalListSource
  username?: string
}

const FIELD_LABELS: Record<ReconcileField, string> = {
  personal_status: "Status",
  user_score: "Nota",
  chapters_read: "Capítulos",
}

const SOURCES: ExternalListSource[] = ["myanimelist", "mangaupdates", "animeplanet", "comix"]

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

// base64 UTF-8-safe (btoa quebra em não-ASCII; títulos têm acento/coreano).
// O servidor decodifica com Buffer.from(b64,"base64").toString("utf8").
function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function ExternalListImport({
  onReviewBatchComplete,
}: {
  // Chamado quando o lote de enriquecimento da etapa de revisão termina —
  // o caller (ImportModes) usa pra ir pra aba "Revisar pendentes".
  onReviewBatchComplete?: () => void
} = {}) {
  const [phase, setPhase] = useState<Phase>("upload")
  const [method, setMethod] = useState<Method>("file")
  const [file, setFile] = useState<File | null>(null)
  const [username, setUsername] = useState("")
  const [titlesText, setTitlesText] = useState("")
  const [sourceOverride, setSourceOverride] = useState<ExternalListSource | "auto">("auto")
  // Input usado no analyze — guardado pra reusar no commit (re-parseado no servidor).
  const [pendingInput, setPendingInput] = useState<ImportInput | null>(null)
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
    setMethod("file")
    setFile(null)
    setUsername("")
    setTitlesText("")
    setSourceOverride("auto")
    setPendingInput(null)
    setAnalysis(null)
    setError(null)
    setCommitResult(null)
    setReviewWorks([])
    setConflictChoices({})
    setAmbiguousChoices({})
    setSkipCreates(new Set())
  }

  const runAnalyze = useCallback(async () => {
    setError(null)
    try {
      let input: ImportInput
      if (method === "anilist") {
        const u = username.trim()
        if (!u) {
          setError("Informe seu nome de usuário do AniList.")
          return
        }
        setPhase("analyzing")
        input = { filename: `AniList: @${u}`, contentBase64: "", source: "anilist", username: u }
      } else if (method === "titles") {
        const text = titlesText.trim()
        if (!text) {
          setError("Cole ao menos um título (um por linha).")
          return
        }
        setPhase("analyzing")
        input = { filename: "Lista de títulos", contentBase64: textToBase64(text), source: "titles" }
      } else {
        if (!file) return
        setPhase("analyzing")
        input = {
          filename: file.name,
          contentBase64: await fileToBase64(file),
          source: sourceOverride === "auto" ? undefined : sourceOverride,
        }
      }
      setPendingInput(input)
      const res = await analyzeExternalListImport(input)
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
      setError(err instanceof Error ? err.message : "Erro ao ler a lista")
      setPhase("upload")
    }
  }, [file, sourceOverride, method, username, titlesText])

  const runCommit = useCallback(async () => {
    if (!analysis || !pendingInput) return
    setPhase("committing")
    setError(null)
    try {
      const res = await commitExternalListImport(pendingInput, {
        conflicts: conflictChoices,
        ambiguous: ambiguousChoices,
        skipCreates: Array.from(skipCreates),
      })
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
  }, [analysis, pendingInput, conflictChoices, ambiguousChoices, skipCreates])

  const reloadReview = useCallback(async () => {
    if (!commitResult) return
    setReviewWorks(await getImportReviewWorks(commitResult.createdWorkIds))
  }, [commitResult])

  // ── Upload ───────────────────────────────────────────────────────
  if (phase === "upload" || phase === "analyzing") {
    const analyzing = phase === "analyzing"
    const titleCount = titlesText.split(/\r?\n/).filter((l) => l.trim()).length
    return (
      <div className="space-y-4">
        {/* Método (nível 2): pílulas discretas — forma diferente das abas (padrão /reading) */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">De onde importar</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              { id: "file" as Method, label: "Por arquivo", icon: FileText },
              { id: "titles" as Method, label: "Colar títulos", icon: ClipboardList },
              { id: "anilist" as Method, label: "Por usuário (AniList)", icon: User },
            ]).map((m) => {
              const Icon = m.icon
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMethod(m.id)
                    setError(null)
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    method === m.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" /> {m.label}
                  {m.id === "anilist" && (
                    <span className="rounded px-1 text-[9px] font-bold uppercase tracking-wide text-primary ring-1 ring-inset ring-primary/40">
                      Novo
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {method === "file" ? (
          <>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-card/50 px-6 py-10 text-center transition hover:bg-card/80">
              <Upload className="h-7 w-7 text-muted-foreground" />
              <span className="text-sm font-medium">
                {file ? file.name : "Selecione ou arraste o arquivo da lista"}
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

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Formato</span>
                <Select value={sourceOverride} onValueChange={(v) => setSourceOverride(v as ExternalListSource | "auto")}>
                  <SelectTrigger className="w-56">
                    <SelectValue>
                      {selectedOptionLabel(
                        [
                          { value: "auto", label: "Detectar automaticamente" },
                          ...SOURCES.map((s) => ({ value: s, label: EXTERNAL_LIST_SOURCE_LABELS[s] })),
                        ],
                        sourceOverride,
                      )}
                    </SelectValue>
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
              <Button disabled={!file || analyzing} onClick={runAnalyze}>
                {analyzing ? "Analisando…" : "Importar lista"}
              </Button>
            </div>
          </>
        ) : method === "anilist" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1 space-y-1">
                <span className="text-xs text-muted-foreground">Usuário do AniList</span>
                <div className="flex items-center rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
                  <span className="pl-3 text-sm text-muted-foreground">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value)
                      setError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && username.trim() && !analyzing) runAnalyze()
                    }}
                    placeholder="seu-usuario"
                    spellCheck={false}
                    className="w-full bg-transparent px-2 py-2 text-sm outline-none"
                  />
                </div>
              </div>
              <Button disabled={!username.trim() || analyzing} onClick={runAnalyze}>
                <Search className="h-4 w-4" /> {analyzing ? "Buscando…" : "Buscar lista"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A lista pública é lida direto pela API do AniList — nenhum arquivo necessário. Precisa estar pública no seu perfil.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Cole os títulos — um por linha</span>
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label="Como funciona" className="text-muted-foreground/70 transition-colors hover:text-foreground">
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Cria as obras só com o título (pendentes de revisão) e reconhece as que já existem no catálogo. Ideal pra popular o DB em massa — você enriquece capa/sinopse depois em “Revisar pendentes”.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <textarea
                value={titlesText}
                onChange={(e) => {
                  setTitlesText(e.target.value)
                  setError(null)
                }}
                rows={8}
                spellCheck={false}
                placeholder={"The Remarried Empress\nWho Made Me a Princess\nDaughter of the Emperor"}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button disabled={!titlesText.trim() || analyzing} onClick={runAnalyze}>
                {analyzing ? "Analisando…" : "Incluir títulos"}
              </Button>
              {titleCount > 0 && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {titleCount} {titleCount === 1 ? "título" : "títulos"}
                </span>
              )}
            </div>
          </div>
        )}

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
  // O que exige uma decisão sua vs. o que é só informativo/em lote — vira a
  // linha de destaque no topo, pra responder "o que eu preciso fazer aqui"
  // antes da frase técnica com todas as contagens.
  const pendingDecisions = buckets.ambiguous.length + buckets.conflicts.length
  const breakdown = [
    buckets.creates.length > 0 ? `${buckets.creates.length} ${buckets.creates.length === 1 ? "nova" : "novas"}` : null,
    buckets.unchangedCount > 0 ? `${buckets.unchangedCount} sem mudança` : null,
    buckets.autoUpdate.length > 0
      ? `${buckets.autoUpdate.length} automática${buckets.autoUpdate.length === 1 ? "" : "s"}`
      : null,
  ].filter((s): s is string => s !== null)

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{EXTERNAL_LIST_SOURCE_LABELS[analysis.source]}</Badge>
          <span className="text-muted-foreground">
            {analysis.entryCount} {analysis.entryCount === 1 ? "título" : "títulos"} na lista
          </span>
        </div>
        {pendingDecisions > 0 ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <strong className="tabular-nums">{pendingDecisions}</strong>{" "}
              {pendingDecisions === 1 ? "pendência precisa" : "pendências precisam"} da sua confirmação antes de
              importar.
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Nada pra confirmar — pronto pra importar.</p>
        )}
        {breakdown.length > 0 && <p className="text-xs text-muted-foreground">{breakdown.join(" · ")}</p>}
      </div>

      {/* Confirmar correspondência — identidade incerta, decide primeiro */}
      {buckets.ambiguous.length > 0 && (
        <Card>
          <CardHeader>
            <AttentionCardTitle icon={Search} title="Pode já existir no catálogo" count={buckets.ambiguous.length} />
            <CardDescription>Achamos um título parecido no que você já tem. Confirme se é a mesma obra.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {buckets.ambiguous.map((a) => {
              const decision = ambiguousChoices[a.entryIndex]
              return (
                <div key={a.entryIndex} className="rounded-md border border-border/60 p-3 text-sm">
                  <div className="mb-2 font-medium">{a.entry.title}</div>
                  <p className="mb-1.5 text-xs text-muted-foreground">No catálogo, achamos:</p>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {a.candidates.map((cand) => (
                      <CandidateButton
                        key={cand.workId}
                        selected={decision?.action === "match" && decision.workId === cand.workId}
                        title={cand.title}
                        scorePercent={Math.round(cand.score * 100)}
                        onClick={() => setAmbiguous(a.entryIndex, { action: "match", workId: cand.workId })}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1 border-t border-dashed border-border/60 pt-2">
                    <TextChoice
                      selected={decision?.action === "create"}
                      onClick={() => setAmbiguous(a.entryIndex, { action: "create" })}
                    >
                      É outra obra — criar nova
                    </TextChoice>
                    <TextChoice
                      selected={decision?.action === "skip"}
                      onClick={() => setAmbiguous(a.entryIndex, { action: "skip" })}
                    >
                      Pular esta
                    </TextChoice>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Conflitos — identidade já confirmada, só o valor do campo diverge */}
      {buckets.conflicts.length > 0 && (
        <Card>
          <CardHeader>
            <AttentionCardTitle
              icon={ArrowRightLeft}
              title="Valor diferente do que está salvo"
              count={buckets.conflicts.length}
            />
            <CardDescription>Já existe no catálogo com um valor diferente do da lista. Escolha qual vale.</CardDescription>
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

      {/* Atualiza sozinho — informativo, nada pra decidir */}
      {buckets.autoUpdate.length > 0 && (
        <CollapsibleCard
          title={`Atualiza sozinho (${buckets.autoUpdate.length})`}
          description="Campo vazio no catálogo — preenchido com o valor da lista, sem precisar decidir nada."
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

      {/* Criar novas — em lote */}
      {buckets.creates.length > 0 && (
        <CollapsibleCard
          title={`Serão criadas (${createCount}/${buckets.creates.length})`}
          description="Não achamos essas no catálogo — viram obras novas, pendentes de avaliação por IA."
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
                    {[c.entry.personalStatus ?? DEFAULT_PERSONAL_STATUS, c.entry.userScore != null ? `nota ${c.entry.userScore}` : null, c.entry.chaptersRead != null ? `${c.entry.chaptersRead} caps` : null]
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
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{FIELD_LABELS[change.field]}</span>
      <ValueButton
        selected={choice === "local"}
        source="No catálogo"
        value={fmt(change.local)}
        onClick={() => onChoose("local")}
      />
      <ValueButton
        selected={choice === "imported"}
        source="Na lista importada"
        value={fmt(change.imported)}
        onClick={() => onChoose("imported")}
      />
    </div>
  )
}

// Cabeçalho das seções que exigem uma decisão (correspondência, conflito) —
// ícone + contagem em âmbar, a única cor que a tela usa pra "isto pede sua atenção".
function AttentionCardTitle({ icon: Icon, title, count }: { icon: LucideIcon; title: string; count: number }) {
  return (
    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-500">
        <Icon className="h-3.5 w-3.5" />
      </span>
      {title}
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-500">
        {count}
      </span>
    </CardTitle>
  )
}

// Candidato de correspondência — a sugestão do catálogo é a resposta, o %
// só um detalhe secundário (antes o título+score ERA o rótulo inteiro do botão).
function CandidateButton({
  selected,
  title,
  scorePercent,
  onClick,
}: {
  selected: boolean
  title: string
  scorePercent: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition",
        selected ? "border-primary bg-primary/10" : "border-border/60 text-muted-foreground hover:bg-card/80"
      )}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0 text-primary", !selected && "invisible")} />
      <span className={selected ? "text-foreground" : undefined}>{title}</span>
      <span className="text-xs text-muted-foreground">· {scorePercent}% parecido</span>
    </button>
  )
}

// "É outra obra"/"Pular" — escape hatches da correspondência ambígua, texto
// simples de propósito: não competem em peso com a sugestão principal.
function TextChoice({
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
        "rounded px-2 py-1 text-xs transition",
        selected ? "bg-card/80 font-medium text-foreground" : "text-muted-foreground hover:bg-card/80 hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

// Linha "de onde vem cada valor" nos conflitos — rótulo curto + valor em
// destaque, no lugar do antigo "Local: 8" / "Importado: 7" (não dizia a origem).
function ValueButton({
  selected,
  source,
  value,
  onClick,
}: {
  selected: boolean
  source: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition",
        selected ? "border-primary bg-primary/10" : "border-border/60 hover:bg-card/80"
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{source}</span>
      <span className="text-sm font-semibold">{value}</span>
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
