import Link from "next/link"
import {
  BookMarked,
  Bookmark,
  Star,
  BellRing,
  Coins,
  Plus,
  Upload,
  Sparkles,
  LayoutDashboard,
  ArrowRight,
} from "lucide-react"
import {
  getDashboardStats,
  getContinueReading,
  getAiQueueCounts,
  getTopUnratedByExpected,
} from "@/server/queries/dashboard"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { getPredictionHealth } from "@/server/queries/calibration-guards"
import { getAiUsageTotals } from "@/server/queries/ai-usage"
import { getCurrentUserProfile } from "@/server/queries/current-user"
import { getFirstStepsProgress } from "@/server/queries/onboarding-progress"
import { StatCard } from "@/components/dashboard/stat-card"
import { AiQueueCard } from "@/components/dashboard/ai-queue-card"
import { StatusDistribution } from "@/components/dashboard/status-distribution"
import { ContinueReading } from "@/components/dashboard/continue-reading"
import { ProfileSummary } from "@/components/dashboard/profile-summary"
import { HealthStrip } from "@/components/dashboard/health-strip"
import { TopWorkCard } from "@/components/dashboard/top-work-card"
import { DashboardGreeting } from "@/components/dashboard/dashboard-greeting"
import { FirstStepsCard } from "@/components/dashboard/first-steps-card"
import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DEFAULT_PERSONAL_STATUS } from "@/lib/constants/criteria"

export const metadata = { title: "Painel — SatorIA" }

/**
 * O painel de operação — o que era a home até 2026-08-02.
 *
 * Saiu de `/` porque a primeira tela definia o produto como ferramenta interna: KPIs, fila de
 * IA, custo de API e telemetria de saúde antes de qualquer obra. A home virou vitrine (o
 * catálogo, que é o produto) e os números continuam aqui, inteiros, a um clique do menu.
 */
export default async function PainelPage() {
  const [
    stats,
    scoreThresholds,
    continueReading,
    topPicks,
    queueCounts,
    profileStatus,
    health,
    usage,
    profile,
    firstSteps,
  ] = await Promise.all([
    getDashboardStats(),
    getScoreColorThresholds(),
    getContinueReading(),
    getTopUnratedByExpected(5),
    getAiQueueCounts(),
    getTasteProfileStatusAction(),
    getPredictionHealth(),
    getAiUsageTotals(),
    getCurrentUserProfile(),
    getFirstStepsProgress(),
  ])

  const firstName = profile.displayName?.trim().split(/\s+/)[0]
  const wantToRead = stats.byPersonalStatus[DEFAULT_PERSONAL_STATUS] ?? 0

  return (
    <div className="space-y-6">
      <Header
        kicker="Painel"
        title={<DashboardGreeting firstName={firstName} />}
        description={`${stats.totalWorks} obras no catálogo · ${stats.rated} avaliadas por você`}
        icon={
          profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar do usuário (URL própria/colada); next/image não cabe (sem images config).
            <img src={profile.avatarUrl} alt="" className="size-full rounded-xl object-cover" />
          ) : (
            <LayoutDashboard />
          )
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/import">
                <Upload className="size-4" />
                <span className="hidden sm:inline">Importar</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/ai-evaluation">
                <Sparkles className="size-4" />
                <span className="hidden sm:inline">Avaliar</span>
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/titles/new">
                <Plus className="size-4" />
                Novo título
              </Link>
            </Button>
          </>
        }
      />

      {/* Ponte do onboarding: fica até a conta sair do estado inicial, some sozinha. */}
      {firstSteps && !firstSteps.complete && <FirstStepsCard progress={firstSteps} />}

      {/* Faixa de KPIs acionáveis */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          title="Acompanhando"
          value={stats.following}
          icon={<BookMarked />}
          href="/leitura"
          description="em leitura ativa"
          accent="emerald"
        />
        <StatCard
          title="Na fila"
          value={wantToRead}
          icon={<Bookmark />}
          href="/titles"
          description="quero ler"
          accent="primary"
        />
        <StatCard
          title="Avaliadas por você"
          value={stats.rated}
          icon={<Star />}
          href="/titles"
          description="alimentam seu perfil"
          accent="violet"
        />
        <StatCard
          title="Com pendências"
          value={stats.followingWithPending}
          icon={<BellRing />}
          href="/leitura"
          description="capítulos a ler"
          accent="amber"
        />
        <StatCard
          title="Custo IA (30d)"
          value={`$${usage.last30d.totalCostUsd.toFixed(2)}`}
          icon={<Coins />}
          href="/ai-usage"
          description={`$${usage.last7d.totalCostUsd.toFixed(2)} nos últimos 7 dias`}
          accent="slate"
        />
      </div>

      {/* Acompanhando (metade) + Perfil de gosto (metade) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ContinueReading
          items={continueReading}
          following={stats.following}
          followingWithPending={stats.followingWithPending}
        />
        <ProfileSummary status={profileStatus} />
      </div>

      {/* Melhores notas previstas — só obras que você ainda não avaliou */}
      {topPicks.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
              <span className="inline-flex items-center gap-2">
                <Star className="size-4 self-center text-amber-500" />
                Pra ler agora
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                · melhores notas que você ainda não avaliou
              </span>
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
              {topPicks.map((work, index) => (
                <TopWorkCard
                  key={work.id}
                  rank={index + 1}
                  work={work}
                  scoreThresholds={scoreThresholds?.expected ?? null}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sua biblioteca — distribuição por status (largura total) */}
      <StatusDistribution
        byPersonalStatus={stats.byPersonalStatus}
        byPublicationStatus={stats.byPublicationStatus}
      />

      {/* Pendências de IA (manutenção) */}
      <AiQueueCard
        attributes={stats.pendingAi}
        iaRk={queueCounts.iaRk}
        synopsis={queueCounts.synopsis}
      />

      {/* Faixa de saúde do sistema (telemetria de dev) */}
      <HealthStrip health={health} />
    </div>
  )
}
