"use client"

import { useState, useTransition } from "react"
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  Heart,
  Info,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Tags,
  ThumbsDown,
  Trophy,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CoverImage } from "@/components/ui/cover-image"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AlignmentCell } from "@/components/ranking/ranking-cells"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import { formatUsd } from "@/lib/cost-preview/catalog"
import {
  classifyProfileStalenessLevel,
  profileStalenessTriggers,
  PROFILE_DRIFT_REGEN_THRESHOLD,
  PROFILE_DRIFT_THRESHOLD,
  PROFILE_STALE_AGE_DAYS,
  PROFILE_STALE_FRACTION_NEW,
} from "@/lib/ai-recommendation/profile-staleness"
import type {
  ProfileStaleness,
  ProfileStalenessLevel,
} from "@/lib/ai-recommendation/profile-staleness"
import { generateTasteProfileAction } from "@/server/actions/recommendations"
import type { ProfileStatus } from "@/server/actions/recommendations"
import type {
  AlignedWork,
  AlignedWorkSplit,
  AlignmentConfirmation,
} from "@/server/queries/recommendations"
import type {
  ProfileCriterionPreference,
  ProfileTag,
  TasteProfileRow,
} from "@/lib/ai-recommendation/types"
import { cn } from "@/lib/utils"

const MIN_WORKS = 5

function timeAgo(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days === 0) return "hoje"
  if (days === 1) return "ontem"
  if (days < 30) return `há ${days} dias`
  const months = Math.floor(days / 30)
  if (months < 12) return `há ${months} mês${months > 1 ? "es" : ""}`
  return date.toLocaleDateString("pt-BR")
}

/**
 * Painel único de /conta/perfil. Consolida o antigo TasteProfileCard +
 * TasteProfileHealth num layout segmentado — cada bloco de informação
 * (diagnóstico, resumo, tags, temas, critérios, padrões) num segmento
 * destacado, sem a duplicação de summary/tags que existia entre os dois cards.
 */
