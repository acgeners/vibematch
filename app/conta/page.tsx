import { getCurrentUserProfile, getSessionUserId } from "@/server/queries/current-user"
import { IdentityCard } from "@/components/conta/identity-card"
import { RoleCard } from "@/components/conta/role-card"
import { LogoutButton } from "@/components/auth/logout-button"

// Plano e perfil podem mudar em runtime — limita a staleness do snapshot.
export const revalidate = 60

export default async function ContaPage() {
  const [profile, sessionUserId] = await Promise.all([getCurrentUserProfile(), getSessionUserId()])

  return (
    <div className="space-y-4">
      {sessionUserId ? (
        <div className="flex justify-end">
          <LogoutButton />
        </div>
      ) : null}
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
