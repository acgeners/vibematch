import { redirect } from "next/navigation"

// As preferências saíram da área "Minha conta" e viraram um item próprio do menu
// lateral (/preferencias). Mantemos esta rota como redirect pra não quebrar links
// antigos.
export default function ContaPreferenciasRedirect() {
  redirect("/preferencias")
}
