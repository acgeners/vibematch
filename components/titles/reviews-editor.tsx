import { MessageSquareText } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExternalManualReviewsSection } from "@/components/titles/external-manual-reviews-section"
import { FetchedReviewsSection } from "@/components/titles/fetched-reviews-section"
import type { ExternalManualReviewDisplayRow } from "@/server/queries/external-manual-reviews"
import type { WorkReviewsBySource } from "@/server/queries/work-reviews"

interface Props {
  workId: string
  /** Gate local aberto? O canal de review manual (externas) é local/dev. */
  externalEditorEnabled: boolean
  externalReviews: ExternalManualReviewDisplayRow[]
  /** Reviews buscadas das fontes (work_reviews), agrupadas por fonte. Só dá pra excluir (efêmeras). */
  fetchedReviews: WorkReviewsBySource[]
}

/**
 * Card "Reviews" da página de edição (Plano 3 B2.2N). Dois canais:
 *  - reviews EXTERNAS adicionadas à mão (`work_external_reviews_manual`) — duráveis, CRUD completo;
 *  - reviews BUSCADAS das fontes (`work_reviews`) — só exclusão (são apagadas/reescritas a cada
 *    avaliação/refetch, então a remoção é efêmera).
 * Ambas alimentam o corpus do digest e a AVALIAÇÃO IA. Só aparece com o gate local aberto;
 * em produção (sem auth) o canal manual não fica editável.
 */
export function ReviewsEditor({ workId, externalEditorEnabled, externalReviews, fetchedReviews }: Props) {
  if (!externalEditorEnabled) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Reviews</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <ExternalManualReviewsSection workId={workId} reviews={externalReviews} />
        <FetchedReviewsSection workId={workId} bySource={fetchedReviews} />
      </CardContent>
    </Card>
  )
}
