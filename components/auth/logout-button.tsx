import { signOutAction } from "@/server/actions/auth"
import { Button } from "@/components/ui/button"

/** "Sair" — usa o signOutAction (server) via form; encerra a sessão e vai pro /login. */
export function LogoutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline" size="sm">
        Sair
      </Button>
    </form>
  )
}
