import { Suspense } from "react"
import type { ReactNode } from "react"
import {
  SettingsMobileNav,
  SettingsSubnav,
} from "@/components/settings/settings-nav"
import type { SubnavGroup } from "@/components/settings/settings-nav"
import { buildPreferencesGroups, PREFERENCES_DEFAULT_GROUP_ID } from "@/app/preferencias/sections"
import { getCurrentPlan } from "@/server/queries/current-user"

// Layout de /preferencias: navegação em DUAS CAMADAS (mesmo padrão do /settings).
// A camada 1 (menu do site) vem do layout raiz; aqui adicionamos a camada 2
// (sub-nav de tópicos) COLADA na sidebar. Preferências não têm pendências → sem
// badges. Os `md:-m-7` cancelam o padding do <main> pra a sub-nav encostar na borda.
export default async function PreferenciasLayout({ children }: { children: ReactNode }) {
  const plan = await getCurrentPlan()
  const groups: SubnavGroup[] = buildPreferencesGroups(plan).map((g) => ({
    id: g.id,
    label: g.label,
    iconName: g.iconName,
    accent: g.accent,
    itemCount: g.sections.length,
    pending: 0,
  }))
  return (
    <div className="md:-mx-7 md:-my-7 md:flex md:min-h-dvh md:items-stretch">
      <Suspense>
        <SettingsSubnav
          groups={groups}
          defaultGroup={PREFERENCES_DEFAULT_GROUP_ID}
          basePath="/preferencias"
          title="Preferências"
          subtitle="Ajustes pessoais"
          headerIconName="SlidersHorizontal"
        />
      </Suspense>
      <div className="min-w-0 flex-1 md:px-7 md:py-7">
        <Suspense>
          <SettingsMobileNav
            groups={groups}
            defaultGroup={PREFERENCES_DEFAULT_GROUP_ID}
            basePath="/preferencias"
          />
        </Suspense>
        {children}
      </div>
    </div>
  )
}
