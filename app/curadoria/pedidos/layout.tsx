import type { ReactNode } from "react"
import { CuradoriaConsole } from "@/components/curadoria/console-shell"

// Entra na console de curadoria (sidebar + gate de Curador). Ver console-shell.tsx.
export default function PedidosLayout({ children }: { children: ReactNode }) {
  return <CuradoriaConsole>{children}</CuradoriaConsole>
}
