import Link from "next/link"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"
import { ArrowLeft, ArrowRight, BrainCircuit, CalendarCheck, Clock, Sparkles, Users } from "lucide-react"
import { getRunModeDisplay } from "@/components/recommendations/run-mode-display"
import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { RankedWorksView } from "@/components/recommendations/ranked-works-view"
import { TasteProfileSummary } from "@/components/titles/recommendations/taste-profile-summary"
import { ProfileStatusBadge } from "@/components/recommendations/profile-status-badge"
import { ProfileDiffSummary } from "@/components/recommendations/profile-diff-summary"
import { RunDetailActions } from "@/components/recommendations/run-detail-actions"
import { RunDeleteButton } from "@/components/recommendations/run-delete-button"
import { getRecommendationRun } from "@/server/queries/recommendations"
import { getWorksByIds } from "@/server/queries/works"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { createAdminClient } from "@/lib/supabase/admin"
import { formatRelativeDate, formatRelativeDateTime } from "@/lib/date-utils"
import type { RankedCandidate, TasteProfileRow } from "@/lib/ai-recommendation/types"
import type { WorkWithRelations } from "@/types/domain"

/** "claude-sonnet-4-6" → "Claude Sonnet 4.6" (junta os dígitos finais como versão). */
function prettyModel(model: string): string {
  const parts = model.split("-")
  const nums: string[] = []
  while (parts.length && /^\d+$/.test(parts[parts.length - 1])) nums.unshift(parts.pop()!)
  const words = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
  return nums.length ? `${words} ${nums.join(".")}` : words
}

/** Item do container de infos: ícone + rótulo + valor. */
function MetaItem({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode
  label: string
  value?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/5 text-primary ring-1 ring-primary/20 shadow-sm [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">{label}</p>
        <div className="text-sm font-semibold text-foreground mt-0.5">{children ?? value}</div>
      </div>
    </div>
  )
}

// Sem `revalidate`: a rodada é de UMA pessoa (`getRecommendationRun` filtra por sessão), então
// cache de rota compartilharia o resultado dela com quem abrisse o mesmo slug depois. Inerte
// hoje pelo force-dynamic do layout raiz, mas ver [[gotcha-force-dynamic-per-user]].

async function loadProfileById(id: string | null): Promise<TasteProfileRow | null> {
  if (!id) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("taste_profile")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id as string,
    version: data.version as number,
    is_current: data.is_current as boolean,
    is_stub: data.is_stub as boolean,
    n_works_used: data.n_works_used as number,
    input_hash: data.input_hash as string,
    model_name: data.model_name as string,
    prompt_version: data.prompt_version as string,
    profile: data.profile as TasteProfileRow["profile"],
    raw_response: data.raw_response,
    created_at: data.created_at as string,
  }
}

interface PageProps {
  params: Promise<{ slug: string }>
}

// Estático, e não o rótulo do modo: o modo só existe dentro de `getRecommendationRun`, que
// carrega a rodada inteira (ranked + obras). `generateMetadata` roda em passada própria, então
// derivar o nome da aba custaria a rodada duas vezes por visita.
export const metadata = { title: "Execução de recomendação" }

