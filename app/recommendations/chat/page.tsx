import Link from "next/link"
import { ArrowLeft, MessageCircle } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RecommendationChat } from "@/components/recommendations/recommendation-chat"
import { listChatsAction } from "@/server/actions/recommendation-chat"
import { canConsumeAi } from "@/server/queries/current-user"
import { deniedMessage } from "@/lib/plans/roles"
import { formatRelativeDateTime } from "@/lib/date-utils"

export const dynamic = "force-dynamic"

export default async function RecommendationChatPage() {
  const canAi = await canConsumeAi()
  const isPaid = canAi

  return (
    <div className="w-full space-y-4">
      <div>
        <Link
          href="/recommendations"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> voltar pra recomendações
        </Link>
      </div>

      <Header
        kicker="IA"
        title="Conversar com a IA"
        description="Bate um papo sobre o que você tá a fim de ler e receba recomendações do seu catálogo."
        icon={<MessageCircle />}
      />

      {!isPaid ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recurso do plano Pago</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{deniedMessage("consume_ai")}</p>
            <p>
              No plano Free você ainda pode usar o formulário{" "}
              <Link href="/recommendations" className="underline hover:text-foreground">
                Recomendar com IA
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <RecommendationChat />
          <RecentChats />
        </>
      )}
    </div>
  )
}

async function RecentChats() {
  const chats = await listChatsAction(10)
  if (chats.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Conversas recentes
      </h2>
      <div className="flex flex-wrap gap-2">
        {chats.map((c) => (
          <Link
            key={c.slug}
            href={`/recommendations/chat/${c.slug}`}
            className="max-w-xs truncate rounded-md border bg-card/40 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-card/70 hover:text-foreground"
            title={c.title ?? c.slug}
          >
            {c.title ?? c.slug}
            <span className="ml-1.5 text-[11px] opacity-70">· {formatRelativeDateTime(c.updatedAt)}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
