import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { getTopAlignedWorks } from "@/server/queries/recommendations"
import { TasteProfilePanel } from "@/components/conta/taste-profile-panel"

// Mesmo padrão de /recommendations: limita a staleness do TasteProfile.
export const revalidate = 60

export default async function ContaPerfilPage() {
  const [status, topAligned] = await Promise.all([
    getTasteProfileStatusAction(),
    getTopAlignedWorks(5),
  ])

  return <TasteProfilePanel status={status} topAligned={topAligned} />
}
