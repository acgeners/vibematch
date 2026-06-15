import Link from "next/link"
import { AlertTriangle, ArrowRight, MessageCircle, Sparkles } from "lucide-react"
import { Header } from "@/components/layout/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { RunCreatorForm } from "@/components/recommendations/run-creator-form"
import { RunHistoryList } from "@/components/recommendations/run-history-list"
import { RecommendationChat } from "@/components/recommendations/recommendation-chat"
import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { listRecommendationRuns } from "@/server/queries/recommendations"
import { listChatsAction } from "@/server/actions/recommendation-chat"
import { getCurrentPlan } from "@/server/queries/current-user"
import { planAllows, paidOnlyMessage } from "@/lib/plans/capabilities"
import { formatRelativeDateTime } from "@/lib/date-utils"

export const revalidate = 60

export default async function RecommendationsPage() {
  const [status, runs, plan, chats] = await Promise.all([
    getTasteProfileStatusAction(),
    listRecommendationRuns(50),
    getCurrentPlan(),
    listChatsAction(8),
  ])

  const canChat = planAllows(plan, "chat_recommend")
  const canShortlist = planAllows(plan, "smart_shortlist")
  const insufficient = status.ratedWorksCount < 5
  const stubBlocks = status.profile?.is_stub ?? false

  // Gate do form de modo rápido (plano tem prioridade — é o gate de produto).
  const formDisabled = !canShortlist || insufficient || stubBlocks
  const formDisabledReason = !canShortlist
    ? paidOnlyMessage("smart_shortlist")
    : insufficient
      ? "Avalie pelo menos 5 obras com user_score pra desbloquear o ranking."
      : stubBlocks
        ? "Perfil ainda em modo stub — avalie mais obras pra desbloquear o ranking."
        : null

  // O chat usa o mesmo ranker; avisa antes do usuário tentar e tomar erro.
  const profileGate = insufficient
    ? "Avalie pelo menos 5 obras com user_score pra eu conseguir recomendar."
    : stubBlocks
      ? "Seu perfil ainda está em modo stub — avalie mais obras pra liberar recomendações melhores."
      : null

  return (
    <div className="w-full space-y-6">
      <Header
        kicker="IA"
        title="Recomendações"
        description="Converse com a IA pra encontrar sua próxima leitura. Cada recomendação fica salva no histórico abaixo."
        icon={<Sparkles />}
        actions={
          <Link
            href="/conta/perfil"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
          >
            Perfil de gosto
            <ArrowRight className="h-3 w-3" />
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        {/* Coluna esquerda: o chat é o core da página */}
        {canChat ? (
          <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
            {profileGate && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{profileGate}</span>
              </div>
            )}
            <RecommendationChat />
            {chats.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Conversas recentes:
                </span>
                {chats.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/recommendations/chat/${c.slug}`}
                    className="max-w-[14rem] truncate rounded-full border bg-card/40 px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-card/70 hover:text-foreground"
                    title={c.title ?? c.slug}
                  >
                    {c.title ?? c.slug}
                    <span className="ml-1.5 text-[11px] opacity-70">
                      · {formatRelativeDateTime(c.updatedAt)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Card className="lg:sticky lg:top-4 lg:self-start">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <MessageCircle className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">Conversar com a IA</CardTitle>
                  <CardDescription className="text-xs">
                    {paidOnlyMessage("chat_recommend")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              No plano Free você usa o <strong className="text-foreground">Modo rápido</strong> ao
              lado pra gerar recomendações one-shot dos seus favoritos.
            </CardContent>
          </Card>
        )}

        {/* Coluna direita: modo rápido + histórico */}
        <div className="space-y-4">
          <CollapsibleCard
            title="Modo rápido (sem conversa)"
            description="Ranking one-shot dos seus favoritos. ~$0.05 por execução."
            defaultOpen={!canChat}
          >
            <RunCreatorForm disabled={formDisabled} disabledReason={formDisabledReason} />
          </CollapsibleCard>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Histórico
              </h2>
              <span className="text-xs text-muted-foreground">{runs.length} salva(s)</span>
            </div>
            <RunHistoryList runs={runs} />
          </section>
        </div>
      </div>
    </div>
  )
}
