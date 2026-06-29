import { Heart, Ban, ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import type { TasteProfilePayload, ProfileCriterionPreference } from "@/lib/ai-recommendation/types"
import type { CriterionSlug } from "@/types/domain"

const MAX_CHIPS = 12
/** Mudança mínima (em pontos 0–10) no min/max pra a faixa de um atributo contar. */
const RANGE_DELTA = 1.0

type Tone = "loved" | "avoided" | "out" | "neutral"

const TONE_CLASS: Record<Tone, string> = {
  loved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  avoided: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  // "Saíram" de qualquer coluna: neutro (cinza) — não é amada nem evitada agora.
  out: "border-border/60 bg-muted/50 text-muted-foreground",
  neutral: "border-border/60 bg-card/60 text-foreground/80",
}

interface StrDiff {
  entered: string[]
  exited: string[]
}

function nameSet(items: ReadonlyArray<{ name: string }>): Set<string> {
  return new Set(items.map((t) => t.name.toLowerCase()))
}

function tagDiff(
  used: ReadonlyArray<{ name: string }>,
  current: ReadonlyArray<{ name: string }>,
): StrDiff {
  const u = nameSet(used)
  const c = nameSet(current)
  return {
    entered: current.filter((t) => !u.has(t.name.toLowerCase())).map((t) => t.name),
    exited: used.filter((t) => !c.has(t.name.toLowerCase())).map((t) => t.name),
  }
}

function strDiff(used: ReadonlyArray<string>, current: ReadonlyArray<string>): StrDiff {
  const u = new Set(used.map((s) => s.toLowerCase()))
  const c = new Set(current.map((s) => s.toLowerCase()))
  return {
    entered: current.filter((s) => !u.has(s.toLowerCase())),
    exited: used.filter((s) => !c.has(s.toLowerCase())),
  }
}

interface RangeChange {
  slug: CriterionSlug
  from: ProfileCriterionPreference | null
  to: ProfileCriterionPreference | null
}

function rangeDiff(
  used: Partial<Record<CriterionSlug, ProfileCriterionPreference>>,
  current: Partial<Record<CriterionSlug, ProfileCriterionPreference>>,
): RangeChange[] {
  const slugs = new Set<string>([...Object.keys(used), ...Object.keys(current)])
  const out: RangeChange[] = []
  for (const slug of slugs) {
    const a = used[slug as CriterionSlug] ?? null
    const b = current[slug as CriterionSlug] ?? null
    if (!a && !b) continue
    const significant =
      !a ||
      !b ||
      Math.abs(a.ideal_min - b.ideal_min) >= RANGE_DELTA ||
      Math.abs(a.ideal_max - b.ideal_max) >= RANGE_DELTA
    if (significant) out.push({ slug: slug as CriterionSlug, from: a, to: b })
  }
  return out
}

function fmtRange(p: ProfileCriterionPreference | null): string {
  if (!p) return "—"
  return `${p.ideal_min.toFixed(1)}–${p.ideal_max.toFixed(1)}`
}

function hasChange(d: StrDiff): boolean {
  return d.entered.length > 0 || d.exited.length > 0
}

/**
 * Diferenças entre o perfil de gosto USADO na execução e o ATUAL. A cor indica a
 * CATEGORIA (amada = verde, evitada = vermelho); o que SAIU de qualquer coluna
 * fica neutro (cinza) — evita confundir "entrou/saiu" com "amada/evitada".
 */
export function ProfileDiffSummary({
  used,
  current,
}: {
  used: TasteProfilePayload
  current: TasteProfilePayload
}) {
  const lovedTags = tagDiff(used.loved_tags, current.loved_tags)
  const avoidedTags = tagDiff(used.avoided_tags, current.avoided_tags)
  const lovedThemes = strDiff(used.loved_themes ?? [], current.loved_themes ?? [])
  const avoidedThemes = strDiff(used.avoided_themes ?? [], current.avoided_themes ?? [])
  const ranges = rangeDiff(used.criterion_preferences ?? {}, current.criterion_preferences ?? {})

  const hasOther = ranges.length > 0 || hasChange(lovedThemes) || hasChange(avoidedThemes)

  if (!hasChange(lovedTags) && !hasChange(avoidedTags) && !hasOther) return null

  return (
    <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
        O que mudou no seu perfil desde esta execução
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <DiffColumn
          icon={<Heart className="h-3.5 w-3.5" />}
          label="Amadas"
          headerClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          enteredTone="loved"
          diff={lovedTags}
        />
        <DiffColumn
          icon={<Ban className="h-3.5 w-3.5" />}
          label="Evitadas"
          headerClass="bg-rose-500/10 text-rose-700 dark:text-rose-300"
          enteredTone="avoided"
          diff={avoidedTags}
        />
      </div>

      {hasOther && (
        <div className="space-y-2 border-t border-amber-500/20 pt-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Outras mudanças
          </p>

          {ranges.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Faixa ideal de atributos</p>
              <div className="flex flex-col gap-0.5">
                {ranges.map(({ slug, from, to }) => {
                  const info = CRITERIA_INFO[slug]
                  return (
                    <div key={slug} className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-foreground/80">
                        {info?.emoji} {info?.name ?? slug}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-muted-foreground">
                        {fmtRange(from)}
                        <ArrowRight className="h-2.5 w-2.5" />
                        <span className="text-foreground/80">{fmtRange(to)}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {hasChange(lovedThemes) && (
            <OtherChangeLine label="Temas amados" diff={lovedThemes} enteredTone="loved" />
          )}
          {hasChange(avoidedThemes) && (
            <OtherChangeLine label="Temas evitados" diff={avoidedThemes} enteredTone="avoided" />
          )}
        </div>
      )}
    </div>
  )
}

function DiffColumn({
  icon,
  label,
  headerClass,
  enteredTone,
  diff,
}: {
  icon: React.ReactNode
  label: string
  headerClass: string
  enteredTone: Tone
  diff: StrDiff
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-card/40">
      <div className={cn("flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold", headerClass)}>
        {icon}
        {label}
      </div>
      <div className="space-y-2 p-2.5">
        <DiffRow title="Entraram" chips={diff.entered} tone={enteredTone} />
        <DiffRow title="Saíram" chips={diff.exited} tone="out" />
      </div>
    </div>
  )
}

function DiffRow({ title, chips, tone }: { title: string; chips: string[]; tone: Tone }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{title}</p>
      {chips.length > 0 ? (
        <ChipList chips={chips} tone={tone} />
      ) : (
        <p className="text-[11px] italic text-muted-foreground/50">nenhuma</p>
      )}
    </div>
  )
}

/** Linha compacta pras "outras mudanças": rótulo + chips que entraram/saíram. */
function OtherChangeLine({ label, diff, enteredTone }: { label: string; diff: StrDiff; enteredTone: Tone }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <ChipList chips={diff.entered} tone={enteredTone} />
      <ChipList chips={diff.exited} tone="out" />
    </div>
  )
}

function ChipList({ chips, tone }: { chips: string[]; tone: Tone }) {
  if (chips.length === 0) return null
  const shown = chips.slice(0, MAX_CHIPS)
  const extra = chips.length - shown.length
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <Badge key={c} variant="outline" className={cn("text-[11px] font-normal", TONE_CLASS[tone])}>
          {c}
        </Badge>
      ))}
      {extra > 0 && <span className="self-center text-[11px] text-muted-foreground/60">+{extra}</span>}
    </div>
  )
}
