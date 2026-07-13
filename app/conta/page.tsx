import { getCurrentUserProfile } from "@/server/queries/current-user"
import { IdentityCard } from "@/components/conta/identity-card"
import { RoleCard } from "@/components/conta/role-card"

// Plano e perfil podem mudar em runtime — limita a staleness do snapshot.
export const revalidate = 60

export default async function ContaPage() {
  // O "Sair" saiu daqui: mora no menu do chip da sidebar, alcançável de qualquer página.
  const profile = await getCurrentUserProfile()

  return (
    <div className="space-y-4">
      <IdentityCard
        userId={profile.userId}
        displayName={profile.displayName}
        email={profile.email}
        avatarUrl={profile.avatarUrl}
      />
      <RoleCard role={profile.role} />
    </div>
  )
}
