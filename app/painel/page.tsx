import Link from "next/link"
import { Gauge, Upload, Plus } from "lucide-react"
import { getDashboardStats, getAiQueueCounts } from "@/server/queries/dashboard"
import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { isCurrentUserAdmin } from "@/server/queries/current-user"
import { AiQueueCard } from "@/components/dashboard/ai-queue-card"
import { StatusDistribution } from "@/components/dashboard/status-distribution"
import { ProfileSummary } from "@/components/dashboard/profile-summary"
import { Header } from "@/components/layout/header"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Painel — SatorIA" }

/**
 * O painel — **a SUA biblioteca**. Tudo aqui é de quem olha; nada é do catálogo.
 *
 * Era a home até 2026-08-02, e veio inteiro. A régua da divisão ficou: **a home responde "o
 * que eu leio agora"; o painel responde "como está a minha biblioteca"**. O que a vitrine já
 * mostrava saiu na mudança (os 4 contadores de atividade → faixa da home; ContinueReading →
 * hero; "Pra ler agora" → prateleira "Pra você hoje").
 *
 * ## A poda de 2026-08-03 — o que saiu, e por quê
 *
 * A console `/curadoria` assumiu o que é do CATÁLOGO, e o que tinha ficado aqui virou
 * duplicata. Três blocos saíram, cada um por um motivo que não é só arrumação:
 *
 *   - **Custo IA (30d)** → `/ai-usage`. `getAiUsageTotals()` **não filtra por usuário**: lia
 *     a `ai_api_calls` inteira e mostrava o gasto do DONO para qualquer pessoa logada. Era
 *     exposição, e ainda um full-table read numa página que todo mundo abre.
 *   - **"Saúde da previsão"** (`HealthStrip`) → a Visão geral da console. Telemetria do
 *     modelo/catálogo, não da sua leitura — e custava 4 queries de guarda por carga.
 *   - **Fila "Atributos"** do card de pendências → `/ai-evaluation`. Curadoria do catálogo.
 *     As outras duas filas ficaram: são as SUAS (`/fila-recomendacao`).
 *
 * As três eram links para rotas que o gate da console passou a barrar — para um Leitor viravam
 * botões que quicam de volta para `/`. Sumir com eles é o que corrige isso.
 *
 * Sobrou o que só esta página responde: a forma da biblioteca, o perfil de gosto e as filas
 * pessoais. Se um dia isso também couber em `/leitura` e `/conta/perfil`, o painel deixa de
 * ter razão de existir — a poda tornou essa pergunta respondível, não a respondeu.
 */
export default async function PainelPage() {
  const [stats, queueCounts, profileStatus, canCurate] = await Promise.all([
    getDashboardStats(),
    getAiQueueCounts(),
    getTasteProfileStatusAction(),
    isCurrentUserAdmin(),
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
            {/* Criar obra escreve no catálogo COMPARTILHADO (`curate_work`). Mostrar o botão
                a quem não pode entrega um formulário que só falha no salvar. */}
            {canCurate && (
              <Button asChild size="sm">
                <Link href="/titles/new">
                  <Plus className="size-4" />
                  Novo título
                </Link>
              </Button>
            )}
          </>
        }
      />

      <ProfileSummary status={profileStatus} />

      {/* A forma da biblioteca — o que a vitrine não mostra por não caber numa prateleira. */}
      <StatusDistribution
        byPersonalStatus={stats.byPersonalStatus}
        byPublicationStatus={stats.byPublicationStatus}
      />

      <AiQueueCard iaRk={queueCounts.iaRk} synopsis={queueCounts.synopsis} />
    </div>
  )
}
