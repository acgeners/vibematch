"use client"

import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { RotateCcw } from "lucide-react"
import { updateRankingPreferences } from "@/server/actions/settings"
import { CRITERION_SLUGS, DEFAULT_CRITERION_SCORE_PRESETS } from "@/types/domain"
import type { FormulaConfig, CriterionScorePresets } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ScoreBadge } from "@/components/ui/score-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"

interface RankingPreferencesFormProps {
  config: FormulaConfig
}

const optionalNumber = (max?: number) =>
  z
    .union([z.number(), z.nan(), z.null()])
    .transform((v) => (v == null || (typeof v === "number" && Number.isNaN(v)) ? null : v))
    .pipe(z.number().min(0).max(max ?? 1_000_000).nullable())

const schema = z.object({
  top_n: optionalNumber(50),
  // Colunas legadas (min_calc/min_pr/min_final) repurposadas como filtros padrão
  // do ranking — todas persistidas em formula_config, sem migration:
  //   min_final_score      → "Nota Prevista mínima"  (expected_score, 0–10)
  //   min_calc_score       → "Alinhamento mínimo"    (personal_fit, percentil 0–100)
  //   min_predicted_score  → "Veredito IA mínimo"          (alignment_score, 0–100)
  min_final_score: optionalNumber(10),
  min_personal_fit: optionalNumber(100),
  min_alignment: optionalNumber(100),
})

type FormValues = z.infer<typeof schema>

const TOP_N_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50] as const

export function RankingPreferencesForm({ config }: RankingPreferencesFormProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState<FormValues | null>(null)

  // Atalhos ≥ da aba Notas — fora do react-hook-form (objeto aninhado). Persistido
  // junto com os demais campos no mesmo submit. `savedPresets` é o baseline do dirty.
  const initialPresets = normalizePresets(config.criterion_score_presets ?? DEFAULT_CRITERION_SCORE_PRESETS)
  const [presets, setPresets] = useState<CriterionScorePresets>(initialPresets)
  const [savedPresets, setSavedPresets] = useState<CriterionScorePresets>(initialPresets)
  const presetsDirty = !presetsEqual(presets, savedPresets)

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      top_n: config.top_n,
      min_final_score: config.min_final_score,
      min_personal_fit: config.min_calc_score,
      min_alignment: config.min_predicted_score,
    },
  })

  const askConfirm = (values: FormValues) => {
    setPending(values)
    setConfirmOpen(true)
  }

  const handleConfirm = async () => {
    if (!pending) return
    setConfirmOpen(false)
    const nextPresets = normalizePresets(presets)
    const result = await updateRankingPreferences({
      top_n: pending.top_n,
      // Colunas legadas repurposadas (ver schema): Alinhamento → min_calc_score,
      // Veredito IA → min_predicted_score, Nota Prevista → min_final_score.
      min_calc_score: pending.min_personal_fit,
      min_predicted_score: pending.min_alignment,
      min_final_score: pending.min_final_score,
      criterion_score_presets: nextPresets,
    })
    if (result.error) {
      toast.error(`Erro ao salvar: ${result.error}`)
      return
    }
    reset(pending)
    setPresets(nextPresets)
    setSavedPresets(nextPresets)
    toast.success("Preferências salvas.")
    setPending(null)
  }

  return (
    <form onSubmit={handleSubmit(askConfirm)} className="space-y-4">
      {/* Top N — botões segmentados compactos (5…30 + Todas) */}
      <Controller
        control={control}
        name="top_n"
        render={({ field }) => {
          const isAll = field.value == null
          return (
            <SettingTile
              label="Mostrar top N obras"
              hint="Quantas obras exibir no ranking."
            >
              <div className="flex flex-wrap gap-1.5">
                {TOP_N_OPTIONS.map((n) => {
                  const selected = !isAll && field.value === n
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => field.onChange(n)}
                      className={cn(
                        "min-w-[2.5rem] rounded-md border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors",
                        selected
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border/65 bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {n}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => field.onChange(null)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
                    isAll
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border/65 bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  Todas
                </button>
              </div>
            </SettingTile>
          )
        }}
      />

      {/* Notas mínimas padrão do ranking */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ScoreMinSlider
          control={control}
          name="min_final_score"
          label="Nota Prevista mínima"
          hint="Esconde obras com Nota Prevista abaixo desse valor."
        />
        <PercentMinSlider
          control={control}
          name="min_personal_fit"
          label="Alinhamento mínimo"
          hint="Percentil de alinhamento com seu perfil (0–100). Esconde obras abaixo."
        />
        <PercentMinSlider
          control={control}
          name="min_alignment"
          label="Veredito IA mínimo"
          hint="Re-rank do consultor IA (0–100). Só obras já re-rankeadas têm Veredito IA."
        />
      </div>

      <CriterionPresetEditor value={presets} onChange={setPresets} />

      <Button type="submit" disabled={isSubmitting || (!isDirty && !presetsDirty)}>
        {isSubmitting ? "Salvando..." : "Salvar preferências"}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Salvar preferências de ranking?"
        description="Os filtros de exibição do ranking serão atualizados. As notas em si não serão recalculadas."
        confirmText="Salvar"
        onConfirm={handleConfirm}
      />
    </form>
  )
}

interface ScoreMinSliderProps {
  control: ReturnType<typeof useForm<FormValues>>["control"]
  name: keyof FormValues
  label: string
  hint: string
}

function ScoreMinSlider({ control, name, label, hint }: ScoreMinSliderProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const isUnset = field.value == null
        const numeric = field.value ?? 0
        return (
          <SettingTile
            label={label}
            hint={hint}
            valueChip={
              isUnset ? (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  Sem mínimo
                </span>
              ) : (
                <ScoreBadge score={numeric} size="sm" />
              )
            }
            action={
              !isUnset && (
                <button
                  type="button"
                  onClick={() => field.onChange(null)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  title="Limpar"
                  aria-label="Limpar"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )
            }
          >
            <Slider
              value={[numeric]}
              min={0}
              max={10}
              step={0.5}
              onValueChange={(v) => field.onChange(v[0] === 0 ? null : v[0])}
              className="px-1"
            />
          </SettingTile>
        )
      }}
    />
  )
}

function PercentMinSlider({ control, name, label, hint }: ScoreMinSliderProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const isUnset = field.value == null
        const numeric = field.value ?? 0
        return (
          <SettingTile
            label={label}
            hint={hint}
            valueChip={
              isUnset ? (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  Sem mínimo
                </span>
              ) : (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                  ≥ {numeric}
                </span>
              )
            }
            action={
              !isUnset && (
                <button
                  type="button"
                  onClick={() => field.onChange(null)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  title="Limpar"
                  aria-label="Limpar"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )
            }
          >
            <Slider
              value={[numeric]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => field.onChange(v[0] === 0 ? null : v[0])}
              className="px-1"
            />
          </SettingTile>
        )
      }}
    />
  )
}

