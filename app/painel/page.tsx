import Link from "next/link"
import { Coins, Gauge, Upload, Sparkles, Plus } from "lucide-react"
import { getDashboardStats, getAiQueueCounts } from "@/server/queries/dashboard"
import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { getPredictionHealth } from "@/server/queries/calibration-guards"
import { getAiUsageTotals } from "@/server/queries/ai-usage"
import { StatCard } from "@/components/dashboard/stat-card"
import { AiQueueCard } from "@/components/dashboard/ai-queue-card"
import { StatusDistribution } from "@/components/dashboard/status-distribution"
import { ProfileSummary } from "@/components/dashboard/profile-summary"
import { HealthStrip } from "@/components/dashboard/health-strip"
import { Header } from "@/components/layout/header"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Painel — SatorIA" }

/**
 * O painel — a saúde da biblioteca e do sistema.
 *
 * Era a home até 2026-08-02. Ao mover, o arquivo veio inteiro e passou a duplicar a vitrine:
 * os mesmos quatro contadores de atividade, o mesmo "Continue lendo" e a mesma lista de
 * melhores previstas, todos servidos das mesmas queries em duas telas. Era essa duplicação —
 * não a divisão — que tornava impossível dizer para que serve cada página.
 *
 * A régua ficou: **a home responde "o que eu leio agora"; o painel responde "como está a
 * minha biblioteca e o sistema"**. O que a vitrine já mostra saiu daqui:
 *
 *   - os 4 StatCards de atividade  → faixa da home
 *   - ContinueReading              → hero da home
 *   - "Pra ler agora"              → prateleira "Pra você hoje"
 *
 * Fica o que a home deliberadamente não carrega: a forma da biblioteca (distribuição por
 * status), o perfil de gosto, o custo de IA, a fila de manutenção e a telemetria de saúde.
 */
export default async function PainelPage() {
  const [stats, queueCounts, profileStatus, health, usage] = await Promise.all([
    getDashboardStats(),
    getAiQueueCounts(),
    getTasteProfileStatusAction(),
    getPredictionHealth(),
    getAiUsageTotals(),
  ])

  return (
    <div className="space-y-6">
      <Header
        kicker="Painel"
        title="Sua biblioteca em números"
        description={`${stats.totalWorks} obras no catálogo · ${stats.rated} avaliadas por você`}
        icon={<Gauge />}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/import">
                <Upload className="size-4" />
                <span className="hidden sm:inline">Importar</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/ai-evaluation">
                <Sparkles className="size-4" />
                <span className="hidden sm:inline">Avaliar</span>
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/titles/new">
                <Plus className="size-4" />
                Novo título
              </Link>
            </Button>
          </>
        }
      />

      {/* Custo é o único número de OPERAÇÃO que sobrou em cartão: não descreve a leitura de
          ninguém, então não cabe na faixa da home. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          title="Custo IA (30d)"
          value={`$${usage.last30d.totalCostUsd.toFixed(2)}`}
          icon={<Coins />}
          href="/ai-usage"
          description={`$${usage.last7d.totalCostUsd.toFixed(2)} nos últimos 7 dias`}
          accent="slate"
        />
        <ProfileSummary status={profileStatus} />
      </div>

      {/* A forma da biblioteca — o que a vitrine não mostra por não caber numa prateleira. */}
      <StatusDistribution
        byPersonalStatus={stats.byPersonalStatus}
        byPublicationStatus={stats.byPublicationStatus}
      />

      <AiQueueCard
        attributes={stats.pendingAi}
        iaRk={queueCounts.iaRk}
        synopsis={queueCounts.synopsis}
      />

      <HealthStrip health={health} />
    </div>
  )
}
