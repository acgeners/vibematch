import { MessageSquareText } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExternalManualReviewsSection } from "@/components/titles/external-manual-reviews-section"
import type { ExternalManualReviewDisplayRow } from "@/server/queries/external-manual-reviews"

interface Props {
  workId: string
  /** Gate local aberto? O canal de review manual (externas) é local/dev. */
  externalEditorEnabled: boolean
  externalReviews: ExternalManualReviewDisplayRow[]
}

/**
 * Card "Reviews" da página de edição (Plano 3 B2.2N). Canal ÚNICO de review manual:
 * reviews EXTERNAS adicionadas à mão (`work_external_reviews_manual`) — usadas como
 * fallback quando a busca automática acha poucas/nenhuma. Alimentam tanto o corpus do
 * digest quanto a AVALIAÇÃO IA (sem opinião/nota pessoal). Só aparece com o gate local
 * aberto; em produção (sem auth) o canal manual não fica editável.
 */
export function ReviewsEditor({ workId, externalEditorEnabled, externalReviews }: Props) {
  if (!externalEditorEnabled) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Reviews</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ExternalManualReviewsSection workId={workId} reviews={externalReviews} />
      </CardContent>
    </Card>
  )
}
