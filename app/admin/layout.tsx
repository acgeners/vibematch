import type { ReactNode } from "react"
import { CuradoriaConsole } from "@/components/curadoria/console-shell"

// Cobre TODA rota sob /admin (hoje só `model-metrics`) — o gate vale para as futuras
// sem que ninguém precise lembrar de aplicá-lo. Ver console-shell.tsx.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <CuradoriaConsole>{children}</CuradoriaConsole>
}
