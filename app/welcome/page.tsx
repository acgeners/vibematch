import { redirect } from "next/navigation"
import {
  getSessionUserId,
  getCurrentUserProfile,
  getHideAdultContent,
  getHideAvoidedTags,
} from "@/server/queries/current-user"
import { loadChipTasteState } from "@/server/queries/onboarding-tastes"
import { chipStateFromRows } from "@/lib/onboarding/chip-tastes"
import { getWelcomeAdultCover, getWelcomeCovers } from "@/server/queries/welcome-covers"
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
  // Hora do SERVIDOR em que a página abriu: o que a lista importada aqui gravar depois dela é "desta
  // vez" (as obras lidas sem nota que vão para a tela de notas — `getWelcomeImportStateAction`).
  const startedAt = new Date().toISOString()
  const [profile, tastes, hideAdult, hideAvoided, covers, adultCover] = await Promise.all([
    getCurrentUserProfile(),
    loadChipTasteState(userId),
    getHideAdultContent(),
    getHideAvoidedTags(),
    getWelcomeCovers(),
    getWelcomeAdultCover(),
  ])
  const chips = chipStateFromRows(tastes.rows)
  return (
    <WelcomeFlow
      displayName={profile.displayName}
      initialLoved={chips.loved}
      initialVetos={chips.vetos}
      // "Ocultar" vem marcado de partida (mig 228); quem volta às boas-vindas vê a escolha que fez.
      initialHideAdult={hideAdult}
      initialHideAvoided={hideAvoided}
      covers={covers}
      adultCover={adultCover}
      startedAt={startedAt}
    />
  )
}
