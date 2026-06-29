import Link from "next/link"
import { getWorksByIds } from "@/server/queries/works"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getCriterionColorRanges } from "@/server/queries/criterion-prefs"
import { Header } from "@/components/layout/header"
import { WorkTable } from "@/components/titles/work-table"
import { Button } from "@/components/ui/button"

interface BatchReviewPageProps {
  searchParams: Promise<{ ids?: string }>
}

export default async function BatchReviewPage({ searchParams }: BatchReviewPageProps) {
  const { ids: rawIds } = await searchParams
  const ids = (rawIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (ids.length === 0) {
    return (
      <div className="space-y-4">
        <Header kicker="Lote" title="Revisão de lote" />
        <p className="text-sm text-muted-foreground">
          Nenhuma obra no lote.{" "}
          <Link href="/titles" className="underline">
            Ver todas as obras
          </Link>
          .
        </p>
      </div>
    )
  }

  const [works, scoreThresholds, criterionPrefs] = await Promise.all([
    getWorksByIds(ids),
    getScoreColorThresholds(),
    getCriterionColorRanges(),
  ])

  return (
    <div className="space-y-4">
      <Header
        kicker="Lote"
        title={`${works.length} obra${works.length === 1 ? "" : "s"} criada${works.length === 1 ? "" : "s"}`}
        description="Revise as notas e dados de cada obra. Clique no título pra abrir o detalhe."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link href="/titles/new">Criar mais</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/titles">Ver todas as obras</Link>
            </Button>
          </div>
        }
      />

      <WorkTable
        works={works}
        total={works.length}
        page={1}
        pageSize={works.length}
        scoreThresholds={scoreThresholds}
        criterionPrefs={criterionPrefs}
        enableCompare={false}
        enableHeatmap={false}
      />
    </div>
  )
}
