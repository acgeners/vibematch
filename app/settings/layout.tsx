import type { ReactNode } from "react"
import { CuradoriaConsole } from "@/components/curadoria/console-shell"

/**
 * /settings entrou na console de curadoria — e por isso PERDEU a sub-nav própria.
 *
 * Até 2026-08-02 este layout montava a `SettingsSubnav` (a lista dos quatro tópicos)
 * como camada 2. Com a console, essa lista virou o ramo "Configurações" da sidebar
 * dela; manter as duas daria duas sidebars lado a lado, cada uma reivindicando ser
 * a camada 2. Nada se perdeu: os tópicos continuam sendo `?g=` na mesma rota, com os
 * mesmos badges de pendência — só mudaram de lugar.
 *
 * `SettingsSubnav`/`SettingsMobileNav` seguem existindo: `/preferencias` usa. Ela é
 * do USUÁRIO (mora no menu do avatar) e nunca entrou nesta console, então continua
 * sendo dona da própria camada 2.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <CuradoriaConsole>{children}</CuradoriaConsole>
}
