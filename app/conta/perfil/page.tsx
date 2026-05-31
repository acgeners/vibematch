import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { TasteProfileCard } from "@/components/recommendations/taste-profile-card"
import { TasteProfileHealth } from "@/components/settings/taste-profile-health"

// Mesmo padrão de /recommendations: limita a staleness do TasteProfile.
export const revalidate = 60

export default async function ContaPerfilPage() {
  // getTasteProfileStatusAction já carrega o TasteProfile atual; reusamos
  // status.profile no diagnóstico de saúde pra não buscar duas vezes.
  const status = await getTasteProfileStatusAction()

  return (
    <div className="space-y-4">
      <TasteProfileCard status={status} />
      <TasteProfileHealth tasteProfile={status.profile} />
    </div>
  )
}
