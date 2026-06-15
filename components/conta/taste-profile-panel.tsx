"use client"

import { useState, useTransition } from "react"
import {
  Activity,
  AlertTriangle,
  BookOpen,
  FileText,
  Heart,
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
import { AlignmentCell } from "@/components/ranking/ranking-cells"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import { generateTasteProfileAction } from "@/server/actions/recommendations"
import type { ProfileStatus } from "@/server/actions/recommendations"
import type { AlignedWork } from "@/server/queries/recommendations"
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
  topAligned,
}: {
  status: ProfileStatus
  topAligned: AlignedWork[]
}) {
  const [profile, setProfile] = useState<TasteProfileRow | null>(status.profile)
  const [isStale, setIsStale] = useState(status.isStale)
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
        setIsStale(false)
      }
    })
  }

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
              {isStale && profile && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3" /> pode estar defasado — recompute
                </span>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRecompute}
            disabled={recompute || insufficient}
            title={
              insufficient
                ? `Avalie pelo menos ${MIN_WORKS} obras com user_score`
                : isStale
                  ? "Perfil pode estar defasado — recompute"
                  : "Recomputar perfil"
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

          {/* ── Top obras alinhadas ── */}
          {topAligned.length > 0 && (
            <Segment
              icon={<Trophy />}
              title="Mais alinhadas com seu perfil"
              subtitle="Maior personal_fit na sua biblioteca (último recálculo)"
            >
              <ol className="grid grid-cols-5 gap-2.5 sm:gap-3">
                {topAligned.map((work, i) => (
                  <AlignedCard key={work.id} work={work} rank={i + 1} />
                ))}
              </ol>
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

function AlignedCard({ work, rank }: { work: AlignedWork; rank: number }) {
  // Card retrato (altura > largura): capa grande no topo, título + alinhamento
  // embaixo. Alinhamento via AlignmentCell — mesmo percentil/tooltip da
  // ranking-table e work-table.
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
        <div className="mt-auto pt-1">
          <AlignmentCell value={work.personalFit} percentile={work.personalFitPercentile} />
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
