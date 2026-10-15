"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { getWorkEditionCuration, revertWorkEditionCuration, saveWorkEditionCuration } from "@/server/actions/work-editions"
import type { WorkEditionCuration } from "@/server/actions/work-editions"
import {
  CURATED_EDITION_STATES,
  DECIDED_BY_LABEL,
  EDITION_STATE_EFFECT,
  EDITION_STATE_LABEL,
  adultOverrideWarning,
  describeCurrentEditionScore,
  parseEditionScore,
} from "@/lib/editions/edition-curation"
import type { CuratedEditionState, EditionScoreInput } from "@/lib/editions/edition-curation"
import { EDITION_LABEL, MIXED_EDITIONS } from "@/lib/editions/mixed-edition"
import type { MixedEdition } from "@/lib/editions/mixed-edition"
import { useRefresh } from "@/lib/use-refresh"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, selectedOptionLabel } from "@/components/ui/select"
import { STATUS_TONE } from "@/lib/ui/status-tone"
import { CriterionBandReadout, CriterionScoreRow } from "@/components/titles/criterion-score-row"
import { cn } from "@/lib/utils"

type ScoreMode = EditionScoreInput["kind"]
const SCORE_MODE_OPTIONS: ReadonlyArray<{ value: ScoreMode; label: string }> = [
  { value: "manter", label: "Manter como está" },
  { value: "nota", label: "Informar nota" },
  { value: "nao_avaliado", label: "Marcar como não avaliado" },
]
const STATE_OPTIONS = CURATED_EDITION_STATES.map((value) => ({ value, label: EDITION_STATE_LABEL[value] }))

/**
 * O que acontece com a previsão, dito como é: a mudança MARCA o recálculo como pendente, e ele roda
 * pelo recálculo automático (`maybeTriggerStaleRecalc`, na carga de página depois de 1h sem novas
 * edições) ou pelo botão "Recalcular notas". Não prometer prazo nem "só com autorização".
 */
const RECALC_PENDENTE =
  "O recálculo das notas ficou pendente e pode rodar pelo recálculo automático do app ou pelo botão “Recalcular notas”."

interface ScoreDraft {
  mode: ScoreMode
  text: string
}
const EMPTY_SCORES: Record<MixedEdition, ScoreDraft> = {
  normal: { mode: "manter", text: "" },
  r18: { mode: "manter", text: "" },
}

/**
 * "Edições da obra" — a curadoria diz se a obra tem versão normal e R18 (`mixed`), uma só, ou só R18,
 * e, numa `mixed`, informa a nota de conteúdo adulto de cada edição. Abre pelo menu "⋯" da obra.
 * Ver `server/actions/work-editions.ts` e `lib/editions/edition-curation.ts`.
 */
