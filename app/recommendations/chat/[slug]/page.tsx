import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, MessageCircle } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RecommendationChat } from "@/components/recommendations/recommendation-chat"
import { getChatAction } from "@/server/actions/recommendation-chat"
import { canConsumeAi } from "@/server/queries/current-user"
import { deniedMessage } from "@/lib/plans/roles"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ slug: string }>
}

// Estático pelo mesmo motivo da rodada: o título da conversa só vem com `getChatAction`, que
// traz o array JSONB de mensagens inteiro.
export const metadata = { title: "Conversa" }

export default async function RecommendationChatDetailPage({ params }: PageProps) {
  const { slug } = await params
  const [canAi, chat] = await Promise.all([canConsumeAi(), getChatAction(slug)])
  const isPaid = canAi

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
            {deniedMessage("consume_ai")}
          </CardContent>
        </Card>
      ) : (
        <RecommendationChat initialSlug={chat!.slug} initialMessages={chat!.messages} />
      )}
    </div>
  )
}
