import Link from "next/link"
import {
  BookOpen,
  Star,
  TrendingUp,
  Plus,
  Upload,
  Sparkles,
  LayoutDashboard,
  Trophy,
  ArrowRight,
} from "lucide-react"
import {
  getDashboardStats,
  getContinueReading,
  getRecentActivity,
  getAiQueueCounts,
} from "@/server/queries/dashboard"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { getPredictionHealth } from "@/server/queries/calibration-guards"
import { getAiUsageTotals } from "@/server/queries/ai-usage"
import { getCurrentUserProfile } from "@/server/queries/current-user"
import { StatCard } from "@/components/dashboard/stat-card"
import { AiQueueCard } from "@/components/dashboard/ai-queue-card"
import { StatusDistribution } from "@/components/dashboard/status-distribution"
import { ContinueReading } from "@/components/dashboard/continue-reading"
import { RecentActivity } from "@/components/dashboard/recent-activity"
import { ProfileSummary } from "@/components/dashboard/profile-summary"
import { HealthStrip } from "@/components/dashboard/health-strip"
import { TopWorkCard } from "@/components/dashboard/top-work-card"
import { DashboardGreeting } from "@/components/dashboard/dashboard-greeting"
import { Header } from "@/components/layout/header"
import { ScoreBadge } from "@/components/ui/score-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default async function DashboardPage() {
  const [
    stats,
    scoreThresholds,
    continueReading,
    recentActivity,
    queueCounts,
    profileStatus,
    health,
    usage,
    profile,
  ] = await Promise.all([
    getDashboardStats(),
    getScoreColorThresholds(),
    getContinueReading(),
    getRecentActivity(),
    getAiQueueCounts(),
    getTasteProfileStatusAction(),
    getPredictionHealth(),
    getAiUsageTotals(),
    getCurrentUserProfile(),
  ])

  const firstName = profile.displayName?.trim().split(/\s+/)[0]

  return (
    <div className="space-y-6">
      <Header
        kicker="Dashboard"
        title={<DashboardGreeting firstName={firstName} />}
        description="Visão geral do seu catálogo"
        icon={
          profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar do usuário (URL própria/colada); next/image não cabe (sem images config).
            <img src={profile.avatarUrl} alt="" className="size-full rounded-xl object-cover" />
          ) : (
            <LayoutDashboard />
          )
        }
        actions={
          <Button asChild size="sm">
            <Link href="/titles/new">
              <Plus className="size-4" />
              Novo título
            </Link>
          </Button>
        }
      />

      {/* Total de obras + ações rápidas (cards baixos) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <StatCard
            title="Total de obras"
            value={stats.totalWorks}
            icon={<BookOpen />}
            href="/titles"
            description="Obras ativas no catálogo"
            accent="primary"
          />
        </div>

        <Card className="lg:col-span-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Ações rápidas
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <QuickAction href="/titles/new" icon={<Plus />} label="Novo título" />
            <QuickAction href="/import" icon={<Upload />} label="Importar" />
            <QuickAction href="/ai-evaluation" icon={<Sparkles />} label="Avaliação IA" />
            <QuickAction href="/ranking" icon={<Trophy />} label="Ranking" />
          </CardContent>
        </Card>
      </div>

      {/* Pendentes IA + média prevista (cards médios) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <AiQueueCard
            attributes={stats.pendingAi}
            iaRk={queueCounts.iaRk}
            synopsis={queueCounts.synopsis}
          />
        </div>

        <Card className="relative overflow-hidden lg:col-span-4">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/12 via-primary/4 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 size-48 rounded-full bg-primary/15 blur-3xl"
          />
          <CardHeader className="relative pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="size-4 text-primary" />
              Média Nota Prevista
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            {stats.avgExpectedScore != null ? (
              <div className="flex items-end gap-4">
                <ScoreBadge score={stats.avgExpectedScore} size="lg" className="text-2xl px-4 py-2" />
                <div className="flex flex-col">
                  <span className="text-3xl font-bold tabular-nums tracking-tight">
                    {stats.avgExpectedScore.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground">de 10 pontos possíveis</span>
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Nenhuma nota calculada ainda</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Distribuição por status */}
      <StatusDistribution
        byPersonalStatus={stats.byPersonalStatus}
        byPublicationStatus={stats.byPublicationStatus}
      />

      {/* Continuar lendo + atividade recente */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ContinueReading items={continueReading} />
        <RecentActivity items={recentActivity} />
      </div>

      {/* Resumo do perfil */}
      <ProfileSummary status={profileStatus} />

      {/* Top 5 obras */}
      {stats.topWorks.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="size-4 text-amber-500" />
              Top 5 obras por Nota Prevista
            </CardTitle>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <Link href="/ranking">
                Ver ranking
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
              {stats.topWorks.map((work, index) => (
                <TopWorkCard
                  key={work.id}
                  rank={index + 1}
                  work={work}
                  scoreThresholds={scoreThresholds?.final ?? null}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Faixa de saúde do sistema */}
      <HealthStrip health={health} cost7d={usage.last7d.totalCostUsd} />
    </div>
  )
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 rounded-lg border border-border/65 bg-background/40 px-3 py-2.5 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-sm hover:shadow-primary/10"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/12 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground [&_svg]:size-3.5">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </Link>
  )
}