export function WorkEditionsDialog({
  workId,
  open,
  onOpenChange,
}: {
  workId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Enquanto grava, fechar por fora (Esc, clique no fundo) não interrompe a escrita.
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[min(36rem,calc(100vw-4rem))]">
        <DialogHeader>
          <DialogTitle>Versões da obra</DialogTitle>
          <DialogDescription>
            Diga se esta obra tem uma versão normal e uma versão R18. Isso decide o que quem oculta 18+ consegue ver.
          </DialogDescription>
        </DialogHeader>
        {/* O formulário só existe com o diálogo aberto (o Radix desmonta o conteúdo ao fechar): cada
            abertura relê o banco e começa limpa, sem reset dentro de efeito. */}
        <EditionsForm workId={workId} onBusyChange={setBusy} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function EditionsForm({
  workId,
  onBusyChange,
  onClose,
}: {
  workId: string
  onBusyChange: (busy: boolean) => void
  onClose: () => void
}) {
  const refresh = useRefresh()
  const [current, setCurrent] = useState<WorkEditionCuration | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // null = sem decisão registrada (a obra é tratada como edição única); só grava se alguém escolher.
  const [state, setState] = useState<CuratedEditionState | null>(null)
  const [extras, setExtras] = useState(false)
  const [scores, setScores] = useState<Record<MixedEdition, ScoreDraft>>(EMPTY_SCORES)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    getWorkEditionCuration(workId).then((res) => {
      if (cancelled) return
      if ("error" in res) {
        setLoadError(res.error)
        return
      }
      setCurrent(res.data)
      setState(res.data.state)
      setExtras(res.data.r18ExtraChapters)
    })
    return () => {
      cancelled = true
    }
  }, [workId])

  const isMixed = state === "mixed"
  const stateDirty =
    current != null && state != null && (current.state !== state || current.r18ExtraChapters !== (isMixed && extras))
  const scoreInputs: Record<MixedEdition, EditionScoreInput | null> = {
    normal: toInput(scores.normal),
    r18: toInput(scores.r18),
  }
  const scoresDirty = isMixed && MIXED_EDITIONS.some((e) => scores[e].mode !== "manter")
  const invalid = isMixed && MIXED_EDITIONS.some((e) => scoreInputs[e] == null)
  const dirty = stateDirty || scoresDirty
  const warning = current ? adultOverrideWarning(current.adultOverride) : null

  const handleRevert = () => {
    if (!current?.canRevert || dirty) return
    startTransition(async () => {
      onBusyChange(true)
      try {
        const res = await revertWorkEditionCuration(workId)
        if ("error" in res) {
          toast.error(res.error)
          return
        }
        toast.success(
          res.data.recalcMarked ? `Decisão da curadoria removida. ${RECALC_PENDENTE}` : "Decisão da curadoria removida.",
        )
        onClose()
        refresh()
      } finally {
        onBusyChange(false)
      }
    })
  }

  const handleSave = () => {
    if (!current || state == null || invalid) return
    startTransition(async () => {
      onBusyChange(true)
      try {
        const res = await saveWorkEditionCuration(workId, {
          state,
          r18ExtraChapters: isMixed && extras,
          scores: {
            normal: scoreInputs.normal ?? { kind: "manter" },
            r18: scoreInputs.r18 ?? { kind: "manter" },
          },
        })
        if ("error" in res) {
          toast.error(res.error)
          return
        }
        toast.success(
          !res.data.changed
            ? "Nada mudou."
            : res.data.recalcMarked
              ? `Versões da obra salvas. ${RECALC_PENDENTE}`
              : "Versões da obra salvas.",
        )
        onClose()
        refresh()
      } finally {
        onBusyChange(false)
      }
    })
  }

  return (
    <>
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : !current ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edition-state">Estado</Label>
            {/* `""` e não `undefined`: começar sem valor deixa o Select NÃO controlado, e depois da
                escolha o gatilho ficava vazio (visto no browser). `""` é o placeholder do Radix. */}
            <Select value={state ?? ""} onValueChange={(v) => setState(v as CuratedEditionState)}>
              <SelectTrigger id="edition-state" className="w-full">
                <SelectValue placeholder="Sem decisão — tratada como versão única">
                  {selectedOptionLabel(STATE_OPTIONS, state)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{EDITION_STATE_EFFECT[state ?? "single"]}</p>
            {current.decidedBy && current.decidedBy !== "curator" && (
              <p className="text-xs text-muted-foreground">
                Estado decidido por {DECIDED_BY_LABEL[current.decidedBy]}. Se você mudá-lo, passa a ser decisão da curadoria.
              </p>
            )}
          </div>

          {/* "Remover decisão" ≠ "Indefinido": Indefinido é uma decisão (e liga o 18+); remover devolve
              o estado de antes da curadoria. Só aparece quando a decisão atual É da curadoria. */}
          {current.decidedBy === "curator" && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">Estado decidido pela curadoria.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRevert}
                  disabled={!current.canRevert || dirty || isPending}
                >
                  Remover decisão da curadoria
                </Button>
              </div>
              {current.revertTarget && <p className="text-xs text-muted-foreground">{current.revertTarget}</p>}
              {current.canRevert && dirty && (
                <p className="text-xs text-muted-foreground">Descarte as mudanças acima para remover a decisão.</p>
              )}
              {current.canRevert && (
                <p className="text-xs text-muted-foreground">As notas por versão ficam como estão.</p>
              )}
            </div>
          )}

          {isMixed && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={extras} onCheckedChange={(c) => setExtras(c === true)} className="mt-0.5" />
              <span>A versão R18 só acrescenta capítulos extras (side stories ou epílogos) a uma história principal normal.</span>
            </label>
          )}

          {isMixed && (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Nota de conteúdo adulto por versão</p>
              {MIXED_EDITIONS.map((edition) => (
                <ScoreRow
                  key={edition}
                  edition={edition}
                  currentLabel={describeCurrentEditionScore(edition, current.scores[edition])}
                  draft={scores[edition]}
                  invalid={scoreInputs[edition] == null}
                  onChange={(d) => setScores((prev) => ({ ...prev, [edition]: d }))}
                />
              ))}
              <p className="text-xs text-muted-foreground">
                Versão sem nota fica sem Nota Prevista. Nada é copiado de uma versão para a outra.
              </p>
            </div>
          )}

          {!isMixed && Object.keys(current.scores).length > 0 && (
            <p className="text-xs text-muted-foreground">
              As notas por versão já gravadas ficam guardadas e só voltam a valer se a obra voltar a ter duas versões.
            </p>
          )}

          {warning && (
            // Tom `content` (o vermelho do 18+): fala do portão 18+ da obra. Âmbar é só "desatualizado".
            <p className={cn("rounded-md px-3 py-2 text-xs", STATUS_TONE.content.box, STATUS_TONE.content.text)}>{warning}</p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={!current || !dirty || invalid || isPending}>
          {isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </>
  )
}

/** O rascunho vira entrada da action; null = nota digitada inválida. */
function toInput(d: ScoreDraft): EditionScoreInput | null {
  if (d.mode === "nota") {
    const v = parseEditionScore(d.text)
    return v == null ? null : { kind: "nota", value: v }
  }
  return { kind: d.mode }
}

function ScoreRow({
  edition,
  currentLabel,
  draft,
  invalid,
  onChange,
}: {
  edition: MixedEdition
  currentLabel: string
  draft: ScoreDraft
  invalid: boolean
  onChange: (d: ScoreDraft) => void
}) {
  const inputId = `edition-score-${edition}`
  // A nota por versão é de Conteúdo Adulto e se dá como qualquer nota de critério: a linha do critério
  // com o rótulo da faixa ao vivo e o painel da faixa (`criterion-score-row`). O campo segue de texto
  // para aceitar vírgula, validado por `parseEditionScore` (0 a 10, de 0,5 em 0,5).
  const parsed = draft.mode === "nota" ? parseEditionScore(draft.text) : null
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm">{EDITION_LABEL[edition]}</span>
        <span className="text-xs text-muted-foreground">Hoje: {currentLabel}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={draft.mode} onValueChange={(v) => onChange({ ...draft, mode: v as ScoreMode })}>
          <SelectTrigger size="sm" className="min-w-52" aria-label={`Nota da ${EDITION_LABEL[edition]}`}>
            <SelectValue>{selectedOptionLabel(SCORE_MODE_OPTIONS, draft.mode)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SCORE_MODE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {draft.mode === "nota" && (
        <div className="flex flex-col gap-2">
          <CriterionScoreRow
            slug="adult_content"
            score={parsed}
            active={hovered || focused}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <Input
              id={inputId}
              // texto + inputMode: num type="number" o Chrome devolve vazio para "7,5".
              type="text"
              inputMode="decimal"
              placeholder="0 a 10"
              value={draft.text}
              onChange={(e) => onChange({ ...draft, text: e.target.value })}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              aria-invalid={invalid}
              aria-label={`Nota de conteúdo adulto da ${EDITION_LABEL[edition]}`}
              className="w-20 text-center font-mono tabular-nums pr-3"
            />
          </CriterionScoreRow>
          {invalid && draft.text.trim() !== "" && (
            <span className="text-xs text-destructive">De 0 a 10, de 0,5 em 0,5.</span>
          )}
          <CriterionBandReadout
            slug={parsed == null ? null : "adult_content"}
            score={parsed ?? 0}
            idleHint="Informe a nota para ver o que a faixa significa."
          />
        </div>
      )}
    </div>
  )
}
