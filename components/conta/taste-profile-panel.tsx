"use client"

import { useMemo, useState } from "react"
import {
  ArrowRight,
  Ban,
  BarChart3,
  ChevronRight,
  Clock,
  Crown,
  Heart,
  Info,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Trophy,
  Wrench,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CoverImage } from "@/components/ui/cover-image"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AiProvenanceSeal } from "@/components/ui/ai-provenance"
import { PublicationStatusBadge } from "@/components/ui/status-badge"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { GENRE_NAMES, TAG_GROUPS_CATALOG } from "@/lib/constants/tags"
import type { PredictionDriver } from "@/lib/calculations/ridge-feature-labels"
import { CRITERION_SLUGS } from "@/types/domain"
import { formatUsdApprox } from "@/lib/format/money"
import { classifyProfileTagOrigin } from "@/lib/ai-recommendation/profile-tag-origin"
import type {
  DeclaredTagLite,
  ProfileTagWithOrigin,
} from "@/lib/ai-recommendation/profile-tag-origin"
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
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
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

const TASTE_PROFILE_TASK_ID = "taste-profile"

const MIN_WORKS = 5

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

const nf = (v: number, digits = 1) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: digits })

type TabKey = "prova" | "criterios" | "tags" | "recomendacao"

/**
 * Painel de /conta/perfil — v3 (2026-08-09). A página responde UMA pergunta ("o quanto
 * vocês entendem meu gosto?"), e a v2 respondia em 4.020px com a prova em 6º lugar.
 *
 *  • Hero (sempre visível) — identidade + selo ✨ de procedência + resumo + as DUAS
 *    provas lado a lado, cada uma com seu rótulo:
 *      – concordância independente (17 de 17): a IA nunca viu o que a pessoa declarou
 *      – correlação (77%) + as 3 parcelas da MESMA medição (8,7 · 7,8 · 17 de 20)
 *    Na v2 o mesmo 77% aparecia duas vezes, com dois textos diferentes e 2.900px de
 *    distância — lido como duas métricas.
 *  • Abas — A prova · Seus critérios · Tags e temas · O que isso muda.
 *
 * O estado das abas (página da trilha, critérios abertos) mora AQUI e não dentro de
 * cada painel: os painéis desmontam ao trocar de aba, e estado lá dentro zeraria a
 * cada ida e volta.
 */
