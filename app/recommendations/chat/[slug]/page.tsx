import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, MessageCircle } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RecommendationChat } from "@/components/recommendations/recommendation-chat"
import { getChatAction } from "@/server/actions/recommendation-chat"
import { getCurrentPlan } from "@/server/queries/current-user"
import { planAllows, paidOnlyMessage } from "@/lib/plans/capabilities"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function RecommendationChatDetailPage({ params }: PageProps) {
  const { slug } = await params
  const [plan, chat] = await Promise.all([getCurrentPlan(), getChatAction(slug)])
  const isPaid = planAllows(plan, "chat_recommend")

  if (isPaid && !chat) notFound()

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/recommendations/chat"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> nova conversa
        </Link>
      </div>

      <Header
        kicker="IA"
        title={chat?.title ?? "Conversa"}
        description="Continue a conversa pra refinar as recomendações."
        icon={<MessageCircle />}
      />

      {!isPaid ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recurso do plano Pago</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {paidOnlyMessage("chat_recommend")}
          </CardContent>
        </Card>
      ) : (
        <RecommendationChat initialSlug={chat!.slug} initialMessages={chat!.messages} />
      )}
    </div>
  )
}
