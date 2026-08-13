import Link from "next/link"
import { AlertTriangle, ArrowRight, MessageCircle, Radar, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Header } from "@/components/layout/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RecommendDialog } from "@/components/recommendations/recommend-dialog"
import { HistoryTabs } from "@/components/recommendations/history-tabs"
import { RecommendationChat } from "@/components/recommendations/recommendation-chat"
import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { listRecommendationRuns } from "@/server/queries/recommendations"
import { listAllDeepDives } from "@/server/queries/deep-dive"
import { listChatsAction } from "@/server/actions/recommendation-chat"
import { canConsumeAi, getSessionUserId } from "@/server/queries/current-user"
import { deniedMessage } from "@/lib/plans/roles"
import { formatRelativeDateTime } from "@/lib/date-utils"

// Sem `revalidate`: esta página é inteiramente per-user (histórico de rodadas, chats, deep
// dives). Hoje o `force-dynamic` do layout raiz já a torna dinâmica e o `revalidate = 60` que
// morava aqui era inerte — mas deixá-lo escrito é uma mina: quem um dia remover o
// force-dynamic passa a servir o histórico de UMA pessoa em cache para as próximas.
// Ver [[gotcha-force-dynamic-per-user]].

export default async function RecommendationsPage() {
  const [status, runs, canAi, chats, deepDives, sessionUserId] = await Promise.all([
    getTasteProfileStatusAction(),
    listRecommendationRuns(50),
    canConsumeAi(),
    listChatsAction(8),
    listAllDeepDives(100),
    getSessionUserId(),
  ])
  const signedIn = sessionUserId != null

  const canChat = canAi
  const canShortlist = canAi
  const insufficient = status.ratedWorksCount < 5
  const stubBlocks = status.profile?.is_stub ?? false

  // Gate do modo rápido: o plano (`smart_shortlist`) é o selo "Pago" do dialog;
  // o gate de perfil (insuficiente/stub) só vale pra quem já é Pago.
  const profileDisabled = insufficient || stubBlocks
  const profileDisabledReason = insufficient
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
                    {deniedMessage("consume_ai")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              A recomendação por IA — chat e <strong className="text-foreground">Modo rápido</strong> —
              é uma feature do plano Pago. No Free, o{" "}
              <Link href="/ranking" className="font-medium text-foreground underline-offset-2 hover:underline">
                /ranking
              </Link>{" "}
              já ordena seus favoritos por Nota Prevista × alinhamento, de graça.
            </CardContent>
          </Card>
        )}

        {/* Coluna direita: modo rápido + histórico */}
        <div className="space-y-5">
          {/* "Mais como estas" fica ACIMA do modo rápido de propósito: é a única entrada
              aqui que não custa nada e não depende de plano — determinística do começo ao
              fim. Enterrá-la abaixo de duas features pagas esconderia justamente a que
              qualquer pessoa logada pode usar agora. */}
          <Card className="border border-indigo-500/30 bg-indigo-500/5 shadow-sm">
            <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <Radar className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-sm font-bold text-foreground">Mais como estas</h3>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Aponte de 2 a 5 obras e cruze a parecença com elas contra o alinhamento com
                  o seu perfil — dois eixos independentes.
                </p>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                  Sem custo · resultado imediato
                </div>
              </div>
              <Button asChild variant="outline" className="w-full shrink-0 sm:w-auto">
                <Link href="/descobrir">Escolher sementes</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border border-border/80 bg-card/25 shadow-sm">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="font-bold text-sm text-foreground">Modo rápido (sem conversa)</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Escolha o escopo (não-lidos ou todos) e, opcionalmente, um mood — gera um ranking one-shot sem abrir conversa.
                </p>
                <div className="text-[10px] text-muted-foreground/60 font-semibold tracking-wide uppercase">
                  Custo estimado: ~5¢ por execução
                </div>
              </div>
              <div className="shrink-0 w-full sm:w-auto">
                <RecommendDialog
                  context="standalone"
                  size="default"
                  isPaid={canShortlist}
                  disabled={profileDisabled}
                  disabledReason={profileDisabledReason}
                />
              </div>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Histórico
            </h2>
            <HistoryTabs runs={runs} dives={deepDives} signedIn={signedIn} />
          </section>
        </div>
      </div>
    </div>
  )
}