export function TasteProfilePanel({
  status,
  aligned,
  drivers,
  declared,
  unreadPageSize = 6,
}: {
  status: ProfileStatus
  aligned: AlignedWorkSplit
  drivers: PredictionDriver[]
  declared: DeclaredTagLite[]
  unreadPageSize?: number
}) {
  const [profile, setProfile] = useState<TasteProfileRow | null>(status.profile)
  const [staleness, setStaleness] = useState<ProfileStaleness | null>(status.staleness)
  const [error, setError] = useState<string | null>(null)
  // Pendência vem do STORE, não de um `useTransition`: gerar o perfil é a ação
  // mais lenta do app — 33,4s de mediana, máximo medido 46,8s (n=11 em
  // `ai_api_calls`). Prender a pessoa numa tela por meio minuto pra ela ver um
  // spinner é o oposto do que essa espera pede.
  const tasks = useAppTasks()
  const recompute = tasks.some((t) => t.id === TASTE_PROFILE_TASK_ID && t.status === "running")
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [tab, setTab] = useState<TabKey>("prova")
  const [unreadPage, setUnreadPage] = useState(0)
  const [openCriteria, setOpenCriteria] = useState<Set<string>>(() => new Set())

  const insufficient = status.ratedWorksCount < MIN_WORKS

  const handleRecompute = () => {
    setError(null)
    runTask({
      id: TASTE_PROFILE_TASK_ID,
      kind: "taste-profile",
      label: "Gerando seu perfil de gosto",
      run: async () => {
        const res = await generateTasteProfileAction()
        // A action devolve `{ error }` em vez de lançar; sem converter, o store
        // marcaria a falha como sucesso.
        if (res.error || !res.data) throw new Error(res.error ?? "Erro ao gerar o perfil.")
        return res.data
      },
      successToast: () => ({ message: "Perfil de gosto atualizado" }),
      // Se o painel ainda estiver montado, pinta o resultado na hora; se a pessoa
      // já saiu, o perfil está no banco e a próxima visita o lê do servidor.
      onDone: (data) => {
        setProfile(data)
        setStaleness(FRESHLY_GENERATED)
      },
      // A caixa vermelha inline continua, e o `runTask` também emite um toast:
      // aqui os dois se justificam, porque o toast é o único canal que alcança
      // quem saiu da página, e a caixa é a que fica legível ao lado do botão.
      onError: (err) => setError(err instanceof Error ? err.message : "Erro ao gerar o perfil."),
    })
  }
  const level = staleness ? classifyProfileStalenessLevel(staleness) : null

  const p = profile?.profile
  const lovedTags = useMemo(
    () => [...(p?.loved_tags ?? [])].sort((a, b) => b.strength - a.strength),
    [p],
  )
  const avoidedTags = useMemo(
    () => [...(p?.avoided_tags ?? [])].sort((a, b) => b.strength - a.strength),
    [p],
  )
  const narrativePatterns = p?.narrative_patterns ?? []

  // Só tags REAIS viram chip; frases-tag (temas disfarçados) entram nos temas, à
  // frente dos temas próprios (elas têm strength → já vêm ranqueadas).
  //
  // A classificação por origem mora no CLIENTE, e não pré-computada no servidor,
  // porque "Recomputar" troca o perfil em estado — pré-computada, a seção continuaria
  // descrevendo o perfil anterior até o próximo carregamento da página.
  const { lovedRealTags, avoidedRealTags, lovedThemes, avoidedThemes, origin } = useMemo(() => {
    const loved = partitionTags(lovedTags)
    const avoided = partitionTags(avoidedTags)
    return {
      lovedRealTags: loved.real,
      avoidedRealTags: avoided.real,
      lovedThemes: [...loved.phrases.map((t) => t.name), ...(p?.loved_themes ?? [])],
      avoidedThemes: [...avoided.phrases.map((t) => t.name), ...(p?.avoided_themes ?? [])],
      origin: classifyProfileTagOrigin(loved.real, avoided.real, declared),
    }
  }, [lovedTags, avoidedTags, p, declared])

  const criterionEntries = Object.entries(p?.criterion_preferences ?? {})
    .filter((e): e is [string, ProfileCriterionPreference] => e[1] != null)
    .sort(([, a], [, b]) => b.weight - a.weight)
  const criteriaWithPref = criterionEntries.length
  const criteriaWithStrongWeight = criterionEntries.filter((e) => e[1].weight >= 0.5).length

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
  // Hero: prioriza as FRASES descritivas (mais legíveis que uma tag como
  // "Borderline H"), já ranqueadas por strength; cai nas tags reais se não houver.
  const topAvoided =
    avoidedThemes.length > 0
      ? avoidedThemes.slice(0, 3)
      : avoidedRealTags.slice(0, 3).map((t) => t.name)
  // Recomputar ganha a cor da defasagem quando vale a pena rodar (âmbar/rosa),
  // sinalizando a ação sem a barra full-width que existia no rodapé do hero.
  const recomputeTint =
    !level || level === "fresh" || level === "moving"
      ? "text-muted-foreground hover:text-foreground"
      : level === "severe"
        ? "text-rose-600 hover:text-rose-700 dark:text-rose-400"
        : "text-amber-600 hover:text-amber-700 dark:text-amber-400"

  const toggleCriterion = (slug: string) =>
    setOpenCriteria((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })

  const TABS: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: "prova", label: "A prova" },
    { key: "criterios", label: "Seus critérios", count: criterionEntries.length },
    { key: "tags", label: "Tags e temas", count: origin.profileTotal },
    { key: "recomendacao", label: "O que isso muda" },
  ]

  return (
    <div className="space-y-4">
      {/* ═══════════ HERO ═══════════ */}
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
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                    healthClass,
                  )}
                >
                  {profile ? healthLabel : "Sem perfil"}
                </span>
                {/*
                 * Régua do CLAUDE.md: todo bloco cujo conteúdo saiu de um modelo leva o
                 * selo, e a procedência mora SÓ no tooltip dele. Esta página inteira é
                 * saída de LLM e não tinha nenhum — modelo e prompt viviam enterrados em
                 * "Detalhes avançados".
                 */}
                {profile && (
                  <AiProvenanceSeal
                    title="Perfil de gosto por IA"
                    model={profile.model_name}
                    promptVersion={profile.prompt_version}
                    at={profile.created_at}
                    extra={[
                      { label: "Base", value: `${profile.n_works_used} obras com nota sua` },
                      { label: "Versão", value: `v${profile.version}` },
                    ]}
                    note="Resumo, padrões, tags e faixas ideais foram escritos por um modelo a partir das suas notas — não de um formulário."
                    label="gerado por IA"
                    side="bottom"
                    align="start"
                  />
                )}
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
                  {formatUsdApprox(status.regenCostUsd)}
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
                    : `Recomputar perfil (${formatUsdApprox(status.regenCostUsd)})`
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

        {profile && (fullSummary || criterionEntries.length > 0 || topAvoided.length > 0) && (
          <div className="mt-5 grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-8">
            <div className="min-w-0">
              {fullSummary && (
                <>
                  <h3 className="text-[15px] font-semibold text-foreground sm:text-base">
                    O que a SatorIA descobriu sobre seus gostos
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
                  <Ban className="mt-0.5 size-3.5 shrink-0 text-rose-500" />
                  <span>
                    Você tende a evitar{" "}
                    {topAvoided.map((name, i) => (
                      <span key={name}>
                        <b className="font-semibold text-foreground/80">{name}</b>
                        {i < topAvoided.length - 1
                          ? i === topAvoided.length - 2
                            ? " e "
                            : ", "
                          : ". "}
                      </span>
                    ))}
                    {/* A página afirma coisas sobre a pessoa; sem esta porta, não há
                        como discordar delas. */}
                    <Link
                      href="/preferencias"
                      className="font-semibold text-sky-600 hover:underline dark:text-sky-400"
                    >
                      Não é bem assim? corrigir em Preferências →
                    </Link>
                  </span>
                </p>
              )}
            </div>

            <HeroProofs origin={origin} confirmation={aligned.confirmation} />
          </div>
        )}
      </section>

      {!profile ? (
        <EmptyState insufficient={insufficient} />
      ) : (
        <>
          {/* ═══════════ ABAS ═══════════
           * Controle SEGMENTADO, não sublinhado: espremidas entre o hero violeta e os
           * cards, um traço de 2px em texto de 13,5px era a coisa mais leve da página —
           * e é a navegação principal dela.
           *
           * 🔴 O relevo vem do TRILHO ESCURECER, não da sombra. A 1ª tentativa manteve o
           * fundo do trilho na claridade do card (`bg-card/60`, ~13% de luminosidade no
           * escuro) e só somou `inset shadow`: ficou indistinguível da versão chapada.
           * Sombra interna sobre fundo claro não vira sulco.
           *
           * ⚠️ Nada de `border-<cor>` aqui: o `* { border-color }` do globals.css vence
           * as utilities do Tailwind v4 (ver CLAUDE.md). Sulco e aresta são box-shadow.
           */}
          <div
            role="tablist"
            aria-label="Seções do perfil de gosto"
            className={cn(
              "inline-flex flex-wrap gap-[3px] rounded-[11px] p-[5px]",
              // o sulco: escurece o próprio trilho nos dois temas
              "bg-black/[.07] dark:bg-black/40",
              "shadow-[inset_0_2px_4px_rgba(0,0,0,0.16),0_1px_0_rgba(255,255,255,0.05)]",
              "dark:shadow-[inset_0_2px_5px_rgba(0,0,0,0.8),0_1px_0_rgba(255,255,255,0.06)]",
            )}
          >
            {TABS.map((t, i) => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  role="tab"
                  id={`perfil-tab-${t.key}`}
                  aria-controls={`perfil-painel-${t.key}`}
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(t.key)}
                  onKeyDown={(e) => {
                    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
                    if (!d) return
                    e.preventDefault()
                    const next = TABS[(i + d + TABS.length) % TABS.length]
                    setTab(next.key)
                    document.getElementById(`perfil-tab-${next.key}`)?.focus()
                  }}
                  className={cn(
                    "inline-flex items-center gap-[7px] rounded-lg px-[15px] py-2",
                    "text-[13.5px] font-semibold outline-none transition-[background-color,color]",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? [
                          "bg-primary text-primary-foreground",
                          // a aresta sólida de 3px é o que faz virar TECLA — e é o único
                          // elemento da página que se parece com um botão físico, então
                          // não disputa significado com nenhum outro sinal do app
                          "-translate-y-px",
                          "shadow-[0_3px_0_hsl(201_85%_40%),0_4px_6px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.6)]",
                        ]
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                  )}
                >
                  {t.label}
                  {t.count != null && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px font-mono text-[10.5px] font-bold tabular-nums",
                        active
                          ? "bg-primary-foreground/15 text-primary-foreground/85"
                          : "bg-foreground/[.08] text-muted-foreground",
                      )}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div
            role="tabpanel"
            id={`perfil-painel-${tab}`}
            aria-labelledby={`perfil-tab-${tab}`}
            className="space-y-4"
          >
            {tab === "prova" && (
              <ProofTab
                aligned={aligned}
                patterns={narrativePatterns}
                model={profile.model_name}
                promptVersion={profile.prompt_version}
                createdAt={profile.created_at}
              />
            )}

            {tab === "criterios" && (
              <CriteriaTab
                entries={criterionEntries}
                open={openCriteria}
                onToggle={toggleCriterion}
                onToggleAll={() =>
                  setOpenCriteria((prev) =>
                    prev.size === criterionEntries.length
                      ? new Set()
                      : new Set(criterionEntries.map(([slug]) => slug)),
                  )
                }
                model={profile.model_name}
                promptVersion={profile.prompt_version}
                createdAt={profile.created_at}
              />
            )}

            {tab === "tags" && (
              <TagsTab
                origin={origin}
                lovedThemes={lovedThemes}
                avoidedThemes={avoidedThemes}
              />
            )}

            {tab === "recomendacao" && (
              <RecommendationTab
                drivers={drivers}
                aligned={aligned}
                page={unreadPage}
                pageSize={unreadPageSize}
                onPage={setUnreadPage}
              />
            )}
          </div>

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
// Hero — as DUAS provas
// ─────────────────────────────────────────────────────────────

/**
 * As duas provas do hero, lado a lado e com rótulos DIFERENTES, porque respondem a
 * perguntas diferentes:
 *
 *  A) concordância independente — a IA chegou nas mesmas tags sem ver a declaração
 *  B) correlação — obra mais alinhada recebe nota mais alta
 *
 * ⚠️ As três parcelas (8,7 · 7,8 · 17 de 20) moram DENTRO de B porque saem da mesma
 * `AlignmentConfirmation`, sobre `personal_fit`. Na v2 elas viviam numa seção a
 * 2.900px, com o 77% repetido em cima — dois rótulos para o mesmo número.
 */
function HeroProofs({
  origin,
  confirmation,
}: {
  origin: ReturnType<typeof classifyProfileTagOrigin>
  confirmation: AlignmentConfirmation | null
}) {
  const hasAgreement = origin.agreementBase > 0
  if (!hasAgreement && !confirmation) return null
  const pct = confirmation
    ? Math.max(0, Math.min(100, Math.round(confirmation.correlation * 100)))
    : 0

  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-2">
      {hasAgreement && (
        <div className="bg-card p-4">
          {/* min-h de 2 linhas: um rótulo que quebra e outro que não desalinham os
              dois números — que existem justamente pra serem comparados. */}
          <p className="min-h-[2.7em] text-[10.5px] font-bold uppercase leading-[1.35] tracking-wider text-violet-600 dark:text-violet-400">
            A IA chegou sozinha
          </p>
          <p className="mt-1 font-mono text-[32px] font-bold leading-none tabular-nums text-violet-600 dark:text-violet-400">
            {origin.confirmed.length}
            <span className="ml-1 text-lg font-semibold opacity-60">
              de {origin.agreementBase}
            </span>
          </p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-violet-500"
              style={{ width: `${(origin.confirmed.length / origin.agreementBase) * 100}%` }}
            />
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            Das {origin.profileTotal} tags do seu perfil,{" "}
            <b className="text-foreground/80">{origin.agreementBase} você já tinha declarado</b> em
            Preferências. A IA nunca viu essa lista — ela lê só as obras que você avaliou.{" "}
            {origin.conflicts.length > 0 && (
              <b className="text-rose-600 dark:text-rose-400">
                {origin.conflicts.length} discordam de você.
              </b>
            )}{" "}
            <b className="text-foreground/80">
              Outras {origin.discovered.length} ela descobriu sozinha.
            </b>
          </p>
        </div>
      )}

      {confirmation && (
        <div className="bg-card p-4">
          <p className="min-h-[2.7em] text-[10.5px] font-bold uppercase leading-[1.35] tracking-wider text-emerald-600 dark:text-emerald-400">
            E isso aparece nas suas notas
          </p>
          <p className="mt-1 font-mono text-[32px] font-bold leading-none tabular-nums text-emerald-600 dark:text-emerald-400">
            {pct}%
          </p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-emerald-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            Nas <b className="tabular-nums text-foreground/80">{confirmation.ratedRead} obras</b>{" "}
            que você leu e avaliou, quanto mais alinhada ao perfil, mais alta a sua nota.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-x-2.5 border-t border-border/60 pt-2.5">
            <ProofPart
              value={nf(confirmation.topAvgScore)}
              label={`média das ${confirmation.topN} mais alinhadas`}
              tone="up"
            />
            <ProofPart value={nf(confirmation.overallAvgScore)} label="contra a média geral" />
            <ProofPart
              value={`${confirmation.topHighCount}`}
              suffix={` de ${confirmation.topN}`}
              label={`levaram nota ≥ ${confirmation.highScoreThreshold}`}
              tone="up"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ProofPart({
  value,
  suffix,
  label,
  tone,
}: {
  value: string
  suffix?: string
  label: string
  tone?: "up"
}) {
  return (
    <div className="min-w-0">
      <span
        className={cn(
          "block font-mono text-[15px] font-bold leading-tight tabular-nums",
          tone === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground/75",
        )}
      >
        {value}
        {suffix && <span className="text-[11px] font-semibold opacity-70">{suffix}</span>}
      </span>
      <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">{label}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Aba 1 — A prova
// ─────────────────────────────────────────────────────────────

function ProofTab({
  aligned,
  patterns,
  model,
  promptVersion,
  createdAt,
}: {
  aligned: AlignedWorkSplit
  patterns: string[]
  model: string
  promptVersion: string
  createdAt: string
}) {
  return (
    <>
      {aligned.read.length > 0 && (
        <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
          <ModHeader
            icon={<Trophy />}
            accent="emerald"
            title="O que o modelo previu, ao lado do que você deu"
            // O rótulo do "%" é dito UMA vez aqui, e não seis vezes dentro dos cards:
            // repetir "alinhamento" em cada tira era o que tornava a linha impossível
            // de distribuir — rótulo + barra + número pra um número só.
            subtitle={`entre as ${aligned.readTotal} que você leu e avaliou · ordenadas pela Nota Prevista · o % embaixo é a precisão do modelo nesta obra`}
          />
          <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 lg:gap-3">
            {aligned.read.map((work, i) => (
              <ReadWorkCard key={work.id} work={work} rank={i + 1} />
            ))}
          </ol>
        </section>
      )}

      {patterns.length > 0 && (
        <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
          <ModHeader
            icon={<Lightbulb />}
            accent="violet"
            title="Os padrões que a IA achou nas suas notas altas"
            subtitle="padrões que se repetem nas obras que você mais gosta"
            action={
              <AiProvenanceSeal
                title="Padrões narrativos por IA"
                model={model}
                promptVersion={promptVersion}
                at={createdAt}
                note="Frases escritas por um modelo a partir das obras que você avaliou."
              />
            }
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {patterns.map((pattern, i) => (
              <LearnCard key={pattern} text={pattern} index={i} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

/** Escala em que a precisão é lida: a mesma 0–10 em que a nota é escrita. */
const PRECISION_SCALE = 10

/**
 * Quão perto a Nota Prevista chegou da nota que a pessoa deu, nesta obra.
 *
 * ⚠️ Ela fica sempre alta — a metade do meio das 105 obras lidas cai entre 97% e 91%
 * (medido em 2026-08-13). Isso é DE PROPÓSITO e não é o mesmo defeito da barra de
 * alinhamento que saiu daqui: o modelo é feito pra acertar, e mesmo o pior caso do
 * catálogo (1,96 pt, quase 3× o cvMAE de 0,67) continua sendo uma previsão utilizável.
 * O que separa acerto de erro grande é a COR, que segue a mesma faixa do chip do erro.
 */
function precisionPct(expected: number, user: number): number {
  return Math.round(100 * (1 - Math.min(1, Math.abs(user - expected) / PRECISION_SCALE)))
}

/**
 * O erro com sinal, sempre com uma casa.
 *
 * ⚠️ Duas coisas que o `nf` sozinho errava, e as duas apareceram na tela: acerto exato
 * saía como "+0" — sinal numa diferença que não tem direção —, e erro de 1 ponto cravado
 * saía "1" em vez de "1,0", quebrando a coluna de números que os outros cards formam.
 */
function deltaLabel(delta: number): string {
  const abs = Math.abs(delta).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  if (abs === "0,0") return abs
  return `${delta >= 0 ? "+" : "−"}${abs}`
}

/**
 * Card da trilha de confirmação: PREVISTA → SUA NOTA, cada uma rotulada, com o erro
 * do modelo rotulando a SETA — que é o que ele é, o salto da previsão até a nota real.
 * Mostrar só a nota da pessoa (como na v2) desperdiçava a única comparação que a
 * página tem para provar acerto obra a obra.
 *
 * 🔴 O rodapé é a PRECISÃO, e antes era o alinhamento. Duas razões, e a segunda é a
 * que decidiu: (1) numa lista de obras JÁ LIDAS e ordenadas pela Nota Prevista, o
 * alinhamento é quase constante — 5 dos 6 cards marcavam ≥97% e as seis barras
 * saíam iguais; (2) a pergunta desta seção é o quanto o MODELO acerta, não o quanto
 * a obra combina com o gosto — esse é o assunto da trilha de não-lidas, onde o
 * `AlignmentCell` continua.
 *
 * ⚠️ Capítulos lidos saíram da tira e viraram selo na capa. Ali embaixo, colados na
 * barra de alinhamento, eles produziam o pior bug da versão anterior: "215/228"
 * seguido de uma barra em 99% lia como progresso de leitura — e batia, por acaso, em
 * 4 dos 6 cards. O caso que denunciava era o 91/91 com a barra em 85%.
 */
function ReadWorkCard({ work, rank }: { work: AlignedWork; rank: number }) {
  const delta =
    work.userScore != null && work.expectedScore != null ? work.userScore - work.expectedScore : null
  // ±0,5 é meio ponto na escala de 0–10 que a tela mostra — abaixo disso a previsão
  // e a nota arredondam para o mesmo lugar na maioria dos casos.
  const closeEnough = delta != null && Math.abs(delta) <= 0.5
  // Chip e rodapé falam do MESMO erro: tom único, senão a mesma obra sairia marcada
  // como acerto num canto e como falha no outro.
  const errorTone = closeEnough
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-amber-600 dark:text-amber-400"
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
        {work.totalChapters ? (
          <span
            title="capítulos lidos"
            className="absolute bottom-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-px font-mono text-[10px] leading-[1.4] tabular-nums text-white/85 backdrop-blur-[2px]"
          >
            {work.chaptersRead}/{work.totalChapters}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <WorkTitleLink
          title={work.title}
          workId={work.id}
          className="line-clamp-2 min-h-[2rem] text-xs font-medium leading-snug hover:underline"
        />
        {/* ⚠️ Aro e separador precisam de UMA cor por tema: um fio branco a 4% é
            invisível sobre o `muted` claro, e um preto a 6% some no escuro. Visto na
            tela — no claro a caixa ficava sem contorno e sem divisória. */}
        <div className="mt-auto pt-1">
          {work.expectedScore != null && work.userScore != null && (
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-0.5 rounded-lg bg-muted/60 px-1.5 pt-1 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              <ScorePart label="prevista" value={nf(work.expectedScore)} tone="sky" />
              <span className="flex min-w-0 flex-col items-center gap-px px-px">
                {delta != null && (
                  <span
                    title="erro do modelo nesta obra"
                    className={cn(
                      "whitespace-nowrap rounded-full px-1 py-px font-mono text-[9.5px] font-bold leading-none",
                      closeEnough ? "bg-emerald-500/15" : "bg-amber-500/15",
                      errorTone,
                    )}
                  >
                    {deltaLabel(delta)}
                  </span>
                )}
                <ArrowRight className="mb-0.5 size-3 text-muted-foreground/80" />
              </span>
              <ScorePart label="sua nota" value={nf(work.userScore)} tone="emerald" />
              {/* Separador por inset shadow, não `border-t`: o `* { border-color }` do
                  globals.css vence a utility de cor no Tailwind v4 (ver CLAUDE.md). */}
              <span
                title={`precisão da Nota Prevista nesta obra — diferença de ${deltaLabel(delta ?? 0)} ponto na escala de 0–10`}
                className={cn(
                  "col-span-full mt-1 pb-1 pt-[3px] text-center font-mono text-[10.5px] font-bold tabular-nums",
                  "shadow-[inset_0_1px_0_rgba(0,0,0,0.1)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]",
                  errorTone,
                )}
              >
                {precisionPct(work.expectedScore, work.userScore)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function ScorePart({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "sky" | "emerald"
}) {
  return (
    <span className="min-w-0 text-center">
      {/* `whitespace-nowrap`: "SUA NOTA" quebrava em duas linhas e desalinhava os dois
          lados da comparação, que é justamente o que o card existe pra parear. */}
      <span className="block whitespace-nowrap text-[8.5px] uppercase leading-tight tracking-tight text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "block font-mono text-base font-bold leading-none tabular-nums",
          tone === "sky"
            ? "text-sky-600 dark:text-sky-400"
            : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </span>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// Aba 2 — Seus critérios
// ─────────────────────────────────────────────────────────────

function CriteriaTab({
  entries,
  open,
  onToggle,
  onToggleAll,
  model,
  promptVersion,
  createdAt,
}: {
  entries: [string, ProfileCriterionPreference][]
  open: Set<string>
  onToggle: (slug: string) => void
  onToggleAll: () => void
  model: string
  promptVersion: string
  createdAt: string
}) {
  if (entries.length === 0) return null
  const allOpen = open.size === entries.length
  const withNote = entries.filter(([, pref]) => pref.note?.trim()).length
  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
      <ModHeader
        icon={<BarChart3 />}
        accent="blue"
        title={`Como a IA lê cada um dos ${entries.length} critérios`}
        subtitle="a barra é a faixa de nota que te agrada · o peso é o quanto isso decide sua nota final"
        action={
          <div className="flex items-center gap-2">
            <AiProvenanceSeal
              title="Preferências por critério, por IA"
              model={model}
              promptVersion={promptVersion}
              at={createdAt}
              extra={[{ label: "Com explicação", value: `${withNote} de ${entries.length}` }]}
              note="Faixa ideal, peso e a explicação de cada critério foram escritos por um modelo."
            />
            {withNote > 0 && (
              <button
                type="button"
                onClick={onToggleAll}
                className="rounded-md px-2 py-1 text-[11.5px] font-medium text-muted-foreground outline-none ring-1 ring-inset ring-border transition-colors hover:text-foreground focus-visible:ring-2"
              >
                {allOpen ? "Fechar todas" : "Abrir todas as notas"}
              </button>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
        {entries.length >= 3 && (
          <div className="mx-auto shrink-0 lg:mx-0 lg:sticky lg:top-4">
            <RadarSignature entries={entries.slice(0, 6)} size={180} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {/* Eixo em cima: sem ele a barra é uma faixa sem escala — e o número à
              direita (peso) seria lido como se fosse a leitura da barra. */}
          <div className="mb-1 hidden grid-cols-[minmax(0,10rem)_1fr_auto] gap-3 sm:grid">
            <span />
            <div className="relative h-3 font-mono text-[10px] text-muted-foreground/70">
              <span className="absolute left-0">0</span>
              <span className="absolute left-1/2 -translate-x-1/2">5</span>
              <span className="absolute right-0">10</span>
            </div>
            <span className="w-[104px]" />
          </div>
          {entries.map(([slug, pref]) => (
            <CriterionRow
              key={slug}
              slug={slug}
              pref={pref}
              open={open.has(slug)}
              onToggle={() => onToggle(slug)}
            />
          ))}
          <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
            Peso alto com faixa estreita é critério decisivo; peso baixo com faixa larga quer dizer
            que você tolera quase qualquer coisa ali.
          </p>
        </div>
      </div>
    </section>
  )
}

/**
 * Uma linha de critério. Três campos ROTULADOS, e não um número solto ao lado de uma
 * barra: a v2 desenhava a faixa ideal e imprimia o peso na mesma linha sem dizer que
 * eram grandezas diferentes — em Humor a barra é larga (faixa 4–8,5) com peso 50%, e
 * em Romance a barra é estreita (7–9,5) com peso 90%, então "barra maior = número
 * maior" se invertia.
 *
 * A `note` da IA (uma frase por critério) sai daqui. Ela existe no banco desde sempre
 * e a v2 não a mostrava em lugar nenhum — era o dado mais explicativo do perfil.
 */
function CriterionRow({
  slug,
  pref,
  open,
  onToggle,
}: {
  slug: string
  pref: ProfileCriterionPreference
  open: boolean
  onToggle: () => void
}) {
  const info = CRITERIA_INFO[slug]
  const left = Math.max(0, Math.min(100, pref.ideal_min * 10))
  const right = Math.max(0, Math.min(100, 100 - pref.ideal_max * 10))
  const strong = pref.weight >= 0.5
  const note = pref.note?.trim()
  const name = info?.name ?? slug

  const body = (
    <>
      <span className="flex items-center gap-1.5 truncate text-xs text-foreground/85">
        <span className="shrink-0">{info?.emoji}</span>
        <span className="truncate">{name}</span>
        {note && (
          <ChevronRight
            className={cn(
              "ml-auto size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        )}
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
      <span className="flex w-[104px] shrink-0 items-center justify-end gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono tabular-nums" title="faixa de nota que te agrada">
          {nf(pref.ideal_min)}–{nf(pref.ideal_max)}
        </span>
        <span className="flex items-center gap-1" title="peso: o quanto decide sua nota">
          <span className="h-1 w-6 overflow-hidden rounded-full bg-muted">
            <span
              className={cn("block h-full", strong ? "bg-violet-500" : "bg-muted-foreground/40")}
              style={{ width: `${pref.weight * 100}%` }}
            />
          </span>
          <b
            className={cn(
              "font-mono tabular-nums",
              strong ? "text-foreground/70" : "text-muted-foreground",
            )}
          >
            {Math.round(pref.weight * 100)}%
          </b>
        </span>
      </span>
    </>
  )

  const rowClass =
    "grid w-full grid-cols-1 items-center gap-1.5 py-2 text-left sm:grid-cols-[minmax(0,10rem)_1fr_auto] sm:gap-3"

  return (
    <div className="border-t border-border/50 first:border-t-0">
      {note ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={cn(
            rowClass,
            "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
      {note && open && (
        <p className="mb-2.5 border-l-2 border-violet-500/45 pl-3 text-[13px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Aba 3 — Tags e temas
// ─────────────────────────────────────────────────────────────

/**
 * 🔴 TAG e TEMA são coisas diferentes, e a diferença é FUNCIONAL — não de estilo.
 *
 * `computePersonalFit` só consome `loved_tags`/`avoided_tags` e os critérios: um TEMA
 * (frase livre da IA) não existe no catálogo, não casa com obra nenhuma e **não entra
 * no cálculo do alinhamento** — só contextualiza os prompts de IA. Na v2 os dois
 * saíam como a mesma pílula colorida, afirmando que pesavam igual.
 *
 * Por isso a distinção é de FORMA (pílula × linha de texto) e não de cor: os dois já
 * dividem a cor de stance (verde ama / vermelho evita), e uma frase de ~60 caracteres
 * nunca foi um chip.
 */
function TagsTab({
  origin,
  lovedThemes,
  avoidedThemes,
}: {
  origin: ReturnType<typeof classifyProfileTagOrigin>
  lovedThemes: string[]
  avoidedThemes: string[]
}) {
  const themeCount = lovedThemes.length + avoidedThemes.length
  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
      <ModHeader
        icon={<Heart />}
        accent="emerald"
        title={`As ${origin.profileTotal} tags do seu perfil, pela origem de cada uma`}
        subtitle="agrupadas por de onde vieram — é isso que responde “vocês me entendem?”"
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <Heart className="mr-1 inline size-3" />
            tag
          </span>
          existe no catálogo, casa com a obra e move o alinhamento
        </span>
        <span className="flex items-center gap-2">
          <span className="border-l-2 border-emerald-500/50 pl-2 font-medium text-foreground/80">
            tema
          </span>
          frase da IA: não casa com obra nenhuma, só contextualiza os prompts
        </span>
      </div>

      <div className="space-y-3">
        {origin.conflicts.length > 0 && (
          <Bucket
            tone="alert"
            title="Vocês discordam"
            count={origin.conflicts.length}
            description="A IA leu suas obras e concluiu o oposto do que você declarou. Vale conferir qual dos dois está desatualizado."
          >
            <TagRow tags={origin.conflicts} showOpposite />
          </Bucket>
        )}

        {origin.confirmed.length > 0 && (
          <Bucket
            tone="violet"
            title="Você declarou, e a IA confirmou"
            count={origin.confirmed.length}
            description="A IA chegou nessas lendo só as obras que você avaliou — ela nunca vê suas Preferências."
          >
            <TagRow tags={origin.confirmed} />
          </Bucket>
        )}

        {origin.discovered.length > 0 && (
          <Bucket
            title="A IA descobriu sozinha"
            count={origin.discovered.length}
            description="Não estão nas suas Preferências. Se alguma estiver errada, declarar o contrário corrige o ranking na hora — sem esperar o próximo perfil."
          >
            <TagRow tags={origin.discovered} />
          </Bucket>
        )}

        {origin.declaredOnly > 0 && (
          <Bucket
            title="Você declarou e não entrou no destilado"
            count={origin.declaredOnly}
            description={
              <>
                Isso <b className="text-foreground/80">não</b> é falha: o perfil é um destilado das
                tags mais fortes, não um inventário. Elas continuam valendo integralmente no cálculo
                do alinhamento.{" "}
                <Link
                  href="/preferencias"
                  className="font-semibold text-sky-600 hover:underline dark:text-sky-400"
                >
                  ver em Preferências →
                </Link>
              </>
            }
          />
        )}

        {themeCount > 0 && (
          <Bucket
            title="Temas — o que a IA descreveu com frase"
            count={themeCount}
            description="Não são tags: não existem no catálogo, então não casam com nenhuma obra e não entram no cálculo do alinhamento. Entram como contexto nos prompts de IA."
          >
            <ThemeList loved={lovedThemes} avoided={avoidedThemes} />
          </Bucket>
        )}
      </div>
    </section>
  )
}

function Bucket({
  title,
  count,
  description,
  tone,
  children,
}: {
  title: string
  count: number
  description: React.ReactNode
  tone?: "violet" | "alert"
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-muted/20 p-4",
        tone === "violet"
          ? "border-violet-500/35"
          : tone === "alert"
            ? "border-rose-500/40"
            : "border-border/60",
      )}
    >
      <div className="flex items-baseline gap-2">
        <h4
          className={cn(
            "text-[13px] font-semibold",
            tone === "violet"
              ? "text-violet-600 dark:text-violet-400"
              : tone === "alert"
                ? "text-rose-600 dark:text-rose-400"
                : "text-foreground",
          )}
        >
          {title}
        </h4>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

/**
 * ⚠️ Coração de CONTORNO, nunca preenchido: o ♥ preenchido é o marcador de ênfase 2×
 * (`TagStanceMark`, em 3 outras superfícies), e tag vinda do perfil nunca é forte —
 * a régua de lá é `strength` 0–1, outra escala. Preencher aqui afirmaria uma ênfase
 * que a pessoa nunca declarou.
 */
function TagRow({ tags, showOpposite }: { tags: ProfileTagWithOrigin[]; showOpposite?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const love = tag.stance === "love"
        return (
          <span
            key={`${tag.group ?? ""}::${tag.name}`}
            title={
              showOpposite
                ? `o perfil diz que você ${love ? "ama" : "evita"}; você declarou o contrário`
                : `força no perfil: ${Math.round(tag.strength * 100)}%${tag.group ? ` • grupo: ${tag.group}` : ""}`
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ring-1 ring-inset",
              love
                ? "text-emerald-700 ring-emerald-500/40 dark:text-emerald-300"
                : "text-rose-700 ring-rose-500/40 dark:text-rose-300",
            )}
          >
            {love ? <Heart className="size-3" /> : <Ban className="size-3" />}
            {tag.name}
            <span className="font-mono text-[10px] tabular-nums opacity-65">
              {Math.round(tag.strength * 100)}%
            </span>
          </span>
        )
      })}
    </div>
  )
}

/** Tema é LINHA, não pílula — ver a régua em `TagsTab`. */
function ThemeList({ loved, avoided }: { loved: string[]; avoided: string[] }) {
  const rows: Array<{ text: string; love: boolean }> = [
    ...loved.map((text) => ({ text, love: true })),
    ...avoided.map((text) => ({ text, love: false })),
  ]
  return (
    <div className="overflow-hidden rounded-lg border border-dashed border-border">
      {rows.map((row) => (
        <p
          key={row.text}
          className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-2.5 border-t border-dashed border-border/70 bg-muted/25 px-3 py-2 text-[13px] leading-relaxed text-foreground/85 first:border-t-0"
        >
          {row.love ? (
            <Heart className="size-3 shrink-0 translate-y-0.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Ban className="size-3 shrink-0 translate-y-0.5 text-rose-600 dark:text-rose-400" />
          )}
          <span>{row.text}</span>
        </p>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Aba 4 — O que isso muda
// ─────────────────────────────────────────────────────────────

function RecommendationTab({
  drivers,
  aligned,
  page,
  pageSize,
  onPage,
}: {
  drivers: PredictionDriver[]
  aligned: AlignedWorkSplit
  page: number
  pageSize: number
  onPage: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(aligned.unread.length / pageSize))
  // Defensivo: o servidor pode devolver menos obras do que na última renderização
  // (obra lida no meio-tempo) e a página guardada ficaria fora do intervalo.
  const current = Math.min(page, pages - 1)
  const slice = aligned.unread.slice(current * pageSize, current * pageSize + pageSize)

  return (
    <>
      {drivers.length > 0 && (
        <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
          <ModHeader
            icon={<TrendingUp />}
            accent="violet"
            title="O que mais pesa na sua Nota Prevista"
            subtitle="fora os 9 critérios · tamanho = importância no modelo"
          />
          <PredictionDrivers drivers={drivers} />
        </section>
      )}

      {aligned.unread.length > 0 && (
        <section className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm shadow-black/5 sm:p-5">
          <ModHeader
            icon={<ArrowRight />}
            accent="blue"
            title="Próximas leituras alinhadas"
            // Os dois "%" do card são explicados UMA vez aqui, e não em seis rótulos por
            // linha — mesma escolha do rail de "A prova".
            subtitle={`maior Nota Prevista entre as ${aligned.unreadTotal} que você ainda não leu · afinidade = o quanto casa com seu perfil · chance = probabilidade de você gostar`}
          />
          <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 lg:gap-3">
            {slice.map((work, i) => (
              <UnreadWorkCard key={work.id} work={work} rank={current * pageSize + i + 1} />
            ))}
          </ol>

          {pages > 1 && (
            <div className="mt-3 flex items-center gap-2.5">
              <span className="mr-auto text-[11.5px] tabular-nums text-muted-foreground">
                {current * pageSize + 1}–{current * pageSize + slice.length} de{" "}
                {aligned.unread.length} · ordenadas pela Nota Prevista
              </span>
              <span className="flex gap-1.5" aria-hidden="true">
                {Array.from({ length: pages }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "size-1.5 rounded-full",
                      i === current ? "bg-sky-500" : "bg-border",
                    )}
                  />
                ))}
              </span>
              <Button
                size="icon"
                variant="outline"
                className="size-7"
                onClick={() => onPage(current - 1)}
                disabled={current === 0}
                aria-label="Página anterior"
              >
                <ChevronRight className="rotate-180" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="size-7"
                onClick={() => onPage(current + 1)}
                disabled={current >= pages - 1}
                aria-label="Próxima página"
              >
                <ChevronRight />
              </Button>
            </div>
          )}

          {aligned.otherTotal > 0 && (
            <p className="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
              {/* "lidas sem nota" entrou aqui quando a trilha de cima passou a exigir nota:
                  sem esta palavra, essas obras sumiriam das três contas e o rodapé deixaria
                  de fechar com a biblioteca. */}
              {aligned.otherTotal} obras em andamento, pausadas ou lidas sem nota não entram em
              nenhuma das duas linhas — não confirmam o gosto nem são sugestão de próxima
              leitura.
            </p>
          )}
        </section>
      )}
    </>
  )
}

/** Faixas do `AlignmentCell`, aplicadas ao percentil de afinidade. */
function fitTone(percentile: number): string {
  if (percentile >= 75) return "text-emerald-600 dark:text-emerald-400"
  if (percentile >= 50) return "text-amber-600 dark:text-amber-400"
  if (percentile >= 25) return "text-orange-600 dark:text-orange-400"
  return "text-muted-foreground"
}

/**
 * Escala PRÓPRIA da chance — não dá pra reusar a da afinidade.
 *
 * 🔴 Os dois são "%" e falam de gosto, mas moram em escalas diferentes: medido no catálogo
 * em 2026-08-13, a afinidade (percentil) espalha por inteiro — p10 10 · mediana 49 · p90 90
 * —, enquanto a chance vive embaixo — p10 12 · mediana 38 · p90 60, máximo 82. Pintar 62%
 * de "mediano" nos dois faria a chance parecer sempre ruim: 62 ali é o topo do catálogo.
 */
function chanceTone(chance: number): string {
  if (chance >= 60) return "text-emerald-600 dark:text-emerald-400"
  if (chance >= 35) return "text-amber-600 dark:text-amber-400"
  return "text-muted-foreground"
}

/**
 * Card da fila de leitura. Responde "o que leio agora?", e por isso carrega três coisas que
 * o card de "A prova" não carrega: o ESTADO de publicação, a afinidade e a chance.
 *
 * ⚠️ A afinidade FICA aqui, e saiu do card de lidas, porque só aqui ela informa: naquele
 * rail (topo da Nota Prevista entre obras já lidas) 5 dos 6 cards marcavam ≥97% e as barras
 * saíam iguais; aqui vai de 36% a 97% nos mesmos seis.
 *
 * 🔴 A folga do título sobe pro TOPO do corpo (`justify-end`), e isso não é estética. O
 * título tem slot fixo de duas linhas: com um título de uma linha só, 16px ficavam em branco
 * ENTRE o nome da obra e o estado — um buraco no meio do bloco de texto. Ancorado na base, o
 * mesmo branco encosta na capa, onde lê como respiro, e as caixas dos seis cards continuam
 * alinhadas.
 */
function UnreadWorkCard({ work, rank }: { work: AlignedWork; rank: number }) {
  const percentile = work.personalFitPercentile
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
      <div className="flex flex-1 flex-col justify-end gap-1.5 p-2">
        <WorkTitleLink
          title={work.title}
          workId={work.id}
          className="line-clamp-2 text-xs font-medium leading-snug hover:underline"
        />
        <div className="flex flex-col gap-1.5">
          {/* Estado e tamanho como um PAR de pastilhas. O selo é o do app (`compact` =
              símbolo + o código curto do banco); os capítulos ganharam a mesma altura,
              raio e respiro — soltos em texto mono ao lado de um selo com borda, eles
              liam como legenda de outra coisa. */}
          <div className="flex flex-wrap items-center gap-1">
            <PublicationStatusBadge
              statusId={work.publicationStatusId}
              compact
              className="px-1.5 py-0 text-[10px] leading-[1.5]"
            />
            {work.totalChapters ? (
              <span
                title="capítulos publicados"
                className="inline-flex items-center rounded-md bg-foreground/[0.06] px-1.5 py-0 font-mono text-[10px] font-semibold leading-[1.5] tabular-nums text-muted-foreground ring-1 ring-inset ring-foreground/10"
              >
                {work.totalChapters} cap
              </span>
            ) : null}
          </div>

          {work.expectedScore != null && (
            <div className="overflow-hidden rounded-lg bg-muted/60 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              <span className="block px-1.5 pb-1 pt-1 text-center">
                <span className="block whitespace-nowrap text-[8.5px] uppercase leading-tight tracking-tight text-muted-foreground">
                  nota prevista
                </span>
                <span className="block font-mono text-base font-bold leading-none tabular-nums text-sky-600 dark:text-sky-400">
                  {nf(work.expectedScore)}
                </span>
              </span>
              {/* Rotulados e separados por um fio: sem isso, dois "%" vizinhos falando de
                  gosto leem como a MESMA medida em desacordo. */}
              {(percentile != null || work.chanceScore != null) && (
                <span className="grid grid-cols-[1fr_1px_1fr] shadow-[inset_0_1px_0_rgba(0,0,0,0.1)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <span className="px-0.5 pb-1 pt-[3px] text-center">
                    <span className="block text-[8.5px] uppercase leading-tight tracking-tight text-muted-foreground">
                      afinidade
                    </span>
                    <span
                      title="o quanto a obra casa com seu perfil, comparada à sua biblioteca"
                      className={cn(
                        "block font-mono text-[11.5px] font-bold leading-tight tabular-nums",
                        percentile != null ? fitTone(percentile) : "text-muted-foreground",
                      )}
                    >
                      {percentile != null ? `${Math.round(percentile)}%` : "—"}
                    </span>
                  </span>
                  <span className="bg-foreground/10 dark:bg-white/[0.07]" />
                  <span className="px-0.5 pb-1 pt-[3px] text-center">
                    <span className="block text-[8.5px] uppercase leading-tight tracking-tight text-muted-foreground">
                      chance
                    </span>
                    <span
                      title="probabilidade de você gostar da obra"
                      className={cn(
                        "block font-mono text-[11.5px] font-bold leading-tight tabular-nums",
                        work.chanceScore != null
                          ? chanceTone(work.chanceScore)
                          : "text-muted-foreground",
                      )}
                    >
                      {work.chanceScore != null ? `${Math.round(work.chanceScore)}%` : "—"}
                    </span>
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────
// Defasagem (canto do hero)
// ─────────────────────────────────────────────────────────────

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

/** Radar da assinatura: um valor por eixo = PESO do critério. É a "forma"
 *  reconhecível do gosto; as linhas ao lado dão faixa, peso e a explicação. */
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
 * Recomputar). Barrinha do drift medido (com a marca do limiar) + %, tingidos pelo
 * nível; o detalhe fica no tooltip.
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
              perfil novo sai praticamente igual, e a geração custa {formatUsdApprox(costUsd)}.
            </>
          ) : (
            <>
              Este perfil foi gerado antes de o app guardar a impressão digital do gosto, então não
              dá pra medir o quanto ele se moveu. Recomputar passa a permitir a medida (
              {formatUsdApprox(costUsd)}).
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

/**
 * "O que mais pesa na sua Nota Prevista" — top features do Ridge (fora os 9
 * critérios, que já estão nos critérios), como barras ranqueadas com sinal:
 * verde puxa a nota pra cima, vermelho pra baixo, tamanho = importância.
 */
function PredictionDrivers({ drivers }: { drivers: PredictionDriver[] }) {
  if (drivers.length === 0) return null
  const maxAbs = Math.max(...drivers.map((d) => Math.abs(d.coef)), 1e-9)
  return (
    <div>
      {/* 🔴 UM provider para a lista inteira, e ele é obrigatório: sem `TooltipProvider` o
          Radix LANÇA no render e derruba a aba toda (mesmo motivo documentado no
          `PublicationStatusBadge`). Um por linha funcionaria e criaria 7 contextos à toa. */}
      <TooltipProvider delayDuration={200}>
      <div className="flex flex-col">
        {drivers.map((d) => {
          const up = d.coef >= 0
          const pct = Math.max(6, (Math.abs(d.coef) / maxAbs) * 100)
          return (
            <div
              key={d.name}
              className="grid grid-cols-[minmax(0,9.5rem)_1fr_1rem] items-center gap-2.5 py-[5px]"
            >
              {/* Sem descrição, sem tooltip E sem o pontilhado que o anuncia — ver
                  `resolveFeatureDescription`. Uma linha muda é honesta; um gatilho que
                  abre vazio, não. */}
              {d.description ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help truncate text-xs text-foreground/85 underline decoration-dotted decoration-muted-foreground/70 underline-offset-[3px] hover:text-foreground hover:decoration-sky-500">
                      {d.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-[280px]">
                    <p className="font-semibold">{d.label}</p>
                    {/* ⚠️ `TooltipContent` é invertido (bg-foreground): tom secundário sai de
                        `text-background/…`; `text-muted-foreground` cai a ~3:1 no tema CLARO. */}
                    <p className="text-background/75">{d.description}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="truncate text-xs text-foreground/85" title={d.label}>
                  {d.label}
                </span>
              )}
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
      </TooltipProvider>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" />
          puxa pra cima
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-rose-500" />
          puxa pra baixo
        </span>
        <span className="ml-auto">regressão Ridge · sem LLM</span>
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
          <span className="font-mono">{formatUsdApprox(costUsd)}</span> e só compensa acima de{" "}
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
