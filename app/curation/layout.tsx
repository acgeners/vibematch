import type { ReactNode } from "react"
import { CurationConsole } from "@/components/curation/console-shell"

/**
 * O layout de TODA a console de curadoria — a raiz (`/curation`) e os quatro membros
 * (`works`, `settings`, `ai-usage`, `model-metrics`). O gate de Curador e a sidebar de
 * dois níveis vêm da shell; ver `console-shell.tsx`.
 *
 * 🔴 Era um arquivo IDÊNTICO a este em cada uma das cinco rotas, porque elas eram
 * irmãs na raiz do `app/`. Cinco cópias do mesmo gate é a família "dois critérios pro
 * mesmo fato" na sua forma mais barata de errar: rota nova da console nasce sem gate e
 * sem sidebar, renderiza normalmente, e nada acusa. Hoje o aninhamento faz o trabalho —
 * e o `middleware.ts` gateia com UM prefixo em vez de enumerar cinco.
 *
 * ⚠️ `/curation/settings` PERDEU a sub-nav própria em 2026-08-02 (não foi esta mudança):
 * os quatro tópicos viraram o ramo "Configurações" da sidebar da console e continuam
 * sendo `?g=` na mesma rota. `SettingsSubnav`/`SettingsMobileNav` seguem vivas para
 * `/preferences`, que é do USUÁRIO (mora no menu do avatar), nunca entrou nesta console
 * e por isso continua dona da própria camada 2.
 */
export default function CurationLayout({ children }: { children: ReactNode }) {
  return <CurationConsole>{children}</CurationConsole>
}
