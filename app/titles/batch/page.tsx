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

export const metadata = { title: "Revisão de lote" }

export default async function BatchReviewPage({ searchParams }: BatchReviewPageProps) {
  const { ids: rawIds } = await searchParams
  const ids = (rawIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (ids.length === 0) {
    return (
      <div className="space-y-4">
        <Header title="Revisão de lote" />
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

  // Recém-criadas ainda não têm dados pra uma Nota Prevista significativa (vão
  // pra Avaliação IA em seguida) e o recalc é deferido. Esconde o badge de nota
  // nesta tela de revisão pra não mostrar um número sem sentido — mesmo que um
  // recalc posterior já tenha rodado quando a URL for revisitada.
  const worksForReview = works.map((work) => ({
    ...work,
    calculated_scores: work.calculated_scores
      ? { ...work.calculated_scores, expected_score: null, expected_is_stub: false }
      : work.calculated_scores,
  }))

  return (
    <div className="space-y-4">
      <Header
        title={`${works.length} obra${works.length === 1 ? "" : "s"} criada${works.length === 1 ? "" : "s"}`}
        description="Revise os dados de cada obra. A Nota Prevista é calculada depois da Avaliação IA. Clique no título pra abrir o detalhe."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link href="/ai-evaluation">Avaliar com IA</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/titles/new">Criar mais</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/titles">Ver todas as obras</Link>
            </Button>
          </div>
        }
      />

      <WorkTable
        works={worksForReview}
        total={worksForReview.length}
        page={1}
        pageSize={worksForReview.length}
        scoreThresholds={scoreThresholds}
        criterionPrefs={criterionPrefs}
        viewNamespace="batch"
        defaultViewMode="cards"
        enableCompare={false}
        enableHeatmap={false}
      />
    </div>
  )
}
