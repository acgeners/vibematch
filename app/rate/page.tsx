import { notFound } from "next/navigation"
import { getSessionUserId } from "@/server/queries/current-user"
import { loadChipTasteState } from "@/server/queries/onboarding-tastes"
import { chipStateFromRows } from "@/lib/onboarding/chip-tastes"
import { countRatedWorksOf, getUnratedRead } from "@/server/queries/onboarding-imported"
import { RatePage } from "@/components/onboarding/rate-page"

export const metadata = { title: "Dar notas" }

/**
 * "Dar notas" (mockup aprovado em 19/11/2026): o caminho até as 20 notas fora das boas-vindas. O
 * mesmo deck e a mesma tela de notas das boas-vindas — as peças moram em `components/onboarding/` —,
 * mais a lista de TODAS as obras lidas e sem nota da pessoa, marcadas em qualquer lugar do app.
 * O gate de sessão é do middleware (`SIGNED_IN_PREFIXES`); o `notFound()` é a segunda linha.
 */
export default async function RateRoute() {
  const userId = await getSessionUserId()
  if (!userId) notFound()
  const [tastes, unrated, ratedCount] = await Promise.all([
    loadChipTasteState(userId),
    getUnratedRead(userId),
    countRatedWorksOf(userId),
  ])
  return <RatePage lovedLabels={chipStateFromRows(tastes.rows).loved} initialUnrated={unrated} ratedCount={ratedCount} />
}