interface SettingTileProps {
  label: string
  hint?: string
  valueChip?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}

function SettingTile({ label, hint, valueChip, action, children }: SettingTileProps) {
  return (
    <div className="rounded-lg border border-border/65 bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {valueChip}
          {action}
        </div>
      </div>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Atalhos ≥ configuráveis da aba "Notas por critério" do ranking.
// Padrão global (vale pros 9) + exceções por atributo. Ver migration 132.
// ─────────────────────────────────────────────────────────────────────────────

const PRESET_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

const CRITERIA_META = CRITERION_SLUGS.map((slug) => ({
  slug,
  name: CRITERIA_INFO[slug]?.name ?? slug,
  emoji: CRITERIA_INFO[slug]?.emoji ?? "",
}))

function sortNums(a: number[]): number[] {
  return Array.from(new Set(a)).sort((x, y) => x - y)
}

function sameNums(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Ordena/dedupa o default e descarta overrides idênticos ao default (redundantes). */
function normalizePresets(p: CriterionScorePresets): CriterionScorePresets {
  const def = sortNums(p.default ?? [])
  const overrides: Record<string, number[]> = {}
  for (const [slug, vals] of Object.entries(p.overrides ?? {})) {
    const sv = sortNums(vals)
    if (!sameNums(sv, def)) overrides[slug] = sv
  }
  return { default: def, overrides }
}

function presetsEqual(a: CriterionScorePresets, b: CriterionScorePresets): boolean {
  const na = normalizePresets(a)
  const nb = normalizePresets(b)
  if (!sameNums(na.default, nb.default)) return false
  const ka = Object.keys(na.overrides)
  if (ka.length !== Object.keys(nb.overrides).length) return false
  return ka.every((k) => nb.overrides[k] != null && sameNums(na.overrides[k]!, nb.overrides[k]!))
}

function CriterionPresetEditor({
  value,
  onChange,
}: {
  value: CriterionScorePresets
  onChange: (next: CriterionScorePresets) => void
}) {
  // selection vazio = editando o padrão ("Todos"); com slugs = editando exceções.
  const [selection, setSelection] = useState<string[]>([])

  const exceptionCount = Object.keys(value.overrides).length
  const editingDefault = selection.length === 0
  const editingException = !editingDefault

  const effFor = (slug: string) => value.overrides[slug] ?? value.default

  // Valores atualmente destacados na grade. Multi-seleção divergente = "misto" (vazio).
  let working: number[]
  let mixed = false
  if (editingDefault) {
    working = sortNums(value.default)
  } else {
    const sets = selection.map((s) => sortNums(effFor(s)))
    const first = sets[0] ?? []
    if (sets.every((s) => sameNums(s, first))) working = first
    else {
      working = []
      mixed = true
    }
  }

  const toggleNumber = (n: number) => {
    const base = mixed ? [] : working
    const next = base.includes(n) ? base.filter((x) => x !== n) : sortNums([...base, n])
    if (editingDefault) {
      onChange(normalizePresets({ default: next, overrides: value.overrides }))
    } else {
      const overrides = { ...value.overrides }
      for (const slug of selection) overrides[slug] = next
      onChange(normalizePresets({ default: value.default, overrides }))
    }
  }

  const revertSelected = () => {
    const overrides = { ...value.overrides }
    for (const slug of selection) delete overrides[slug]
    onChange({ default: value.default, overrides })
  }

  const toggleAttr = (slug: string) =>
    setSelection((sel) => (sel.includes(slug) ? sel.filter((s) => s !== slug) : [...sel, slug]))

  const selectedHasOverride = selection.some((slug) => slug in value.overrides)

  return (
    <div className="rounded-lg border border-border/65 bg-background/40 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Atalhos de nota por atributo</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Os botões rápidos (≥) da aba Notas do ranking.{" "}
            <strong className="font-semibold text-foreground">Todos</strong> edita o padrão;
            selecione atributos pra dar valores próprios só a eles.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-muted/60 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {exceptionCount === 0
            ? "sem exceções"
            : `${exceptionCount} ${exceptionCount === 1 ? "exceção" : "exceções"}`}
        </span>
      </div>

      {/* Seletor de atributos */}
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        Editando atalhos de
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setSelection([])}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
            editingDefault
              ? "border-primary/50 bg-primary/15 text-foreground"
              : "border-border/65 bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          Todos
        </button>
        {CRITERIA_META.map(({ slug, name, emoji }) => {
          const active = selection.includes(slug)
          const hasOverride = slug in value.overrides
          return (
            <button
              key={slug}
              type="button"
              onClick={() => toggleAttr(slug)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                active
                  ? "border-primary/50 bg-primary/15 text-foreground"
                  : "border-border/65 bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <span className="text-sm leading-none">{emoji}</span>
              {name}
              {hasOverride && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="valores próprios" />
              )}
            </button>
          )
        })}
      </div>

      {/* Contexto do que está sendo editado */}
      <div className="mt-3 mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {editingDefault ? (
          <span>
            Editando o <strong className="font-semibold text-foreground">padrão</strong> (todos os
            atributos).
          </span>
        ) : (
          <>
            <span>
              Editando exceção de{" "}
              <strong className="font-semibold text-foreground">
                {selection.map((s) => CRITERIA_INFO[s]?.name ?? s).join(", ")}
              </strong>
            </span>
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              exceção
            </span>
          </>
        )}
      </div>

      {/* Grade 1..10 */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_CHOICES.map((n) => {
          const on = !mixed && working.includes(n)
          return (
            <button
              key={n}
              type="button"
              onClick={() => toggleNumber(n)}
              className={cn(
                "min-w-[2.5rem] rounded-md border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors",
                on
                  ? editingException
                    ? "border-amber-400/50 bg-amber-400/15 text-amber-600 dark:text-amber-400"
                    : "border-primary/50 bg-primary/15 text-primary"
                  : "border-border/65 bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {n}
            </button>
          )
        })}
      </div>

      {/* Prévia */}
      <div className="mt-3 border-t border-dashed border-border/60 pt-2.5">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {mixed ? "Valores diferentes entre os selecionados" : "Prévia dos botões no ranking"}
        </p>
        {mixed ? (
          <p className="text-[11px] text-muted-foreground">
            Clique num número pra redefinir os selecionados pro mesmo conjunto.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex h-7 items-center rounded-lg border border-transparent bg-primary px-3 text-xs font-semibold text-primary-foreground">
              Qualquer
            </span>
            {working.length === 0 ? (
              <span className="inline-flex h-7 items-center text-xs text-muted-foreground">
                — nenhum atalho (só o slider)
              </span>
            ) : (
              working.map((n) => (
                <span
                  key={n}
                  className="inline-flex h-7 items-center rounded-lg border border-border/70 bg-background px-3 text-xs font-semibold tabular-nums text-muted-foreground"
                >
                  ≥ {n}
                </span>
              ))
            )}
          </div>
        )}
      </div>

      {/* Rodapé */}
      <div className="mt-3 flex items-center justify-between gap-2">
        {editingException && selectedHasOverride ? (
          <button
            type="button"
            onClick={revertSelected}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-600 transition-colors hover:text-amber-500 dark:text-amber-400"
          >
            <RotateCcw className="h-3 w-3" />
            Reverter ao padrão
          </button>
        ) : (
          <span />
        )}
        <span className="text-[11px] text-muted-foreground/70">recomendado: 3–5 atalhos</span>
      </div>
    </div>
  )
}