export function TasteProfilePanel({
  status,
  aligned,
}: {
  status: ProfileStatus
  aligned: AlignedWorkSplit
}) {
  const [profile, setProfile] = useState<TasteProfileRow | null>(status.profile)
  // Depois de recomputar, o perfil recém-gerado É a nova referência: drift zero, idade
  // zero, nenhum gatilho. Guardar o objeto (e não só um booleano) mantém a barra honesta
  // sem precisar de um round-trip só pra ela.
  const [staleness, setStaleness] = useState<ProfileStaleness | null>(status.staleness)
  const [error, setError] = useState<string | null>(null)
  const [recompute, startRecompute] = useTransition()

  const insufficient = status.ratedWorksCount < MIN_WORKS

  const handleRecompute = () => {
    setError(null)
    startRecompute(async () => {
      const res = await generateTasteProfileAction()
      if (res.error) setError(res.error)
      else if (res.data) {
        setProfile(res.data)
        setStaleness(FRESHLY_GENERATED)
      }
    })
  }
  const level = staleness ? classifyProfileStalenessLevel(staleness) : null

  const p = profile?.profile
  const lovedTags = [...(p?.loved_tags ?? [])].sort((a, b) => b.strength - a.strength)
  const avoidedTags = [...(p?.avoided_tags ?? [])].sort((a, b) => b.strength - a.strength)
  const lovedThemes = p?.loved_themes ?? []
  const avoidedThemes = p?.avoided_themes ?? []
  const narrativePatterns = p?.narrative_patterns ?? []

  const criterionEntries = Object.entries(p?.criterion_preferences ?? {})
    .filter((e): e is [string, ProfileCriterionPreference] => e[1] != null)
    .sort(([, a], [, b]) => b.weight - a.weight)
  const criteriaWithPref = criterionEntries.length
  const criteriaWithStrongWeight = criterionEntries.filter((e) => e[1].weight >= 0.5).length

  const isStub = profile?.is_stub ?? false
  // Perfil "magro": poucos sinais limitam o TETO do personal_fit.
  const isThin = lovedTags.length < 5 || criteriaWithStrongWeight < 3
  const healthLabel = isStub ? "Stub" : isThin ? "Magro" : "Saudável"
  const healthClass = !profile
    ? "border-border bg-muted/40 text-muted-foreground"
    : isStub || isThin
      ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"

  return (
    <div className="space-y-4">
      {/* ── Hero: identidade do perfil + recomputar ── */}
      <section className="overflow-hidden rounded-xl border border-border/70 bg-gradient-to-br from-violet-500/10 via-card to-card p-4 shadow-sm shadow-black/5 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-500 ring-1 ring-violet-500/25 [&_svg]:size-5">
              <Sparkles />
            </span>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">Perfil de gosto</h2>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    healthClass,
                  )}
                >
                  {profile ? healthLabel : "Sem perfil"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {profile ? (
                  <>
                    Perfil v{profile.version} • {profile.n_works_used} obras analisadas •{" "}
                    {timeAgo(profile.created_at)}
                  </>
                ) : (
                  <>{status.ratedWorksCount} obra(s) com nota pessoal</>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status.regenCostUsd > 0 && (
              <span className="rounded-md bg-foreground/[0.06] px-2 py-1 text-[11px] tabular-nums text-muted-foreground ring-1 ring-inset ring-border">
                {formatUsd(status.regenCostUsd)}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRecompute}
              disabled={recompute || insufficient}
              title={
                insufficient
                  ? `Avalie pelo menos ${MIN_WORKS} obras com user_score`
                  : `Recomputar perfil (${formatUsd(status.regenCostUsd)})`
              }
            >
              {recompute ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              {profile ? "Recomputar" : "Gerar perfil"}
            </Button>
          </div>
        </div>

        {profile && staleness && level && (
          <ProfileStalenessRow
            staleness={staleness}
            level={level}
            nWorks={profile.n_works_used}
            costUsd={status.regenCostUsd}
          />
        )}
      </section>

      {!profile ? (
        <EmptyState insufficient={insufficient} />
      ) : (
        <>
          {/* ── Diagnóstico: resumo dos sinais ── */}
          <Segment icon={<Activity />} title="Diagnóstico">
            {isThin && !isStub && (
              <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                <strong>Perfil magro</strong> ({lovedTags.length} tags amadas,{" "}
                {criteriaWithStrongWeight}/{CRITERION_SLUGS.length} critérios com peso ≥ 0.5).
                Isso limita o teto matemático do <code className="font-mono">personal_fit</code> —
                avalie mais obras com <code className="font-mono">user_score</code> e regenere pra
                enriquecer os sinais.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat
                label="Critérios IA"
                value={`${criteriaWithStrongWeight}/${CRITERION_SLUGS.length}`}
                hint={`peso ≥ 0.5 (${criteriaWithPref} no total)`}
              />
              <Stat
                label="Tags amadas"
                value={lovedTags.length.toString()}
                hint={lovedTags.length < 5 ? "Pouco — alvo ≥ 8" : "Suficiente"}
                accent="emerald"
              />
              <Stat
                label="Tags evitadas"
                value={avoidedTags.length.toString()}
                hint={avoidedTags.length === 0 ? "Nenhuma" : "Penaliza 1.5×"}
                accent="rose"
              />
              <Stat
                label="Temas"
                value={(lovedThemes.length + avoidedThemes.length).toString()}
                hint={`${lovedThemes.length} curte · ${avoidedThemes.length} evita`}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Alimenta o <code className="font-mono">personal_fit</code> e as features de
              alinhamento no ranking IA. Perfil magro = todas as obras pontuam baixo.
            </p>
          </Segment>

          {/* ── Resumo ── */}
          {p?.summary && (
            <Segment icon={<FileText />} title="Resumo">
              <p className="text-sm leading-relaxed text-foreground/90">{p.summary}</p>
            </Segment>
          )}

          {/* ── Tags ── */}
          {(lovedTags.length > 0 || avoidedTags.length > 0) && (
            <Segment icon={<Tags />} title="Tags">
              <div className="grid gap-4 sm:grid-cols-2">
                <TagColumn
                  title="Amadas"
                  icon={<Heart className="size-3.5" />}
                  tone="emerald"
                  tags={lovedTags}
                />
                <TagColumn
                  title="Evitadas"
                  icon={<ThumbsDown className="size-3.5" />}
                  tone="rose"
                  tags={avoidedTags}
                />
              </div>
            </Segment>
          )}

          {/* ── Temas ── */}
          {(lovedThemes.length > 0 || avoidedThemes.length > 0) && (
            <Segment icon={<BookOpen />} title="Temas">
              <div className="grid gap-4 sm:grid-cols-2">
                <ThemeColumn title="Você curte" tone="emerald" themes={lovedThemes} />
                <ThemeColumn title="Você evita" tone="rose" themes={avoidedThemes} />
              </div>
            </Segment>
          )}

          {/* ── Preferências por critério ── */}
          {criterionEntries.length > 0 && (
            <Segment
              icon={<SlidersHorizontal />}
              title="Preferências por critério"
              subtitle="Faixa ideal (0–10) e peso de cada critério no alinhamento"
            >
              <div className="space-y-2.5">
                {criterionEntries.map(([slug, pref]) => (
                  <CriterionBar key={slug} slug={slug} pref={pref} />
                ))}
              </div>
            </Segment>
          )}

          {/* ── Padrões narrativos ── */}
          {narrativePatterns.length > 0 && (
            <Segment icon={<Sparkles />} title="Padrões narrativos">
              <ul className="list-inside list-disc space-y-1 text-sm text-foreground/90">
                {narrativePatterns.map((pattern) => (
                  <li key={pattern}>{pattern}</li>
                ))}
              </ul>
            </Segment>
          )}

          {/* ── Top obras alinhadas: confirmação × direcionamento ── */}
          {(aligned.read.length > 0 || aligned.unread.length > 0) && (
            <Segment
              icon={<Trophy />}
              title="Mais alinhadas com seu perfil"
              subtitle="Maior personal_fit na sua biblioteca (último recálculo)"
            >
              {aligned.read.length > 0 && (
                <AlignedRow
                  icon={<Check className="size-3.5" />}
                  tone="emerald"
                  title="Já li"
                  hint={`o perfil bate com o que você gostou · ${aligned.readTotal} obras`}
                  works={aligned.read}
                  showUserScore
                />
              )}

              {aligned.confirmation && <ConfirmationLine c={aligned.confirmation} />}

              {aligned.unread.length > 0 && (
                <div className={cn(aligned.read.length > 0 && "mt-5 border-t border-border/60 pt-4")}>
                  <AlignedRow
                    icon={<ArrowRight className="size-3.5" />}
                    tone="sky"
                    title="Ainda não li"
                    hint={`o que ler em seguida · ${aligned.unreadTotal} obras`}
                    works={aligned.unread}
                  />
                </div>
              )}

              {aligned.otherTotal > 0 && (
                <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {aligned.otherTotal} obras em andamento ou pausadas não entram em nenhuma das
                  duas linhas — não confirmam o gosto nem são sugestão de próxima leitura.
                </p>
              )}
            </Segment>
          )}
        </>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Defasagem do perfil
// ─────────────────────────────────────────────────────────────

/** Estado de um perfil acabado de gerar: é a própria referência, então drift zero. */
const FRESHLY_GENERATED: ProfileStaleness = {
  stale: false,
  reason: "identical",
  driftPct: 0,
  changedTags: 0,
  lovedJaccard: 1,
  avoidedJaccard: 1,
  fractionNew: 0,
  ageDays: 0,
}

const LEVEL_STYLE: Record<
  ProfileStalenessLevel,
  { label: string; pill: string; dot: string; fill: string }
> = {
  fresh: {
    label: "Em dia",
    pill: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
    dot: "bg-emerald-500",
    fill: "bg-emerald-500",
  },
  moving: {
    label: "Começando a mudar",
    pill: "bg-sky-500/10 text-sky-600 ring-sky-500/25 dark:text-sky-400",
    dot: "bg-sky-500",
    fill: "bg-sky-500",
  },
  stale: {
    label: "Vale recomputar",
    pill: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400",
    dot: "bg-amber-500",
    fill: "bg-amber-500",
  },
  severe: {
    label: "Recomputar",
    pill: "bg-rose-500/12 text-rose-600 ring-rose-500/30 dark:text-rose-400",
    dot: "bg-rose-500",
    fill: "bg-rose-500",
  },
}

const pctLabel = (v: number) =>
  `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`

/**
 * "Quão defasado" — substitui o aviso binário que acendia igual pra 15% e pra 60%.
 *
 * A barra é o DRIFT MEDIDO (quanto as tags amadas/evitadas destiladas se moveram
 * desde a geração); as duas marcas são os limiares já calibrados (0,15 marca stale,
 * 0,30 é o patamar que autoriza pagar a regeneração no lote de Interesse). Os três
 * chips são os três gatilhos do gate composto — acende só o que disparou, senão um
 * perfil marcado por IDADE mostraria a barra perto de zero e pareceria alerta sem causa.
 */
function ProfileStalenessRow({
  staleness: st,
  level,
  nWorks,
  costUsd,
}: {
  staleness: ProfileStaleness
  level: ProfileStalenessLevel
  nWorks: number
  costUsd: number
}) {
  const style = LEVEL_STYLE[level]
  const trig = profileStalenessTriggers(st)
  // Escala a barra até o corte severo: acima dele o preenchimento satura em 100%.
  const width = Math.min(100, (st.driftPct / PROFILE_DRIFT_REGEN_THRESHOLD) * 100)
  const tickAt = (v: number) => `${(v / PROFILE_DRIFT_REGEN_THRESHOLD) * 100}%`
  const days = st.ageDays == null ? null : Math.floor(st.ageDays)
  // Perfil legado (pré-migration 118) não tem fingerprint: o drift não é medível e a
  // barra em 0% mentiria. Nesse caso o texto diz o que de fato se sabe.
  const measurable = st.reason !== "legacy_hash"

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <TooltipProvider delayDuration={150}>
        <div className="flex flex-wrap items-center gap-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset outline-none focus-visible:ring-2",
                  style.pill,
                )}
              >
                <span className={cn("size-1.5 rounded-full", style.dot)} />
                {style.label}
                <Info className="size-3 opacity-70" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
              {measurable ? (
                <>
                  O perfil foi destilado de <b>{nWorks} obras</b>. Desde então{" "}
                  <b>{st.changedTags} tag{st.changedTags === 1 ? "" : "s"}</b> entraram ou saíram
                  do seu gosto destilado ({pctLabel(st.driftPct)} de mudança). Recomputar só
                  compensa acima de {pctLabel(PROFILE_DRIFT_THRESHOLD)} — abaixo disso o perfil
                  novo sai praticamente igual, e a geração custa {formatUsd(costUsd)}.
                </>
              ) : (
                <>
                  Este perfil foi gerado antes de o app guardar a impressão digital do gosto,
                  então não dá pra medir o quanto ele se moveu. Recomputar passa a permitir a
                  medida ({formatUsd(costUsd)}).
                </>
              )}
            </TooltipContent>
          </Tooltip>

          {measurable && (
            <div className="flex min-w-[150px] flex-1 items-center gap-2.5">
              <div className="relative h-1.5 flex-1 rounded-full bg-foreground/10">
                <div
                  className={cn("absolute inset-y-0 left-0 rounded-full", style.fill)}
                  style={{ width: `${Math.max(width, 2)}%` }}
                />
                <span
                  className="absolute inset-y-[-2px] w-px bg-foreground/25"
                  style={{ left: tickAt(PROFILE_DRIFT_THRESHOLD) }}
                />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {pctLabel(st.driftPct)} de mudança no gosto
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <TriggerChip on={trig.drift}>
              {st.changedTags} tag{st.changedTags === 1 ? "" : "s"} mudaram
            </TriggerChip>
            <TriggerChip on={trig.fractionNew}>
              {st.fractionNew > 0 ? `+${pctLabel(st.fractionNew)} de obras` : "+0 obras"}
            </TriggerChip>
            {days != null && (
              <TriggerChip on={trig.age}>
                {days} dia{days === 1 ? "" : "s"}
              </TriggerChip>
            )}
          </div>
        </div>
      </TooltipProvider>
    </div>
  )
}

/** Chip de um gatilho do gate — âmbar quando foi ELE que marcou o perfil. */
function TriggerChip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] tabular-nums ring-1 ring-inset",
        on
          ? "bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-400"
          : "bg-foreground/[0.06] text-muted-foreground ring-border",
      )}
      title={
        on
          ? "Este é o gatilho que marcou o perfil como desatualizado"
          : `Abaixo do limiar (drift ${pctLabel(PROFILE_DRIFT_THRESHOLD)} · obras ${pctLabel(PROFILE_STALE_FRACTION_NEW)} · idade ${PROFILE_STALE_AGE_DAYS} dias)`
      }
    >
      {children}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// Segmentos e blocos
// ─────────────────────────────────────────────────────────────

function Segment({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5">
      <header className="mb-3 flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  )
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: "emerald" | "rose"
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-mono font-semibold tabular-nums",
          accent === "emerald" && "text-emerald-600 dark:text-emerald-400",
          accent === "rose" && "text-rose-600 dark:text-rose-400",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

const TONE: Record<"emerald" | "rose", { label: string; badge: string }> = {
  emerald: {
    label: "text-emerald-600 dark:text-emerald-400",
    badge:
      "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  },
  rose: {
    label: "text-rose-600 dark:text-rose-400",
    badge: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300",
  },
}

function TagColumn({
  title,
  icon,
  tone,
  tags,
}: {
  title: string
  icon: React.ReactNode
  tone: "emerald" | "rose"
  tags: ProfileTag[]
}) {
  return (
    <div className="space-y-2">
      <p
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide",
          TONE[tone].label,
        )}
      >
        {icon}
        {title} <span className="text-muted-foreground/70">({tags.length})</span>
      </p>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 16).map((tag) => (
            <Badge
              key={`${tag.group ?? ""}::${tag.name}`}
              variant="secondary"
              className={TONE[tone].badge}
              title={
                tag.group
                  ? `grupo: ${tag.group} • força: ${(tag.strength * 100).toFixed(0)}%`
                  : `força: ${(tag.strength * 100).toFixed(0)}%`
              }
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma.</p>
      )}
    </div>
  )
}

function ThemeColumn({
  title,
  tone,
  themes,
}: {
  title: string
  tone: "emerald" | "rose"
  themes: string[]
}) {
  return (
    <div className="space-y-1.5">
      <p
        className={cn(
          "text-[11px] font-semibold uppercase tracking-wide",
          TONE[tone].label,
        )}
      >
        {title}
      </p>
      {themes.length > 0 ? (
        <ul className="list-inside list-disc space-y-0.5 text-sm text-foreground/90">
          {themes.map((theme) => (
            <li key={theme}>{theme}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum.</p>
      )}
    </div>
  )
}

function CriterionBar({ slug, pref }: { slug: string; pref: ProfileCriterionPreference }) {
  const info = CRITERIA_INFO[slug]
  // ideal_min/max vivem em 0–10; mapeia pra % da trilha.
  const left = Math.max(0, Math.min(100, pref.ideal_min * 10))
  const right = Math.max(0, Math.min(100, 100 - pref.ideal_max * 10))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-foreground/90">
          {info?.emoji} {info?.name ?? slug}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
          {pref.ideal_min.toFixed(1)}–{pref.ideal_max.toFixed(1)} · {(pref.weight * 100).toFixed(0)}%
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 rounded-full bg-primary/70"
          style={{ left: `${left}%`, right: `${right}%` }}
        />
      </div>
    </div>
  )
}

const ROW_TONE = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  sky: "text-sky-600 dark:text-sky-400",
} as const

/**
 * Uma das duas linhas de alinhamento. A de cima leva a NOTA PESSOAL ao lado do
 * alinhamento (é o que a torna confirmação, e não vitrine); a de baixo leva a Nota
 * Prevista, que é o análogo pra quem ainda não leu.
 */
function AlignedRow({
  icon,
  tone,
  title,
  hint,
  works,
  showUserScore = false,
}: {
  icon: React.ReactNode
  tone: keyof typeof ROW_TONE
  title: string
  hint: string
  works: AlignedWork[]
  showUserScore?: boolean
}) {
  return (
    <div>
      <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-semibold uppercase tracking-wide",
            ROW_TONE[tone],
          )}
        >
          {icon}
          {title}
        </span>
        <span className="text-muted-foreground">— {hint}</span>
      </p>
      <ol className="grid grid-cols-5 gap-2.5 sm:gap-3">
        {works.map((work, i) => (
          <AlignedCard key={work.id} work={work} rank={i + 1} showUserScore={showUserScore} />
        ))}
      </ol>
    </div>
  )
}

/**
 * A frase que prova a linha de cima. Sem ela a confirmação fica implícita em cinco
 * capas — e "implícito" é onde mora a leitura errada: até a divisão em duas linhas,
 * a obra nº 1 do bloco único era uma que o usuário nunca abriu.
 */
function ConfirmationLine({ c }: { c: AlignmentConfirmation }) {
  const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
  return (
    <p className="mt-3 rounded-md bg-emerald-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-inset ring-emerald-500/20">
      Nas <b className="tabular-nums text-emerald-600 dark:text-emerald-400">{c.topN}</b> mais
      alinhadas que você já leu, sua nota média é{" "}
      <b className="tabular-nums text-emerald-600 dark:text-emerald-400">{n(c.topAvgScore)}</b> —
      contra <b className="tabular-nums">{n(c.overallAvgScore)}</b> na média de tudo que leu.{" "}
      <b className="tabular-nums text-emerald-600 dark:text-emerald-400">
        {c.topHighCount} de {c.topN}
      </b>{" "}
      levaram nota ≥ {c.highScoreThreshold}, e a correlação entre alinhamento e sua nota é{" "}
      <b className="tabular-nums text-emerald-600 dark:text-emerald-400">
        {/* 2 casas: com 1, um 0,739 vira "0,7" e some a diferença entre correlação forte e morna. */}
        {c.correlation.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </b>{" "}
      (nas {c.ratedRead} lidas com nota).
    </p>
  )
}

function AlignedCard({
  work,
  rank,
  showUserScore,
}: {
  work: AlignedWork
  rank: number
  showUserScore: boolean
}) {
  // Card retrato (altura > largura): capa grande no topo, título + alinhamento
  // embaixo. Alinhamento via AlignmentCell — mesmo percentil/tooltip da
  // ranking-table e work-table.
  const score = showUserScore ? work.userScore : work.expectedScore
  const progress =
    showUserScore && work.totalChapters
      ? `${work.chaptersRead}/${work.totalChapters}`
      : work.totalChapters
        ? `${work.totalChapters} cap`
        : null
  return (
    <li className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-muted/20">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
        <CoverImage
          url={work.coverUrl}
          alt={work.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
        <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-black/60 font-mono text-[11px] font-semibold text-white">
          {rank}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <WorkTitleLink
          title={work.title}
          workId={work.id}
          className="line-clamp-2 text-xs font-medium leading-snug hover:underline"
        />
        <div className="mt-auto flex flex-col gap-1 pt-1">
          <AlignmentCell value={work.personalFit} percentile={work.personalFitPercentile} />
          <div className="flex items-center justify-between gap-1.5 text-[10.5px] tabular-nums text-muted-foreground">
            <span className="truncate">{progress ?? "—"}</span>
            {score != null && (
              <span
                className={cn("shrink-0 font-mono font-semibold", showUserScore && "text-foreground")}
                title={showUserScore ? "Sua nota" : "Nota Prevista"}
              >
                {score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                {!showUserScore && <span className="ml-0.5 font-normal opacity-70">prev</span>}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

function EmptyState({ insufficient }: { insufficient: boolean }) {
  return (
    <section className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">
        <Sparkles />
      </div>
      <h3 className="text-sm font-semibold text-foreground">
        {insufficient ? "Ainda não dá pra gerar" : "Nenhum perfil gerado ainda"}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
        {insufficient ? (
          <>
            Avalie pelo menos {MIN_WORKS} obras com nota pessoal (
            <code className="font-mono">user_score</code>) pra desbloquear o ranking IA e gerar
            seu perfil de gosto.
          </>
        ) : (
          <>
            Gere seu perfil de gosto pra alimentar o{" "}
            <code className="font-mono">personal_fit</code> e as features de alinhamento nas
            recomendações. Use o botão <strong>Gerar perfil</strong> acima.
          </>
        )}
      </p>
    </section>
  )
}
