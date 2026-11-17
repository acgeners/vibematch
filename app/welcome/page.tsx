import { redirect } from "next/navigation"
import {
  getSessionUserId,
  getCurrentUserProfile,
  getHideAdultContent,
  getHideAvoidedTags,
} from "@/server/queries/current-user"
import { loadChipTasteState } from "@/server/queries/onboarding-tastes"
import { chipStateFromRows } from "@/lib/onboarding/chip-tastes"
import { WelcomeFlow } from "./welcome-flow"

export const dynamic = "force-dynamic"
export const metadata = { title: "Boas-vindas" }

/**
 * Onboarding pós-cadastro (7 telas; mockup aprovado = especificação de aceite).
 * Roda DEPOIS do cadastro e escreve direto nas tabelas — sem estado no navegador
 * (decisão 1). Chega aqui: o cadastro por email (`signUpAction`), a conta nova pelo Google
 * (`/auth/callback`) e o link "Rever as boas-vindas" do card "Primeiros passos".
 * Sem sessão não há o que gravar → /login.
 */
export default async function BemVindoPage() {
  const userId = await getSessionUserId()
  // redirect-em-render: sem sessão não há o que gravar. Depende de SESSÃO, então o lugar certo
  // é o proxy — `/welcome` não está em `SIGNED_IN_PREFIXES` porque a rota é o destino do
  // signup e o cookie pode não ter propagado no primeiro request. Custo aceito: React #310 em
  // load direto (ver `app/catalog/[id]/page.tsx`), num caminho que ninguém abre por bookmark.
  if (!userId) redirect("/login")

  // Quem volta às boas-vindas vê os chips como estão gravados: a gravação só mexe no que mudar.
  const [profile, tastes, hideAdult, hideAvoided] = await Promise.all([
    getCurrentUserProfile(),
    loadChipTasteState(userId),
    getHideAdultContent(),
    getHideAvoidedTags(),
  ])
  const chips = chipStateFromRows(tastes.rows)
  return (
    <WelcomeFlow
      displayName={profile.displayName}
      initialLoved={chips.loved}
      initialVetos={chips.vetos}
      // Só "ocultar" é escolha conhecida: "mostrar" é também o padrão de quem nunca escolheu, e a
      // tela 2 não pode chegar marcada para quem nunca respondeu.
      initialHideAdult={hideAdult ? true : null}
      initialHideAvoided={hideAvoided}
    />
  )
}
