import { getCurrentUserProfile } from "@/server/queries/current-user"
import { IdentityCard } from "@/components/conta/identity-card"
import { PlanCard } from "@/components/conta/plan-card"

// Plano e perfil podem mudar em runtime — limita a staleness do snapshot.
export const revalidate = 60

export default async function ContaPage() {
  const profile = await getCurrentUserProfile()

  return (
    <div className="space-y-4">
      <IdentityCard
        userId={profile.userId}
        displayName={profile.displayName}
        email={profile.email}
        avatarUrl={profile.avatarUrl}
      />
      <PlanCard plan={profile.plan} />
    </div>
  )
}
