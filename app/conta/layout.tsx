import type { ReactNode } from "react"
import { UserCircle } from "lucide-react"
import { Header } from "@/components/layout/header"
import { ContaTabs } from "@/components/conta/conta-tabs"

export default function ContaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-6xl space-y-4">
      <Header
        kicker="Você"
        title="Minha conta"
        description="Sua identidade, seu papel e seu perfil de gosto num só lugar."
        icon={<UserCircle />}
      />
      <ContaTabs />
      <div className="space-y-4">{children}</div>
    </div>
  )
}