export default async function RunDetailPage({ params }: PageProps) {
  const { slug } = await params
  const run = await getRecommendationRun(slug)
  if (!run) notFound()

  const validRanked = run.ranked.filter((r) => r.work != null)
  const removedRanked = run.ranked.filter((r) => r.work == null)
  const validRankedIds = validRanked.map((r) => r.work_id)

  const [usedProfile, currentProfile, fullWorks] = await Promise.all([
    loadProfileById(run.tasteProfileId),
    loadCurrentTasteProfile(),
    validRankedIds.length > 0
      ? getWorksByIds(validRankedIds)
      : Promise.resolve([] as WorkWithRelations[]),
  ])

  const worksById: Record<string, WorkWithRelations> = {}
  for (const w of fullWorks) worksById[w.id] = w

  const isTiebreak = (run.sourceMeta as { tiebreak?: boolean } | null)?.tiebreak === true
  const { label: modeLabel, Icon: ModeIcon } = getRunModeDisplay(run.mode, isTiebreak)

  // Status do perfil usado: quantas versões atrás do atual (null = sem comparação).
  const versionsBehind =
    usedProfile != null && currentProfile != null
      ? currentProfile.version - usedProfile.version
      : null

  const droppedCount =
    run.nAvailable != null && run.nAvailable > run.nCandidates
      ? run.nAvailable - run.nCandidates
      : 0

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/recommendations"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> voltar pra histórico
        </Link>
        <RunDeleteButton runId={run.id} />
      </div>

      <Header
        kicker="Execução de recomendação"
        title={modeLabel}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarCheck className="h-3.5 w-3.5 text-muted-foreground/80" />
              Análise concluída em {validRanked.length} obra{validRanked.length !== 1 ? "s" : ""}
            </span>
            <span className="text-muted-foreground/45 select-none">•</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-muted-foreground/80" />
              {formatRelativeDateTime(run.createdAt)}
            </span>
          </span>
        }
        icon={<ModeIcon />}
      />

      {/* Container de infos principais da execução */}
      <div className="rounded-xl border border-border/80 bg-card/25 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <MetaItem icon={<BrainCircuit />} label="Modelo" value={prettyModel(run.modelName)} />
            <MetaItem icon={<Sparkles />} label="Prompt" value={run.promptVersion} />
            <MetaItem icon={<Users />} label="Candidatos" value={`${run.nCandidates} obras`} />
            {usedProfile && (
              <MetaItem icon={<Clock />} label="Perfil considerado">
                <ProfileStatusBadge
                  bare
                  version={usedProfile.version}
                  createdAt={usedProfile.created_at}
                  versionsBehind={versionsBehind}
                />
              </MetaItem>
            )}
          </div>
          <RunDetailActions runId={run.id} />
        </div>
      </div>

      {droppedCount > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <strong>{droppedCount}</strong> obra{droppedCount === 1 ? "" : "s"} não entr
          {droppedCount === 1 ? "ou" : "aram"} nesta run (limite de {run.nCandidates}{" "}
          selecionado, total disponível: {run.nAvailable}). As com menor{" "}
          <span className="font-mono">expected_score</span> (Nota Prevista) foram descartadas.
        </div>
      )}

      {run.userContext && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
              Contexto fornecido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm italic text-foreground/90">“{run.userContext}”</p>
          </CardContent>
        </Card>
      )}

      {run.modeSummary && (
        <p className="rounded-md bg-muted/40 p-3 text-sm leading-relaxed text-foreground/90">
          {run.modeSummary}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Ranking ({run.ranked.length} obra(s))
        </h2>
        {run.ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Esta execução não retornou obras (ou todas foram removidas do catálogo).
          </p>
        ) : (
          <RankedWorksView
            ranked={validRanked.map(
              (r): RankedCandidate => ({
                work_id: r.work_id,
                alignment_score: r.alignment_score,
                justification: r.justification,
                top_match_factors: r.top_match_factors,
                risks: r.risks,
                confidence: r.confidence,
                work: r.work!,
                coverUrl: r.coverUrl,
              }),
            )}
            worksById={worksById}
          />
        )}
        {removedRanked.length > 0 && (
          <div className="space-y-1 pt-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Obras removidas do catálogo
            </p>
            {removedRanked.map((r) => (
              <div
                key={r.work_id}
                className="rounded-lg border bg-card/40 p-3 text-sm text-muted-foreground"
              >
                score {Math.round(r.alignment_score)} — obra removida
              </div>
            ))}
          </div>
        )}
      </section>

      {usedProfile && versionsBehind != null && versionsBehind > 0 && currentProfile && (
        <ProfileDiffSummary used={usedProfile.profile} current={currentProfile.profile} />
      )}

      {usedProfile && (
        <CollapsibleCard
          title="Perfil de gosto usado nesta execução"
          description={`v${usedProfile.version} · gerado ${formatRelativeDate(usedProfile.created_at)}`}
          defaultOpen={false}
          action={
            <Link
              href="/conta/perfil"
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-primary hover:underline"
            >
              Ver perfil atual <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          <TasteProfileSummary profile={usedProfile} />
        </CollapsibleCard>
      )}
    </div>
  )
}
