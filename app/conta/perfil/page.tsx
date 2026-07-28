import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { getAlignedWorkSplit, getPredictionDrivers } from "@/server/queries/recommendations"
import { TasteProfilePanel } from "@/components/conta/taste-profile-panel"

// Mesmo padrão de /recommendations: limita a staleness do TasteProfile.
export const revalidate = 60

export default async function ContaPerfilPage() {
  const [status, aligned, drivers] = await Promise.all([
    getTasteProfileStatusAction(),
    getAlignedWorkSplit(5),
    getPredictionDrivers(7),
  ])

  return <TasteProfilePanel status={status} aligned={aligned} drivers={drivers} />
}
