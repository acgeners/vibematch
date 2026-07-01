import { Suspense } from "react"
import type { ReactNode } from "react"
import { promises as fs } from "node:fs"
import path from "node:path"
import Link from "next/link"
import { ArrowRight, Settings } from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { ScrollToTop } from "@/components/layout/scroll-to-top"
import { ConsoleShell } from "@/components/console/console-shell"
import {
  ConsolePanelSkeleton,
  ConsoleSectionNote,
  ConsoleSectionShell,
} from "@/components/console/console-section"
import { CalibrationPanel } from "@/components/settings/calibration-panel"
import { EmbeddingsPanel } from "@/components/settings/embeddings-panel"
import { SyncConstantsPanel } from "@/components/settings/sync-constants-panel"
import { SynopsisConsolidationPanel } from "@/components/settings/synopsis-consolidation-panel"
import { ReviewSummaryPanel } from "@/components/settings/review-summary-panel"
import { ReviewDigestPanel } from "@/components/settings/review-digest-panel"
import { ResolveComixPanel } from "@/components/settings/resolve-comix-panel"
import { ComixHealthPanel } from "@/components/settings/comix-health-panel"
import { AiEvalOnCreateToggle } from "@/components/settings/ai-eval-on-create-toggle"
import { SynopsisCanonicalOnCreateToggle } from "@/components/settings/synopsis-canonical-on-create-toggle"
import { getCalibrationSnapshot } from "@/server/actions/settings"
import { getComixResolverStatus } from "@/server/actions/comix-resolver"
import { getWorksMissingComixHid } from "@/server/queries/comix-coverage"
import { getAiEvalOnCreate, getSynopsisCanonicalOnCreate } from "@/server/queries/current-user"
import {
  countMissingEmbeddings,
  countPendingCanonicalSynopses,
  countPendingReviewSummaries,
} from "@/server/queries/settings-pending"
import { parseModelEvaluationMetrics } from "@/lib/metrics/model-evaluation"
import type { FormulaConfig } from "@/types/domain"
import { ACCENT_LINK } from "@/lib/settings-accent"
import { findSection, normalizeSectionId, SETTINGS_GROUPS } from "@/app/settings/sections"
import { cn } from "@/lib/utils"

async function getSyncConstantsMtime(): Promise<string | null> {
  // criteria.ts é sempre reescrito por `npm run sync-constants`, então o mtime
  // dele é o melhor proxy pra "último disparo".
  try {
    const stat = await fs.stat(path.join(process.cwd(), "lib/constants/criteria.ts"))
    return stat.mtime.toISOString()
  } catch {
    return null
  }
}

function activeWorksCount() {
  const supabase = createAdminClient()
  return supabase
    .from("works")
    .select("id", { count: "exact", head: true })
    .eq("is_archived", false)
    .then((r) => r.count ?? 0)
}

// Badges do OVERVIEW (barato). Só chamado no modo overview — em modo painel os
// badges nem aparecem, então não pagamos essas 4 contagens à toa. Nada de
// `countStaleEmbeddings` (catálogo + hashing, ~5-16s): usamos a barata
// `countMissingEmbeddings` ("nunca embedada"). A detecção EXATA de stale
// continua no botão "Atualizar" do painel (`refreshEmbeddings`).
async function loadBadges(): Promise<Record<string, number>> {
  const [embeddings, canonicalSynopsis, reviewSummary, comixMissing] = await Promise.all([
    countMissingEmbeddings(),
    countPendingCanonicalSynopses(),
    countPendingReviewSummaries(),
    getWorksMissingComixHid(),
  ])
  return {
    embeddings,
    "synopsis-canonical": canonicalSynopsis,
    "review-summary": reviewSummary,
    comix: comixMissing.length,
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string | string[] }>
}) {
  const sp = await searchParams
  // `explicit` = seleção do usuário via `?s=` (null = overview). Os badges
  // alimentam tanto os cards do overview quanto a tab-strip do painel (sinal de
  // pendência visível ao navegar), então são buscados sempre — são baratos.
  const explicit = normalizeSectionId(sp.s)
  const badges = await loadBadges()

  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Sistema"
        title="Configurações"
        description="Console de operação: jobs do pipeline, curadoria e manutenção"
        icon={<Settings />}
      />

      <ConsoleShell groups={SETTINGS_GROUPS} basePath="/settings" explicit={explicit} badges={badges}>
        {explicit && (
          <Suspense key={explicit} fallback={<ConsolePanelSkeleton section={findSection(explicit)} />}>
            <SettingsPanel section={explicit} />
          </Suspense>
        )}
      </ConsoleShell>

      <ScrollToTop />
    </div>
  )
}

