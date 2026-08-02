import Link from "next/link"
import { ArrowRight } from "lucide-react"
import {
  getDashboardStats,
  getContinueReading,
  getTopUnratedByExpected,
} from "@/server/queries/dashboard"
import { getScoreColorThresholds } from "@/server/queries/score-thresholds"
import { getCurrentUserProfile, getSessionUserId } from "@/server/queries/current-user"
import { getPublicShowcase, getSpotlightWork } from "@/server/queries/public-showcase"
import { getSiteStats } from "@/server/queries/auth-hero"
import { PublicHome } from "@/components/home/public-home"
import { getFirstStepsProgress } from "@/server/queries/onboarding-progress"
import { FirstStepsCard } from "@/components/dashboard/first-steps-card"
import { DashboardGreeting } from "@/components/dashboard/dashboard-greeting"
import { ActivityStrip } from "@/components/home/activity-strip"
import { ContinueHero } from "@/components/home/continue-hero"
import { WorkShelf } from "@/components/home/work-shelf"
import { DEFAULT_PERSONAL_STATUS } from "@/lib/constants/criteria"

/**
 * A home — a VITRINE.
 *
 * Até 2026-08-02 esta rota era o painel de KPIs (fila de IA, custo de API, saúde das fontes).
 * Os números não sumiram: mudaram de endereço para `/painel`. A troca é de primeira tela — o
 * produto é o catálogo, e era o catálogo que não aparecia até rolar meio dashboard.
 *
 * As prateleiras saem do modelo de quem olha, não de popularidade: o SatorIA não tem sinal
 * social para sustentar um "em alta", e inventar um a partir da média das plataformas seria
 * vender nota externa como se fosse curadoria. Quem não tem sessão nem modelo continua vendo
 * o que é fato da obra — ver `getScoresReader`, que zera os campos pessoais nesse caso.
 */
export default async function HomePage() {
  // Sem sessão a página é OUTRA, não a mesma com menos coisa. "Continue lendo" e "Pra você
  // hoje" dependem de estado e de modelo — sem usuário os dois voltam vazios (correto desde o
  // fix do eixo público), e o resultado seria uma vitrine de esqueletos. A versão pública
  // mostra o que é fato da obra e convida a criar conta.
  const sessionId = await getSessionUserId()
  if (!sessionId) {
    const [works, siteStats, spotlight] = await Promise.all([
      getPublicShowcase(12),
      getSiteStats(),
      getSpotlightWork(),
    ])
    return <PublicHome works={works} stats={siteStats} spotlight={spotlight} />
  }

  const [stats, thresholds, continueReading, topPicks, profile, firstSteps] = await Promise.all([
    getDashboardStats(),
    getScoreColorThresholds(),
    // Alto de propósito: `getContinueReading` ordena por última LEITURA e corta no limite, e
    // o hero escolhe pela banda de ritmo + capítulo mais novo. Com o padrão (6), a obra que
    // acabou de receber capítulo ficava fora do corte antes de a seleção rodar — foi
    // exatamente isso que colocou uma obra sem `last_chapter_released_at` no destaque. A
    // query já carrega todas as obras acompanhadas e filtra em memória, então subir o limite
    // não custa ida a mais ao banco.
    getContinueReading(60),
    getTopUnratedByExpected(12),
    getCurrentUserProfile(),
    getFirstStepsProgress(),
  ])

  const firstName = profile.displayName?.trim().split(/\s+/)[0]
  const wantToRead = stats.byPersonalStatus[DEFAULT_PERSONAL_STATUS] ?? 0

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            <DashboardGreeting firstName={firstName} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.followingWithPending > 0
              ? `${stats.followingWithPending} ${stats.followingWithPending === 1 ? "obra que você acompanha tem" : "das obras que você acompanha têm"} capítulo novo`
              : "Nenhuma obra acompanhada com capítulo novo"}
          </p>
        </div>
      </header>

      {/* Ponte do onboarding: fica até a conta sair do estado inicial, some sozinha. */}
      {firstSteps && !firstSteps.complete && <FirstStepsCard progress={firstSteps} />}

      <ActivityStrip
        items={[
          {
            value: stats.followingWithPending,
            label: "com capítulo novo",
            href: "/leitura",
            accent: stats.followingWithPending > 0,
          },
          { value: stats.following, label: "em leitura", href: "/leitura" },
          { value: wantToRead, label: "quero ler", href: "/titles" },
          { value: stats.rated, label: "avaliadas por você", href: "/titles" },
        ]}
      />

      <ContinueHero
        items={continueReading}
        following={stats.following}
        thresholds={thresholds?.expected ?? null}
      />

      <WorkShelf
        title="Pra você hoje"
        why="as maiores Notas Previstas que você ainda não leu"
        works={topPicks}
        thresholds={thresholds?.expected ?? null}
        moreHref="/ranking"
        moreLabel="Ver ranking"
      />

      {topPicks.length === 0 && (
        <section className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-card/40 p-6">
          <p className="text-sm font-semibold">Ainda não dá para prever seu gosto</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            A Nota Prevista precisa de obras que você já leu e avaliou. Enquanto não houver
            rótulos suficientes, o catálogo aparece pela nota da comunidade — que é um fato,
            não um palpite.
          </p>
          <Link
            href="/titles"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            Avaliar o que já li
            <ArrowRight className="size-3.5" />
          </Link>
        </section>
      )}
    </div>
  )
}
