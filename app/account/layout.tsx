import type { ReactNode } from "react"
import { UserCircle } from "lucide-react"
import { Header } from "@/components/layout/header"
import { ContaTabs } from "@/components/conta/conta-tabs"

// `mx-auto` porque /account navega por ABAS horizontais, não por sidebar própria: sem ele o
// conteúdo encostava à esquerda e deixava ~350px de vão só à direita — o buraco que a sidebar
// removida ocupava. A exceção da regra são as rotas com menu lateral próprio (os membros da
// console e /preferences), onde centralizar descolaria o conteúdo do menu que o comanda.
export default function ContaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Header
        title="Minha conta"
        description="Sua identidade, seu papel e seu perfil de gosto num só lugar."
        icon={<UserCircle />}
      />
      <ContaTabs />
      <div className="space-y-4">{children}</div>
    </div>
  )
}
