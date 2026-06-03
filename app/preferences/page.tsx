import { redirect } from "next/navigation"

// As preferências viraram um item próprio do menu lateral (/preferencias).
// Mantemos esta rota antiga como redirect pra não quebrar links antigos.
// (Em App Router, redirect() numa página vira meta-refresh no documento inicial;
// funciona pro navegador. Pra um 308 HTTP "puro", mover pro redirects() do next.config.)
export default function PreferencesRedirect() {
  redirect("/preferencias")
}
