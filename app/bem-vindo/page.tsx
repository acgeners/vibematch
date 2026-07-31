import { redirect } from "next/navigation"
import { getSessionUserId, getCurrentUserProfile } from "@/server/queries/current-user"
import { WelcomeFlow } from "./welcome-flow"

export const dynamic = "force-dynamic"
export const metadata = { title: "Boas-vindas — SatorIA" }

/**
 * Onboarding pós-cadastro (7 telas; mockup aprovado = especificação de aceite).
 * Roda DEPOIS do cadastro e escreve direto nas tabelas — sem estado no navegador
 * (decisão 1). `signUpAction` desvia pra cá quando o signup já vem com sessão;
 * sem sessão não há o que gravar → /login.
 */
export default async function BemVindoPage() {
  const userId = await getSessionUserId()
  if (!userId) redirect("/login")

  const profile = await getCurrentUserProfile()
  return <WelcomeFlow displayName={profile.displayName} />
}
