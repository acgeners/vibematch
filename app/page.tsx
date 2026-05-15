import Link from "next/link"
import { BookOpen, Brain, Star, Archive, TrendingUp, Plus, Upload, Sparkles } from "lucide-react"
import { getDashboardStats } from "@/server/queries/dashboard"
import { StatCard } from "@/components/dashboard/stat-card"
import { Header } from "@/components/layout/header"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PublicationStatusBadge, PersonalStatusBadge } from "@/components/ui/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { WorkTitleLink } from "@/components/titles/work-title-link"

export default async function DashboardPage() {
  const stats = await getDashboardStats()

  return (
    <div className="space-y-6">
      <Header
        title="Dashboard"
        description="Visão geral do seu catálogo"
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href="/titles/new">
                <Plus className="h-4 w-4 mr-1" />
                Novo título
              </Link>
            </Button>
          </div>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total de obras"
          value={stats.totalWorks}
          icon={<BookOpen className="h-4 w-4" />}
          href="/titles"
          description="Obras ativas no catálogo"
        />
        <StatCard
          title="Pendentes IA"
          value={stats.pendingAi}
          icon={<Brain className="h-4 w-4" />}
          href="/ai-evaluation"
          description="Aguardando avaliação"
        />
        <StatCard
          title="Sem nota final"
          value={stats.withoutFinalScore}
          icon={<Star className="h-4 w-4" />}
          description="Sem Nota.Final calculada"
        />
        <StatCard
          title="Arquivadas"
          value={stats.archived}
          icon={<Archive className="h-4 w-4" />}
          description="Obras arquivadas"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Média da nota final */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Média Nota.Final
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.avgFinalScore != null ? (
              <div className="flex items-center gap-3">
                <ScoreBadge score={stats.avgFinalScore} size="lg" />
                <span className="text-sm text-muted-foreground">
                  {stats.avgFinalScore.toFixed(2)} de 10
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">Nenhuma nota calculada</span>
            )}
          </CardContent>
        </Card>

        {/* Links rápidos */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ações rápidas</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/titles/new">
                <Plus className="h-4 w-4 mr-1" />
                Novo título
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/import">
                <Upload className="h-4 w-4 mr-1" />
                Importar
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/ai-evaluation">
                <Sparkles className="h-4 w-4 mr-1" />
                Avaliação IA
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/ranking">
                <TrendingUp className="h-4 w-4 mr-1" />
                Ranking
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Top 5 obras */}
      {stats.topWorks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500" />
              Top 5 obras por Nota.Final
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.topWorks.map((work, index) => (
                <div
                  key={work.id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <span className="text-muted-foreground font-mono text-sm w-5 text-right shrink-0">
                    {index + 1}
                  </span>
                  <ScoreBadge score={work.finalScore} size="sm" />
                  <span className="flex-1 min-w-0 truncate">
                    <WorkTitleLink
                      title={work.title}
                      workId={work.id}
                      className="font-medium text-sm hover:underline"
                    />
                  </span>
                  <div className="flex gap-1 shrink-0">
                    <PublicationStatusBadge statusId={work.publicationStatusId} />
                    <PersonalStatusBadge statusId={work.personalStatusId} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link href="/ranking">Ver ranking completo</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
