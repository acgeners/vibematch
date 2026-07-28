"use client"

import { useRef, useState, useTransition } from "react"
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  Clock,
  Crown,
  Heart,
  Info,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  Tags,
  TrendingUp,
  Trophy,
  Wrench,
} from "lucide-react"
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
import { TAG_GROUP_LABELS } from "@/lib/constants/tag-groups"
import { GENRE_NAMES, TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import type { PredictionDriver } from "@/lib/calculations/ridge-feature-labels"
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
// Prévia mostra até N tags por lado; o resto vai no "+N" → container detalhado.
const AFFINITY_COLLAPSED = 8

// Nomes reais do catálogo (lower-case). A IA às vezes gera "tags" que na verdade
// são FRASES descritivas (ex.: "Slice-of-life adulto contemporâneo sem fantasia") —
// isso é TEMA, não tag de catálogo. Separamos por pertencer ao catálogo.
const CATALOG_TAG_NAMES: Set<string> = (() => {
  const s = new Set<string>()
  for (const g of TAG_GROUPS_CATALOG) for (const v of g.values) s.add(v.toLowerCase())
  for (const n of GENRE_NAMES) s.add(n.toLowerCase())
  return s
})()

/** Divide tags do perfil em REAIS (no catálogo) e FRASES (temas disfarçados). */
function partitionTags(tags: ProfileTag[]): { real: ProfileTag[]; phrases: ProfileTag[] } {
  const real: ProfileTag[] = []
  const phrases: ProfileTag[] = []
  for (const tag of tags) {
    if (CATALOG_TAG_NAMES.has(tag.name.trim().toLowerCase())) real.push(tag)
    else phrases.push(tag)
  }
  return { real, phrases }
}

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
 * Painel de /conta/perfil — layout dashboard (v2, aprovado 2026-07-27, base no
 * mockup imagem-4). Seções, de cima pra baixo:
 *
 *  • Hero        — identidade + saúde + RESUMO CURTO (short_summary, com "ver
 *                  completo") + 3 chips-resumo + linha "evita" | medidor de
 *                  alinhamento (74% = correlação real; NÃO uma "confiança").
 *  • Assinatura  — barras por critério (0–10), ordenadas por peso, CONTIDAS.
 *  • Afinidades  — tags = pílulas (contorno) · temas = texto (formatos distintos);
 *                  evitadas em vermelho, SEM tachado.
 *  • O que a IA aprendeu — narrative_patterns como cards legíveis (sem selos de
 *                  confiança/contagem: esse dado não existe por-insight).
 *  • Prova       — "quanto o perfil te representa": 74% + média top×geral +
 *                  obras que confirmam.
 *  • Próximas    — maior Nota Prevista entre o não-lido (troca o bloco de 1 obra
 *                  do image-4, que dependia de Deep Dive por obra).
 *  • Detalhes avançados — telemetria crua (personal_fit, drift, modelo), colapsada.
 */
export function TasteProfilePanel({
  status,
  aligned,
  drivers,
}: {
  status: ProfileStatus
  aligned: AlignedWorkSplit
  drivers: PredictionDriver[]
}) {
  const [profile, setProfile] = useState<TasteProfileRow | null>(status.profile)
  const [staleness, setStaleness] = useState<ProfileStaleness | null>(status.staleness)
  const [error, setError] = useState<string | null>(null)
  const [recompute, startRecompute] = useTransition()
  const [summaryOpen, setSummaryOpen] = useState(false)
  // "Ver todos" e "+N" rolam até o container detalhado (não expandem inline).
  const detailRef = useRef<HTMLElement>(null)
  const scrollToDetail = () =>
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })

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

  // Só tags REAIS viram chip; frases-tag (temas disfarçados) entram nos temas,
  // à frente dos temas próprios (elas têm strength → já vêm ranqueadas).
  const lovedSplit = partitionTags(lovedTags)
  const avoidedSplit = partitionTags(avoidedTags)
  const lovedRealTags = lovedSplit.real
  const avoidedRealTags = avoidedSplit.real
  const lovedAllThemes = [...lovedSplit.phrases.map((t) => t.name), ...lovedThemes]
  const avoidedAllThemes = [...avoidedSplit.phrases.map((t) => t.name), ...avoidedThemes]

  const criterionEntries = Object.entries(p?.criterion_preferences ?? {})
    .filter((e): e is [string, ProfileCriterionPreference] => e[1] != null)
    .sort(([, a], [, b]) => b.weight - a.weight)
  const criteriaWithPref = criterionEntries.length
  const criteriaWithStrongWeight = criterionEntries.filter((e) => e[1].weight >= 0.5).length
  const criterionHalf = Math.ceil(criterionEntries.length / 2)

  const isStub = profile?.is_stub ?? false
  const isThin = lovedRealTags.length < 5 || criteriaWithStrongWeight < 3
  const healthLabel = isStub ? "Stub" : isThin ? "Magro" : "Saudável"
  const healthClass = !profile
    ? "bg-muted/60 text-muted-foreground ring-border"
    : isStub || isThin
      ? "bg-amber-500/15 text-amber-700 ring-amber-500/40 dark:text-amber-300"
      : "bg-emerald-500/15 text-emerald-700 ring-emerald-500/40 dark:text-emerald-300"

  // Resumo: curto por padrão; "ver completo" revela o parágrafo inteiro. Perfil
  // pré-v7 não tem short_summary → cai no summary com clamp de 4 linhas.
  const fullSummary = p?.summary?.trim() ?? ""
  const shortSummary = p?.short_summary?.trim() || null
  // "Principal coisa que evita" = maior STRENGTH entre as tags evitadas (elas SÃO
  // ranqueadas). Antes usava `avoided_themes[0]` — o 1º tema do array da IA, SEM
  // ranking: pegava um ponto arbitrário e superficial. Só cai nos temas se não
  // houver tag evitada. Top-3 pra não resumir demais.
  // Hero: prioriza as FRASES descritivas (mais legíveis que uma tag como
  // "Borderline H"), já ranqueadas por strength; cai nas tags reais se não houver.
  const topAvoided =
    avoidedAllThemes.length > 0
      ? avoidedAllThemes.slice(0, 3)
      : avoidedRealTags.slice(0, 3).map((t) => t.name)
  // Recomputar ganha a cor da defasagem quando vale a pena rodar (âmbar/rosa),
  // sinalizando a ação sem a barra full-width que existia no rodapé do hero.
  const recomputeTint =
    !level || level === "fresh" || level === "moving"
      ? "text-muted-foreground hover:text-foreground"
      : level === "severe"
        ? "text-rose-600 hover:text-rose-700 dark:text-rose-400"
        : "text-amber-600 hover:text-amber-700 dark:text-amber-400"

  return (
    <div className="space-y-4">
      {/* ═══════════ HERO ═══════════ */}
      <section className="overflow-hidden rounded-xl border border-border/70 bg-gradient-to-br from-violet-500/10 via-card to-card p-4 shadow-sm shadow-black/5 sm:p-5">
        {/* topo (largura total): identidade + custo/recomputar/defasagem */}
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
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                    healthClass,
                  )}
                >
                  {profile ? healthLabel : "Sem perfil"}
                </span>
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {profile ? (
                  <>
                    v{profile.version} · {profile.n_works_used} obras analisadas ·{" "}
                    {timeAgo(profile.created_at)}
                  </>
                ) : (
                  <>{status.ratedWorksCount} obra(s) com nota pessoal</>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              {status.regenCostUsd > 0 && (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatUsd(status.regenCostUsd)}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className={recomputeTint}
                onClick={handleRecompute}
                disabled={recompute || insufficient}
                title={
                  insufficient
                    ? `Avalie pelo menos ${MIN_WORKS} obras com user_score`
                    : `Recomputar perfil (${formatUsd(status.regenCostUsd)})`
                }
              >
                {recompute ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {profile ? "Recomputar" : "Gerar perfil"}
              </Button>
            </div>
            {profile && staleness && level && (
              <CompactFreshness
                staleness={staleness}
                level={level}
                nWorks={profile.n_works_used}
                costUsd={status.regenCostUsd}
              />
            )}
          </div>
        </div>

        {/* corpo: resumo (esq) + medidor de alinhamento (dir) */}
        {profile && (fullSummary || criterionEntries.length > 0 || topAvoided.length > 0) && (
          <div
            className={cn(
              "mt-5",
              aligned.confirmation
                ? "grid gap-6 sm:grid-cols-[1.7fr_1fr] sm:items-center sm:gap-8"
                : "max-w-[72ch]",
            )}
          >
            <div className="min-w-0">
              {fullSummary && (
                <>
                  <h3 className="text-[15px] font-semibold text-foreground sm:text-base">
                    O que a SatorIA descobriu sobre seus gostos e preferências
                  </h3>
                  <p
                    className={cn(
                      "mt-2 text-sm leading-relaxed text-foreground/85",
                      !shortSummary && !summaryOpen && "line-clamp-4",
                    )}
                  >
                    {shortSummary && !summaryOpen ? shortSummary : fullSummary}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSummaryOpen((v) => !v)}
                    className="mt-1.5 text-xs font-semibold text-sky-600 outline-none hover:underline focus-visible:underline dark:text-sky-400"
                  >
                    {summaryOpen ? "ver menos" : "ver resumo completo"}
                  </button>
                </>
              )}

              {criterionEntries.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {criterionEntries.slice(0, 3).map(([slug]) => (
                    <span
                      key={slug}
                      className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-600 ring-1 ring-inset ring-violet-500/25 dark:text-violet-300"
                    >
                      {CRITERIA_INFO[slug]?.emoji} {CRITERIA_INFO[slug]?.name ?? slug}
                    </span>
                  ))}
                </div>
              )}

              {topAvoided.length > 0 && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center text-rose-500">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M6 6l12 12" />
                    </svg>
                  </span>
                  <span>
                    Você tende a evitar{" "}
                    {topAvoided.map((name, i) => (
                      <span key={name}>
                        <b className="font-semibold text-foreground/80">{name}</b>
                        {i < topAvoided.length - 1
                          ? i === topAvoided.length - 2
                            ? " e "
                            : ", "
                          : "."}
                      </span>
                    ))}
                  </span>
                </p>
              )}
            </div>

            {aligned.confirmation && (
              <div className="sm:border-l sm:border-border/60 sm:pl-8">
                <AlignmentGauge c={aligned.confirmation} />
              </div>
            )}
          </div>
        )}
      </section>

      {!profile ? (
        <EmptyState insufficient={insufficient} />
      ) : (
        <>
          {/* ═══════════ ASSINATURA (faixa full-width: radar + barras em 2 colunas) ═══════════ */}
          {criterionEntries.length > 0 && (
            <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
              <ModHeader
                icon={<BarChart3 />}
                accent="blue"
                title="Sua assinatura de gosto"
                subtitle="Escala 0–10 · do sinal mais forte ao mais fraco"
              />
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-8">
                {criterionEntries.length >= 3 && (
                  <div className="mx-auto shrink-0 lg:mx-0">
                    <RadarSignature entries={criterionEntries.slice(0, 6)} size={180} />
                  </div>
                )}
                <div className="grid min-w-0 flex-1 gap-x-10 sm:grid-cols-2">
                  <BarGroup entries={criterionEntries.slice(0, criterionHalf)} minRows={criterionHalf} />
                  <BarGroup entries={criterionEntries.slice(criterionHalf)} minRows={criterionHalf} />
                </div>
              </div>
            </section>
          )}

          {/* ═══════════ AFINIDADES (faixa full-width: Ama sobre Evita) ═══════════ */}
          {(lovedRealTags.length > 0 || avoidedRealTags.length > 0) && (
            <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
              <ModHeader
                icon={<Heart fill="currentColor" stroke="none" />}
                accent="emerald"
                title="Afinidades e limites"
                subtitle="as tags mais fortes de cada lado"
                action={
                  <button
                    type="button"
                    onClick={scrollToDetail}
                    className="rounded-md px-2 py-1 text-[11.5px] font-medium text-muted-foreground outline-none ring-1 ring-inset ring-border transition-colors hover:text-foreground focus-visible:ring-2"
                  >
                    Ver todos
                  </button>
                }
              />
              {drivers.length > 0 ? (
                <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
                  <div className="space-y-5">
                    <AffinityBlock tone="love" title="Você ama" tags={lovedRealTags} onSeeAll={scrollToDetail} />
                    <AffinityBlock tone="avoid" title="Você evita" tags={avoidedRealTags} onSeeAll={scrollToDetail} />
                  </div>
                  <div className="lg:border-l lg:border-border/60 lg:pl-8">
                    <PredictionDrivers drivers={drivers} />
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <AffinityBlock tone="love" title="Você ama" tags={lovedRealTags} onSeeAll={scrollToDetail} />
                  <AffinityBlock tone="avoid" title="Você evita" tags={avoidedRealTags} onSeeAll={scrollToDetail} />
                </div>
              )}
            </section>
          )}

          {/* ═══════════ TAGS EM DETALHE (alvo do "Ver todos") ═══════════ */}
          {(lovedTags.length > 0 ||
            avoidedTags.length > 0 ||
            lovedThemes.length > 0 ||
            avoidedThemes.length > 0) && (
            <section
              ref={detailRef}
              className="scroll-mt-4 rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5"
            >
              <ModHeader
                icon={<Tags />}
                accent="emerald"
                title="Tags em detalhe"
                subtitle="todas as tags do seu perfil, agrupadas por grupo"
              />
              <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
                <PolarityDetail
                  tone="love"
                  title="Você ama"
                  tags={lovedRealTags}
                  themes={lovedAllThemes}
                />
                <PolarityDetail
                  tone="avoid"
                  title="Você evita"
                  tags={avoidedRealTags}
                  themes={avoidedAllThemes}
                />
              </div>
            </section>
          )}

          {/* ═══════════ O QUE A IA APRENDEU ═══════════ */}
          {narrativePatterns.length > 0 && (
            <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
              <ModHeader
                icon={<Lightbulb />}
                accent="violet"
                title="O que a IA aprendeu com suas notas"
                subtitle="padrões que aparecem nas obras que você mais gosta"
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {narrativePatterns.map((pattern, i) => (
                  <LearnCard key={pattern} text={pattern} index={i} />
                ))}
              </div>
            </section>
          )}

          {/* ═══════════ PROVA ═══════════ */}
          {(aligned.confirmation || aligned.read.length > 0) && (
            <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
              <ModHeader
                icon={<Trophy />}
                accent="emerald"
                title="Quanto este perfil representa suas avaliações?"
                subtitle="nas obras que você já leu, alinhamento alto anda junto com nota alta"
              />
              {aligned.confirmation && <ProofStats c={aligned.confirmation} />}
              {aligned.read.length > 0 && (
                <div className={cn(aligned.confirmation && "mt-4")}>
                  <Rail
                    icon={<Check className="size-3.5" />}
                    tone="emerald"
                    title="Obras que mais confirmam seu gosto"
                    total={aligned.readTotal}
                    works={aligned.read}
                    showUserScore
                  />
                </div>
              )}
            </section>
          )}

          {/* ═══════════ PRÓXIMAS LEITURAS ═══════════ */}
          {aligned.unread.length > 0 && (
            <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
              <ModHeader
                icon={<ArrowRight />}
                accent="blue"
                title="Como isso vira recomendação pra você"
                subtitle="maior Nota Prevista entre o que você ainda não leu"
              />
              <Rail
                icon={<ArrowRight className="size-3.5" />}
                tone="sky"
                title="Próximas leituras alinhadas"
                total={aligned.unreadTotal}
                works={aligned.unread}
              />
              {aligned.otherTotal > 0 && (
                <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  {aligned.otherTotal} obras em andamento ou pausadas não entram em nenhuma das duas
                  linhas — não confirmam o gosto nem são sugestão de próxima leitura.
                </p>
              )}
            </section>
          )}

          {/* ═══════════ DETALHES AVANÇADOS ═══════════ */}
          <AdvancedDetails
            profile={profile}
            staleness={staleness}
            confirmation={aligned.confirmation}
            criteriaWithStrongWeight={criteriaWithStrongWeight}
            criteriaWithPref={criteriaWithPref}
            lovedCount={lovedRealTags.length}
            avoidedCount={avoidedRealTags.length}
            isThin={isThin}
            isStub={isStub}
            costUsd={status.regenCostUsd}
          />
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
// Hero — medidor de alinhamento + linha de defasagem
// ─────────────────────────────────────────────────────────────

/**
 * Medidor do hero. Mostra a CORRELAÇÃO real (personal_fit × sua nota) como
 * "% de alinhamento" — o número honesto que temos. NÃO é uma "confiança" do
 * modelo (o app não tem esse dado). Clampada a 0–100.
 */
function AlignmentGauge({ c }: { c: AlignmentConfirmation }) {
  const pct = Math.max(0, Math.min(100, Math.round(c.correlation * 100)))
  const r = 46
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct / 100)
  return (
    <div className="w-full">
      <span className="block text-center text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 sm:text-left">
        O perfil te representa
      </span>
      <div className="mt-3 flex items-center justify-center gap-4 sm:justify-start">
        <div className="relative size-[110px] shrink-0">
          <svg width="110" height="110" viewBox="0 0 110 110">
            <circle cx="55" cy="55" r={r} fill="none" strokeWidth={9} className="stroke-muted" />
            <circle
              cx="55"
              cy="55"
              r={r}
              fill="none"
              strokeWidth={9}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              transform="rotate(-90 55 55)"
              className="stroke-emerald-500 transition-[stroke-dashoffset] duration-500"
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="font-mono text-[26px] font-bold leading-none tabular-nums text-emerald-600 dark:text-emerald-400">
                {pct}%
              </div>
              <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                alinhamento
              </div>
            </div>
          </div>
        </div>
        <p className="max-w-[22ch] text-[13px] leading-relaxed text-muted-foreground">
          suas notas confirmam o perfil em{" "}
          <b className="tabular-nums text-foreground/70">{c.ratedRead}</b> obras lidas
        </p>
      </div>
    </div>
  )
}

const LEVEL_STYLE: Record<
  ProfileStalenessLevel,
  { label: string; pill: string; dot: string; fill: string; text: string }
> = {
  fresh: {
    label: "Em dia",
    pill: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
    dot: "bg-emerald-500",
    fill: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  moving: {
    label: "Começando a mudar",
    pill: "bg-sky-500/10 text-sky-600 ring-sky-500/25 dark:text-sky-400",
    dot: "bg-sky-500",
    fill: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
  },
  stale: {
    label: "Vale recomputar",
    pill: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400",
    dot: "bg-amber-500",
    fill: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  severe: {
    label: "Recomputar",
    pill: "bg-rose-500/12 text-rose-600 ring-rose-500/30 dark:text-rose-400",
    dot: "bg-rose-500",
    fill: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
  },
}

/** Radar da assinatura (dentro do card "Sua assinatura"): um valor por eixo =
 *  PESO do critério. É a "forma" reconhecível do gosto; as barras abaixo dão os
 *  números exatos (faixa ideal + peso). Até 6 eixos de maior peso. */
function RadarSignature({
  entries,
  size = 190,
}: {
  entries: [string, ProfileCriterionPreference][]
  size?: number
}) {
  const cx = 95
  const cy = 92
  const r = 66
  const n = entries.length
  const angle = (i: number) => ((-90 + (360 / n) * i) * Math.PI) / 180
  const at = (i: number, rad: number): [number, number] => [
    cx + rad * Math.cos(angle(i)),
    cy + rad * Math.sin(angle(i)),
  ]
  const poly = entries
    .map(([, pref], i) =>
      at(i, r * Math.max(0.08, Math.min(1, pref.weight)))
        .map((v) => v.toFixed(1))
        .join(","),
    )
    .join(" ")
  const rings = [r, r * 0.667, r * 0.333]
  return (
    <div aria-hidden="true">
      <svg width={size} height={(size * 184) / 190} viewBox="0 0 190 184" className="overflow-visible">
        <g fill="none" stroke="currentColor" className="text-border">
          {rings.map((rr) => (
            <circle key={rr} cx={cx} cy={cy} r={rr} strokeWidth={1} />
          ))}
          {entries.map((_, i) => {
            const [x, y] = at(i, r)
            return <line key={i} x1={cx} y1={cy} x2={x} y2={y} strokeWidth={1} />
          })}
        </g>
        <polygon
          points={poly}
          className="fill-violet-500/25 stroke-violet-500"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <g fill="currentColor" fontSize="14" textAnchor="middle" className="text-muted-foreground">
          {entries.map(([slug], i) => {
            const [x, y] = at(i, r + 15)
            return (
              <text key={slug} x={x} y={y} dy="0.32em">
                {CRITERIA_INFO[slug]?.emoji ?? "•"}
              </text>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

const pctLabel = (v: number) =>
  `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`

/** Perfil recém-gerado: é a própria referência, então drift zero. */
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

/**
 * Indicador COMPACTO de defasagem, no canto superior direito do hero (ao lado de
 * Recomputar) — substitui a barra full-width do rodapé. Barrinha do drift medido
 * (com a marca do limiar) + %, tingidos pelo nível; o detalhe fica no tooltip.
 */
function CompactFreshness({
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
  const width = Math.min(100, (st.driftPct / PROFILE_DRIFT_REGEN_THRESHOLD) * 100)
  const tickAt = `${(PROFILE_DRIFT_THRESHOLD / PROFILE_DRIFT_REGEN_THRESHOLD) * 100}%`
  const measurable = st.reason !== "legacy_hash"

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {measurable && (
              <span className="relative h-1.5 w-14 rounded-full bg-foreground/10">
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-full", style.fill)}
                  style={{ width: `${Math.max(width, 3)}%` }}
                />
                <span
                  className="absolute inset-y-[-2px] w-px bg-foreground/30"
                  style={{ left: tickAt }}
                />
              </span>
            )}
            <span className={cn("text-[11px] font-medium tabular-nums", style.text)}>
              {measurable ? pctLabel(st.driftPct) : style.label}
            </span>
            <Info className="size-3 text-muted-foreground" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-xs text-xs leading-relaxed">
          {measurable ? (
            <>
              <b>{style.label}.</b> O perfil foi destilado de <b>{nWorks} obras</b>. Desde então{" "}
              <b>
                {st.changedTags} tag{st.changedTags === 1 ? "" : "s"}
              </b>{" "}
              entraram ou saíram do seu gosto destilado ({pctLabel(st.driftPct)} de mudança).
              Recomputar só compensa acima de {pctLabel(PROFILE_DRIFT_THRESHOLD)} — abaixo disso o
              perfil novo sai praticamente igual, e a geração custa {formatUsd(costUsd)}.
            </>
          ) : (
            <>
              Este perfil foi gerado antes de o app guardar a impressão digital do gosto, então não
              dá pra medir o quanto ele se moveu. Recomputar passa a permitir a medida (
              {formatUsd(costUsd)}).
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ─────────────────────────────────────────────────────────────
// Cabeçalho de módulo
// ─────────────────────────────────────────────────────────────

const MOD_ACCENT = {
  blue: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  muted: "bg-muted text-muted-foreground",
} as const

function ModHeader({
  icon,
  title,
  subtitle,
  accent = "muted",
  action,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  accent?: keyof typeof MOD_ACCENT
  action?: React.ReactNode
}) {
  return (
    <header className="mb-4 flex items-center gap-2.5">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4", MOD_ACCENT[accent])}>
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </header>
  )
}

// ─────────────────────────────────────────────────────────────
// Assinatura — barras por critério (contidas, ordem = peso)
// ─────────────────────────────────────────────────────────────

/** Uma coluna de barras + o eixo 0/5/10 embaixo (a Assinatura usa duas, lado a lado). */
function BarGroup({
  entries,
  minRows = 0,
}: {
  entries: [string, ProfileCriterionPreference][]
  minRows?: number
}) {
  if (entries.length === 0) return null
  const pad = Math.max(0, minRows - entries.length)
  return (
    <div>
      <div className="flex flex-col">
        {entries.map(([slug, pref]) => (
          <CriterionBar key={slug} slug={slug} pref={pref} />
        ))}
        {Array.from({ length: pad }).map((_, i) => (
          <div key={`pad-${i}`} className="h-[26px]" aria-hidden="true" />
        ))}
      </div>
      <div className="mt-1 grid grid-cols-[104px_1fr_38px] gap-2.5 sm:grid-cols-[128px_1fr_40px]">
        <span />
        <div className="relative h-3 font-mono text-[10px] text-muted-foreground/70">
          <span className="absolute left-0">0</span>
          <span className="absolute left-1/2 -translate-x-1/2">5</span>
          <span className="absolute right-0">10</span>
        </div>
        <span />
      </div>
    </div>
  )
}

function CriterionBar({ slug, pref }: { slug: string; pref: ProfileCriterionPreference }) {
  const info = CRITERIA_INFO[slug]
  const left = Math.max(0, Math.min(100, pref.ideal_min * 10))
  const right = Math.max(0, Math.min(100, 100 - pref.ideal_max * 10))
  const strong = pref.weight >= 0.5
  return (
    <div className="grid grid-cols-[104px_1fr_38px] items-center gap-2.5 py-[5px] sm:grid-cols-[128px_1fr_40px]">
      <span className="flex items-center gap-1.5 truncate text-xs text-foreground/85">
        <span className="shrink-0">{info?.emoji}</span>
        <span className="truncate">{info?.name ?? slug}</span>
      </span>
      <div className="relative h-2 rounded-full bg-muted">
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-border" />
        <div
          className={cn(
            "absolute inset-y-0 rounded-full",
            strong
              ? "bg-gradient-to-r from-sky-500/45 to-sky-500 dark:from-sky-400/45 dark:to-sky-400"
              : "bg-muted-foreground/35",
          )}
          style={{ left: `${left}%`, right: `${right}%` }}
        />
      </div>
      <span
        className={cn(
          "text-right font-mono text-[11.5px] tabular-nums",
          strong ? "text-foreground/70" : "text-muted-foreground",
        )}
      >
        {Math.round(pref.weight * 100)}%
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Afinidades — tags = pílula (contorno) · temas = texto
// ─────────────────────────────────────────────────────────────

function AvoidIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M6 6l12 12" />
    </svg>
  )
}

const AFFINITY_TONE = {
  love: {
    head: "text-emerald-600 dark:text-emerald-400",
    chip: "text-emerald-700 ring-emerald-500/40 dark:text-emerald-300",
    more: "text-emerald-600 ring-emerald-500/40 hover:bg-emerald-500/10 dark:text-emerald-400",
  },
  avoid: {
    head: "text-rose-600 dark:text-rose-400",
    chip: "text-rose-700 ring-rose-500/40 dark:text-rose-300",
    more: "text-rose-600 ring-rose-500/40 hover:bg-rose-500/10 dark:text-rose-400",
  },
} as const

/** Prévia (topo N por strength) de uma polaridade. Count = SÓ tags (bate com os
 *  chips). "+N" leva ao container detalhado. Temas saem daqui pro detalhe. */
function AffinityBlock({
  tone,
  title,
  tags,
  onSeeAll,
}: {
  tone: "love" | "avoid"
  title: string
  tags: ProfileTag[]
  onSeeAll: () => void
}) {
  if (tags.length === 0) return null
  const shown = tags.slice(0, AFFINITY_COLLAPSED)
  const hidden = tags.length - shown.length
  const t = AFFINITY_TONE[tone]
  return (
    <div>
      <p className={cn("mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide", t.head)}>
        {tone === "love" ? <Heart className="size-3.5" fill="currentColor" stroke="none" /> : <AvoidIcon />}
        {title}
        <span className="font-normal text-muted-foreground/70">({tags.length})</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {shown.map((tag) => (
          <span
            key={`${tag.group ?? ""}::${tag.name}`}
            title={
              tag.group
                ? `grupo: ${tag.group} • força: ${(tag.strength * 100).toFixed(0)}%`
                : `força: ${(tag.strength * 100).toFixed(0)}%`
            }
            className={cn("rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset", t.chip)}
          >
            {tag.name}
          </span>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={onSeeAll}
            title="Ver todas as tags no detalhe abaixo"
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset outline-none transition-colors focus-visible:ring-2",
              t.more,
            )}
          >
            +{hidden}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * "O que mais pesa na sua Nota Prevista" — top features do Ridge (fora os 9
 * critérios, que já estão na Assinatura), como barras ranqueadas com sinal:
 * verde puxa a nota pra cima, vermelho pra baixo, tamanho = importância.
 */
function PredictionDrivers({ drivers }: { drivers: PredictionDriver[] }) {
  if (drivers.length === 0) return null
  const maxAbs = Math.max(...drivers.map((d) => Math.abs(d.coef)), 1e-9)
  return (
    <div>
      <p className="mb-3 flex flex-wrap items-center gap-x-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
        <TrendingUp className="size-3.5" />
        O que mais pesa na sua Nota Prevista
        <span className="font-normal normal-case tracking-normal text-muted-foreground">
          · fora os 9 critérios
        </span>
      </p>
      <div className="flex flex-col">
        {drivers.map((d) => {
          const up = d.coef >= 0
          const pct = Math.max(6, (Math.abs(d.coef) / maxAbs) * 100)
          return (
            <div
              key={d.name}
              className="grid grid-cols-[minmax(0,9.5rem)_1fr_1rem] items-center gap-2.5 py-[5px]"
            >
              <span className="truncate text-xs text-foreground/85" title={d.label}>
                {d.label}
              </span>
              <div className="relative h-2 rounded-full bg-muted">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full",
                    up
                      ? "bg-gradient-to-r from-emerald-500/45 to-emerald-500"
                      : "bg-gradient-to-r from-rose-500/45 to-rose-500",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={cn(
                  "text-right font-mono text-xs font-bold",
                  up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                )}
                title={up ? "puxa a nota pra cima" : "puxa a nota pra baixo"}
              >
                {up ? "+" : "−"}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" />
          puxa pra cima
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-rose-500" />
          puxa pra baixo
        </span>
        <span className="ml-auto">tamanho = importância</span>
      </div>
    </div>
  )
}

/** Agrupa tags por `group` (label via TAG_GROUP_LABELS), maior grupo primeiro,
 *  tags ordenadas por strength dentro do grupo. */
function groupTagsByGroup(tags: ProfileTag[]): Array<[string, ProfileTag[]]> {
  const map = new Map<string, ProfileTag[]>()
  for (const tag of tags) {
    const key = tag.group ?? "other"
    const arr = map.get(key)
    if (arr) arr.push(tag)
    else map.set(key, [tag])
  }
  const label = (slug: string) =>
    (TAG_GROUP_LABELS as Record<string, string>)[slug] ??
    slug
      .split(/[_\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  return [...map.entries()]
    .map(
      ([slug, ts]) =>
        [label(slug), [...ts].sort((a, b) => b.strength - a.strength)] as [string, ProfileTag[]],
    )
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
}

/** Uma polaridade no container "Tags em detalhe": tags agrupadas por grupo +
 *  bloco de Temas. Nomes completos (o container tem largura pra isso). */
function PolarityDetail({
  tone,
  title,
  tags,
  themes,
}: {
  tone: "love" | "avoid"
  title: string
  tags: ProfileTag[]
  themes: string[]
}) {
  if (tags.length === 0 && themes.length === 0) return null
  const t = AFFINITY_TONE[tone]
  const groups = groupTagsByGroup(tags)
  const chip = (key: string, label: string, titleAttr?: string) => (
    <span
      key={key}
      title={titleAttr}
      className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", t.chip)}
    >
      {label}
    </span>
  )
  return (
    <div>
      <p className={cn("mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide", t.head)}>
        {tone === "love" ? <Heart className="size-3.5" fill="currentColor" stroke="none" /> : <AvoidIcon />}
        {title}
        <span className="font-normal text-muted-foreground/70">({tags.length + themes.length})</span>
      </p>
      <div className="space-y-3">
        {groups.map(([label, gtags]) => (
          <div key={label}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              {label} <span className="text-muted-foreground/50">· {gtags.length}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {gtags.map((tag) =>
                chip(
                  `${tag.group ?? ""}::${tag.name}`,
                  tag.name,
                  `força: ${(tag.strength * 100).toFixed(0)}%`,
                ),
              )}
            </div>
          </div>
        ))}
        {themes.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              Temas <span className="text-muted-foreground/50">· {themes.length}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {themes.map((theme) => chip(theme, theme))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// O que a IA aprendeu — narrative_patterns como cards
// ─────────────────────────────────────────────────────────────

const LEARN_ICONS = [Crown, Heart, Clock, TrendingUp, Sparkles, Lightbulb] as const

function LearnCard({ text, index }: { text: string; index: number }) {
  const Icon = LEARN_ICONS[index % LEARN_ICONS.length]
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3.5">
      <span className="mb-2.5 grid size-7 place-items-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-400 [&_svg]:size-3.5">
        <Icon />
      </span>
      <p className="text-[13px] leading-relaxed text-foreground/85">{text}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Prova — stats de confirmação + trilhas de capas
// ─────────────────────────────────────────────────────────────

function ProofStats({ c }: { c: AlignmentConfirmation }) {
  const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
  const pct = Math.max(0, Math.min(100, Math.round(c.correlation * 100)))
  return (
    <div className="grid items-center gap-x-5 gap-y-3 rounded-xl bg-emerald-500/[0.08] p-4 ring-1 ring-inset ring-emerald-500/20 sm:grid-cols-[auto_1fr]">
      <div className="sm:border-r sm:border-emerald-500/20 sm:pr-5">
        <div className="font-mono text-3xl font-bold leading-none tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400">
          {pct}%
        </div>
        <div className="mt-1 max-w-[24ch] text-[11px] leading-snug text-muted-foreground">
          obras compatíveis com o perfil tendem a receber suas notas mais altas
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 max-[420px]:grid-cols-1">
        <div>
          <div className="text-[10.5px] text-muted-foreground">média das compatíveis</div>
          <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {n(c.topAvgScore)}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] text-muted-foreground">contra a média geral</div>
          <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-foreground/80">
            {n(c.overallAvgScore)}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] text-muted-foreground">confirmam o perfil</div>
          <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {c.topHighCount} de {c.topN}
          </div>
        </div>
      </div>
    </div>
  )
}

const ROW_TONE = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  sky: "text-sky-600 dark:text-sky-400",
} as const

function Rail({
  icon,
  tone,
  title,
  total,
  works,
  showUserScore = false,
}: {
  icon: React.ReactNode
  tone: keyof typeof ROW_TONE
  title: string
  total: number
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
        <span className="tabular-nums text-muted-foreground">· {total} obras</span>
      </p>
      <ol className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 sm:gap-3">
        {works.map((work, i) => (
          <AlignedCard key={work.id} work={work} rank={i + 1} showUserScore={showUserScore} />
        ))}
      </ol>
    </div>
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

// ─────────────────────────────────────────────────────────────
// Detalhes avançados — telemetria crua (colapsada)
// ─────────────────────────────────────────────────────────────

function TriggerChip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 font-mono text-[11px] tabular-nums ring-1 ring-inset",
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

function HoodStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground/90">{value}</p>
    </div>
  )
}

function AdvancedDetails({
  profile,
  staleness,
  confirmation,
  criteriaWithStrongWeight,
  criteriaWithPref,
  lovedCount,
  avoidedCount,
  isThin,
  isStub,
  costUsd,
}: {
  profile: TasteProfileRow
  staleness: ProfileStaleness | null
  confirmation: AlignmentConfirmation | null
  criteriaWithStrongWeight: number
  criteriaWithPref: number
  lovedCount: number
  avoidedCount: number
  isThin: boolean
  isStub: boolean
  costUsd: number
}) {
  const trig = staleness ? profileStalenessTriggers(staleness) : null
  const days = staleness?.ageDays == null ? null : Math.floor(staleness.ageDays)
  const measurable = staleness != null && staleness.reason !== "legacy_hash"

  return (
    <details className="group rounded-xl border border-border/60 bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-[13px] font-medium text-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <Wrench className="size-3.5 text-muted-foreground" />
        Detalhes avançados — sinais crus, defasagem e o que alimenta o ranking
      </summary>
      <div className="space-y-3 px-4 pb-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <HoodStat
            label="Alinhamento (personal_fit)"
            value={confirmation ? `corr. ${confirmation.correlation.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          />
          <HoodStat label="Critérios peso ≥ 0.5" value={`${criteriaWithStrongWeight} / ${CRITERION_SLUGS.length}`} />
          <HoodStat label="Tags amadas / evitadas" value={`${lovedCount} / ${avoidedCount}`} />
          <HoodStat label="Modelo" value={`${profile.model_name} · ${profile.prompt_version}`} />
        </div>

        {staleness && trig && measurable && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Gatilhos de defasagem:</span>
            <TriggerChip on={trig.drift}>
              {staleness.changedTags} tag{staleness.changedTags === 1 ? "" : "s"} mudaram
            </TriggerChip>
            <TriggerChip on={trig.fractionNew}>
              {staleness.fractionNew > 0 ? `+${pctLabel(staleness.fractionNew)} de obras` : "+0 obras"}
            </TriggerChip>
            {days != null && (
              <TriggerChip on={trig.age}>
                {days} dia{days === 1 ? "" : "s"}
              </TriggerChip>
            )}
          </div>
        )}

        {isThin && !isStub && (
          <p className="rounded-md bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300">
            <strong>Perfil magro</strong> ({lovedCount} tags amadas, {criteriaWithStrongWeight}/
            {CRITERION_SLUGS.length} critérios com peso ≥ 0.5) — isso limita o teto matemático do{" "}
            <code className="font-mono">personal_fit</code>. Avalie mais obras com{" "}
            <code className="font-mono">user_score</code> e recompute pra enriquecer os sinais.
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Estes sinais alimentam o <code className="font-mono">personal_fit</code> e as features de
          alinhamento no ranking IA. Recomputar custa{" "}
          <span className="font-mono">{formatUsd(costUsd)}</span> e só compensa acima de{" "}
          {pctLabel(PROFILE_DRIFT_THRESHOLD)} de drift ({criteriaWithPref} critérios com preferência
          no total).
        </p>
      </div>
    </details>
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
            <code className="font-mono">user_score</code>) pra desbloquear o ranking IA e gerar seu
            perfil de gosto.
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
