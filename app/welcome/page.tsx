import { redirect } from "next/navigation"
import { getSessionUserId, getCurrentUserProfile } from "@/server/queries/current-user"
import { WelcomeFlow } from "./welcome-flow"

export const dynamic = "force-dynamic"
export const metadata = { title: "Boas-vindas" }

/**
 * Onboarding pós-cadastro (7 telas; mockup aprovado = especificação de aceite).
 * Roda DEPOIS do cadastro e escreve direto nas tabelas — sem estado no navegador
 * (decisão 1). `signUpAction` desvia pra cá quando o signup já vem com sessão;
 * sem sessão não há o que gravar → /login.
 */
export default async function BemVindoPage() {
  const userId = await getSessionUserId()
  // redirect-em-render: sem sessão não há o que gravar. Depende de SESSÃO, então o lugar certo
  // é o proxy — `/welcome` não está em `SIGNED_IN_PREFIXES` porque a rota é o destino do
  // signup e o cookie pode não ter propagado no primeiro request. Custo aceito: React #310 em
  // load direto (ver `app/catalog/[id]/page.tsx`), num caminho que ninguém abre por bookmark.
  if (!userId) redirect("/login")

  const profile = await getCurrentUserProfile()
  return <WelcomeFlow displayName={profile.displayName} />
}
