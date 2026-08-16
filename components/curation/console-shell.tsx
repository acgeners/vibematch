import { Suspense } from "react"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"
import { SETTINGS_GROUPS, DEFAULT_GROUP_ID } from "@/app/curation/settings/sections"
import { ConsoleNav, ConsoleMobileNav } from "@/components/curation/console-nav"
import type { ConsoleSettingsGroup } from "@/components/curation/console-nav"
import { isCurrentUserAdmin } from "@/server/queries/current-user"

/**
 * A shell da console `/curation` — o layout compartilhado das rotas do Curador
 * (`/curation`, `/curation/works`, `/curation/settings`, `/curation/ai-usage`, `/curation/model-metrics`).
 *
 * ## O gate aqui é a SEGUNDA linha — a primeira está no proxy
 *
 * Quem barra de verdade é `middleware.ts`, que roda ANTES de qualquer renderização.
 * Um `notFound()` só aqui não basta: o Next renderiza layout e página em PARALELO, e
 * o `notFound()` chega depois de o stream ter começado — medido em dev, `GET /curation/settings`
 * anônimo devolvia **200** com o HTML da página protegida no corpo. Status errado e
 * vazamento do markup que se queria esconder.
 *
 * Esta checagem sobrevive por dois motivos concretos:
 *   1. o matcher do proxy pode mudar e deixar uma rota de fora — aqui ela não renderiza;
 *   2. o proxy é fail-OPEN no caso ambíguo (logado sem linha em `user_settings`), e é
 *      `isCurrentUserAdmin()` — com o fallback legado que precisa de service role — quem
 *      resolve esse caso.
 *
 * `notFound()` e não uma tela de "sem permissão": a existência das ferramentas de
 * curadoria não é informação que um leitor precise ter.
 *
 * ⚠️ Isto gateia APENAS estas rotas. A matriz de acesso do app inteiro (`/import`,
 * `/dashboard`, `/account`…) continua em aberto — ver o plano do redesenho de navegação.
 *
 * ⚠️ `isCurrentUserAdmin()` e não `getCurrentRole() === "curador"`: é o MESMO predicado
 * do `useIsAdmin()` que decide mostrar o ícone 🛠 na barra — se os dois divergissem,
 * existiria um botão visível levando a um 404.
 */
export async function CurationConsole({ children }: { children: ReactNode }) {
  if (!(await isCurrentUserAdmin())) notFound()

  // Só o que a sidebar precisa: o registry inteiro carrega os textos de `help` de
  // cada seção, que não têm por que cruzar pro bundle do client.
  const groups: ConsoleSettingsGroup[] = SETTINGS_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    iconName: g.iconName,
    accent: g.accent,
  }))

  // Os `md:-m-7` cancelam o padding do <main> pra a sidebar encostar na borda e
  // ocupar a altura toda; o conteúdo reganha o padding. Mesmo truque que o layout
  // de /curation/settings usava antes de delegar pra cá.
  return (
    <div className="md:-mx-7 md:-my-7 md:flex md:min-h-dvh md:items-stretch">
      <Suspense>
        <ConsoleNav settingsGroups={groups} defaultSettingsGroup={DEFAULT_GROUP_ID} />
      </Suspense>
      <div className="min-w-0 flex-1 md:px-7 md:py-7">
        <Suspense>
          <ConsoleMobileNav settingsGroups={groups} defaultSettingsGroup={DEFAULT_GROUP_ID} />
        </Suspense>
        {children}
      </div>
    </div>
  )
}
