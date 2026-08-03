import type { ReactNode } from "react"
import { CuradoriaConsole } from "@/components/curadoria/console-shell"

// A raiz da console. O gate e a sidebar vêm da shell. Ver console-shell.tsx.
export default function CuradoriaLayout({ children }: { children: ReactNode }) {
  return <CuradoriaConsole>{children}</CuradoriaConsole>
}