// ── Switch de painéis (server) — renderiza SÓ o painel ativo ─────────────────
// É aqui que o lazy acontece: só o client component do case selecionado entra na
// árvore RSC, então só o chunk dele é enviado ao browser; e só os dados desse
// painel são buscados.
async function SettingsPanel({ section }: { section: string }) {
  switch (section) {
    case "calibration": {
      const supabase = createAdminClient()
      const [configRes, snapshot, embeddings, canonicalSynopsis, reviewSummary] = await Promise.all([
        supabase
          .from("formula_config")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(1),
        getCalibrationSnapshot(),
        countMissingEmbeddings(),
        countPendingCanonicalSynopses(),
        countPendingReviewSummaries(),
      ])
      if (configRes.error) throw new Error(configRes.error.message)
      const config = configRes.data?.[0] as FormulaConfig | undefined
      if (!config) throw new Error("formula_config não encontrado")

      // F4: métricas de erro honestas, validadas por Zod no boundary do servidor.
      // crossValidationMae é gated por stub (mesma regra antiga da headline).
      const modelMetrics = parseModelEvaluationMetrics({
        trainMae: config.mae_expected,
        crossValidationMae: snapshot.expectedPredictorIsStub
          ? null
          : config.cv_mae_expected_stage1,
        prospectiveMae: null,
        baselineMae: snapshot.baselineMae,
        sampleSize: snapshot.trainSize,
        foldCount: null,
        evaluatedAt: config.last_recalculated_at,
        prospectiveSampleSize: null,
        prospectiveEvaluatedAt: null,
      })

      return (
        <SectionShell id="calibration">
          <div className="space-y-4">
            <ConsoleSectionNote accent="violet">
              A calibração usa o kNN dos{" "}
              <Link href="/settings?s=embeddings" className="font-medium text-foreground underline-offset-2 hover:underline">
                Embeddings
              </Link>{" "}
              — atualize-os (Passo 1, grupo &ldquo;Gerado por IA&rdquo;) antes de recalibrar (Passo 2).
            </ConsoleSectionNote>
            <CalibrationPanel
              config={config}
              metrics={modelMetrics}
              snapshot={snapshot}
              accent="violet"
              aiPending={[
                { label: "Embeddings", count: embeddings, href: "/settings?s=embeddings" },
                {
                  label: "Sinopse canônica",
                  count: canonicalSynopsis,
                  href: "/settings?s=synopsis-canonical",
                },
                {
                  label: "Resumo de reviews",
                  count: reviewSummary,
                  href: "/settings?s=review-summary",
                },
              ]}
            />
          </div>
        </SectionShell>
      )
    }

    case "ai-calibration":
      return (
        <SectionShell id="ai-calibration">
          <SectionNav id="ai-calibration" />
        </SectionShell>
      )

    case "embeddings": {
      const supabase = createAdminClient()
      const [embeddingsCount, worksCount, lastRunRes, pendingCount] = await Promise.all([
        supabase
          .from("work_embeddings")
          .select("work_id", { count: "exact", head: true })
          .then((r) => r.count ?? 0),
        activeWorksCount(),
        supabase
          .from("work_embeddings")
          .select("updated_at")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        countMissingEmbeddings(),
      ])
      return (
        <SectionShell id="embeddings">
          <EmbeddingsPanel
            accent="cyan"
            initialCachedCount={embeddingsCount}
            initialPendingCount={pendingCount}
            totalWorks={worksCount}
            initialLastRun={(lastRunRes.data?.updated_at as string | undefined) ?? null}
          />
        </SectionShell>
      )
    }

    case "synopsis-canonical": {
      const [worksCount, pendingCount] = await Promise.all([
        activeWorksCount(),
        countPendingCanonicalSynopses(),
      ])
      return (
        <SectionShell id="synopsis-canonical">
          <SynopsisConsolidationPanel
            accent="cyan"
            pendingCount={pendingCount}
            totalCount={worksCount}
          />
        </SectionShell>
      )
    }

    case "review-summary": {
      const [worksCount, pendingCount] = await Promise.all([
        activeWorksCount(),
        countPendingReviewSummaries(),
      ])
      return (
        <SectionShell id="review-summary">
          <ReviewSummaryPanel accent="cyan" pendingCount={pendingCount} totalCount={worksCount} />
        </SectionShell>
      )
    }

    case "review-digest":
      return (
        <SectionShell id="review-digest">
          <ReviewDigestPanel accent="cyan" />
        </SectionShell>
      )

    case "on-create": {
      const [aiEvalOnCreate, synopsisCanonicalOnCreate] = await Promise.all([
        getAiEvalOnCreate(),
        getSynopsisCanonicalOnCreate(),
      ])
      return (
        <SectionShell id="on-create">
          <div className="divide-y divide-border/60">
            <div className="pb-4">
              <p className="mb-1.5 text-sm font-semibold text-foreground">Avaliação IA</p>
              <AiEvalOnCreateToggle initialEnabled={aiEvalOnCreate} />
            </div>
            <div className="pt-4">
              <p className="mb-1.5 text-sm font-semibold text-foreground">Sinopse canônica</p>
              <SynopsisCanonicalOnCreateToggle initialEnabled={synopsisCanonicalOnCreate} />
            </div>
          </div>
        </SectionShell>
      )
    }

    case "comix": {
      const [comixStatus, comixMissing] = await Promise.all([
        getComixResolverStatus(),
        getWorksMissingComixHid(),
      ])
      return (
        <SectionShell id="comix">
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Cobertura</p>
              <ResolveComixPanel accent="amber" initialStatus={comixStatus} initialMissing={comixMissing} />
            </div>
            <div className="border-t border-border/60 pt-4">
              <p className="mb-2 text-sm font-semibold text-foreground">Diagnóstico</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Testa se as chamadas pra Comix estão funcionando (FlareSolverr, detalhe, reviews,
                imagem) sem precisar abrir uma obra.
              </p>
              <ComixHealthPanel accent="amber" />
            </div>
          </div>
        </SectionShell>
      )
    }

    case "tags":
      return (
        <SectionShell id="tags">
          <SectionNav id="tags" />
        </SectionShell>
      )

    case "sync": {
      const syncConstantsLastRun = await getSyncConstantsMtime()
      return (
        <SectionShell id="sync">
          <SyncConstantsPanel initialLastRun={syncConstantsLastRun} accent="slate" />
        </SectionShell>
      )
    }

    default:
      return null
  }
}

// ── Cabeçalho + moldura do painel ativo (reusa a metadata do registry) ───────
// Moldura do painel: resolve a metadata pelo id e delega ao shell compartilhado.
function SectionShell({ id, children }: { id: string; children: ReactNode }) {
  const section = findSection(id)
  if (!section) return null
  return <ConsoleSectionShell section={section}>{children}</ConsoleSectionShell>
}

function SectionNav({ id }: { id: string }) {
  const section = findSection(id)
  if (!section?.nav) return null
  return (
    <a
      href={section.nav.href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        ACCENT_LINK[section.accent]
      )}
    >
      {section.nav.label}
      <ArrowRight className="h-3.5 w-3.5" />
    </a>
  )
}
