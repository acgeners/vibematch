import Link from "next/link"
import {
  BookOpen,
  Brain,
  Star,
  Archive,
  TrendingUp,
  Plus,
  Upload,
  Sparkles,
  LayoutDashboard,
  Trophy,
  ArrowRight,
} from "lucide-react"
import { getDashboardStats } from "@/server/queries/dashboard"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { StatCard } from "@/components/dashboard/stat-card"
import { Header } from "@/components/layout/header"
import { ScoreBadge, type ScoreColorThresholds } from "@/components/ui/score-badge"
import { PublicationStatusBadge, PersonalStatusBadge } from "@/components/ui/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { WorkTitleLink } from "@/components/titles/work-title-link"

export default async function DashboardPage() {
  const [stats, scoreThresholds] = await Promise.all([
    getDashboardStats(),
    getScoreColorThresholds(),
  ])

  return (
    <div className="space-y-6">
      <Header
        kicker="Biblioteca"
        title="Dashboard"
        description="Visão geral do seu catálogo"
        icon={<LayoutDashboard />}
        actions={
          <Button asChild size="sm">
            <Link href="/titles/new">
              <Plus className="size-4" />
              Novo título
            </Link>
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          title="Total de obras"
          value={stats.totalWorks}
          icon={<BookOpen />}
          href="/titles"
          description="Obras ativas no catálogo"
          accent="primary"
        />
        <StatCard
          title="Pendentes IA"
          value={stats.pendingAi}
          icon={<Brain />}
          href="/ai-evaluation"
          description="Aguardando avaliação"
          accent="violet"
        />
        <StatCard
          title="Sem nota final"
          value={stats.withoutFinalScore}
          icon={<Star />}
          description="Sem Nota.Final calculada"
          accent="amber"
        />
        <StatCard
          title="Arquivadas"
          value={stats.archived}
          icon={<Archive />}
          description="Obras arquivadas"
          accent="slate"
        />
      </div>

      {/* Hero média + ações rápidas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="relative overflow-hidden lg:col-span-5">
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
              Média Nota.Final
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            {stats.avgFinalScore != null ? (
              <div className="flex items-end gap-4">
                <ScoreBadge score={stats.avgFinalScore} size="lg" className="text-2xl px-4 py-2" />
                <div className="flex flex-col">
                  <span className="text-3xl font-bold tabular-nums tracking-tight">
                    {stats.avgFinalScore.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground">de 10 pontos possíveis</span>
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Nenhuma nota calculada ainda</span>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
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

      {/* Top 5 obras */}
      {stats.topWorks.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="size-4 text-amber-500" />
              Top 5 obras por Nota.Final
            </CardTitle>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <Link href="/ranking">
                Ver ranking
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
              {stats.topWorks.map((work, index) => (
                <TopWorkCard
                  key={work.id}
                  rank={index + 1}
                  work={work}
                  scoreThresholds={scoreThresholds}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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

interface TopWorkCardProps {
  rank: number
  work: {
    id: string
    title: string
    finalScore: number | null
    publicationStatusId: number | null
    personalStatusId: number | null
  }
  scoreThresholds: ScoreColorThresholds | null
}

const RANK_STYLES = [
  "bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-amber-500/30",
  "bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-slate-500/25",
  "bg-gradient-to-br from-orange-400 to-orange-700 text-white shadow-orange-500/30",
  "bg-muted text-muted-foreground",
  "bg-muted text-muted-foreground",
]

function TopWorkCard({ rank, work, scoreThresholds }: TopWorkCardProps) {
  return (
    <div className="group relative flex flex-col gap-2.5 rounded-lg border border-border/65 bg-background/40 p-3 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-md hover:shadow-primary/10">
      <div className="flex items-start justify-between gap-2">
        <span
          className={`inline-grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums shadow-sm ${RANK_STYLES[rank - 1] ?? RANK_STYLES[4]}`}
          aria-label={`Posição ${rank}`}
        >
          {rank}
        </span>
        <ScoreBadge score={work.finalScore} size="sm" thresholds={scoreThresholds} />
      </div>
      <WorkTitleLink
        title={work.title}
        workId={work.id}
        className="line-clamp-2 text-sm font-semibold leading-snug hover:underline"
      />
      <div className="mt-auto flex flex-wrap gap-1 pt-1">
        <PublicationStatusBadge statusId={work.publicationStatusId} />
        <PersonalStatusBadge statusId={work.personalStatusId} />
      </div>
    </div>
  )
}
