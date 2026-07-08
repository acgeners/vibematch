import { Suspense } from "react"
import type { ReactNode } from "react"
import { SETTINGS_GROUPS, DEFAULT_GROUP_ID } from "@/app/settings/sections"
import {
  SettingsMobileNav,
  SettingsSubnav,
} from "@/components/settings/settings-nav"
import type { SubnavGroup } from "@/components/settings/settings-nav"
import { getSettingsItemUnread } from "@/server/queries/settings-read"

// NÃO-LIDO por GRUPO (badge na sub-nav) = soma do não-lido dos itens do grupo.
// Fonte única `getSettingsItemUnread` (mesmas contagens da page e do badge da
// sidebar, já descontando os "lidos"). "Avançado" não tem item com pendência → 0.
async function loadGroupPending(): Promise<Record<string, number>> {
  const itemUnread = await getSettingsItemUnread()
  return Object.fromEntries(
    SETTINGS_GROUPS.map((g) => [
      g.id,
      g.sections.reduce((sum, s) => sum + (itemUnread[s.id] ?? 0), 0),
    ]),
  )
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
    iconName: g.iconName,
    accent: g.accent,
    itemCount: g.sections.length,
    pending: pending[g.id] ?? 0,
  }))
  return (
    <div className="md:-mx-7 md:-my-7 md:flex md:min-h-dvh md:items-stretch">
      <Suspense>
        <SettingsSubnav
          groups={groups}
          defaultGroup={DEFAULT_GROUP_ID}
          basePath="/settings"
          title="Configurações"
          subtitle="Console de operação"
          headerIconName="Settings"
        />
      </Suspense>
      <div className="min-w-0 flex-1 md:px-7 md:py-7">
        <Suspense>
          <SettingsMobileNav groups={groups} defaultGroup={DEFAULT_GROUP_ID} basePath="/settings" />
        </Suspense>
        {children}
      </div>
    </div>
  )
}
