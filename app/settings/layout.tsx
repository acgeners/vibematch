import { Suspense } from "react"
import type { ReactNode } from "react"
import { SETTINGS_GROUPS, DEFAULT_GROUP_ID } from "@/app/settings/sections"
import {
  SettingsMobileNav,
  SettingsSubnav,
} from "@/components/settings/settings-nav"
import type { SubnavGroup } from "@/components/settings/settings-nav"
import {
  countMissingEmbeddings,
  countPendingCanonicalSynopses,
  countPendingReviewSummaries,
} from "@/server/queries/settings-pending"
import { getWorksMissingComixHid } from "@/server/queries/comix-coverage"
import { countPendingSuggestions } from "@/server/queries/calibration"

// Pendências por GRUPO (badge na sub-nav). Contagens baratas, buscadas em
// paralelo. O grupo "Avançado" não tem pendência acionável → 0.
async function loadGroupPending(): Promise<Record<string, number>> {
  const [embeddings, synopsis, reviewSummary, comixMissing, aiCalibration] = await Promise.all([
    countMissingEmbeddings(),
    countPendingCanonicalSynopses(),
    countPendingReviewSummaries(),
    getWorksMissingComixHid(),
    countPendingSuggestions(),
  ])
  return {
    notas: aiCalibration,
    ia: embeddings + synopsis + reviewSummary,
    fontes: comixMissing.length,
    avancado: 0,
  }
}

// Layout da área /settings: navegação em DUAS CAMADAS. A camada 1 (menu do site)
// vem do layout raiz; aqui adicionamos a camada 2 (sub-nav de tópicos) COLADA na
// sidebar. Os `md:-m-7` cancelam o padding do <main> pra a sub-nav encostar na
// borda e ocupar a altura toda; o conteúdo reganha o padding.
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const pending = await loadGroupPending()

  const groups: SubnavGroup[] = SETTINGS_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    accent: g.accent,
    itemCount: g.sections.length,
    pending: pending[g.id] ?? 0,
  }))
  return (
    <div className="md:-mx-7 md:-my-7 md:flex md:min-h-dvh md:items-stretch">
      <Suspense>
        <SettingsSubnav groups={groups} defaultGroup={DEFAULT_GROUP_ID} />
      </Suspense>
      <div className="min-w-0 flex-1 md:px-7 md:py-7">
        <Suspense>
          <SettingsMobileNav groups={groups} defaultGroup={DEFAULT_GROUP_ID} />
        </Suspense>
        {children}
      </div>
    </div>
  )
}
