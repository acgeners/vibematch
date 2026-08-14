import { getPilotWorks, getTasteCriteria } from "@/server/queries/pilot-taste"
import { PilotTasteWizard } from "@/components/pilot/pilot-taste-wizard"

export const dynamic = "force-dynamic"
// Sem travessão: o layout raiz já junta " · SatorIA", e "Piloto — Notas de gosto · SatorIA"
// põe dois separadores na mesma aba. "Piloto de gosto" é como o resto do projeto o chama.
export const metadata = { title: "Piloto de gosto" }

export default async function PilotTastePage() {
  const [criteria, works] = await Promise.all([getTasteCriteria(), getPilotWorks()])

  if (works.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16 text-center text-muted-foreground">
        Nenhuma obra lida (com nota) pra avaliar no piloto.
      </div>
    )
  }

  return (
    <main className="py-6">
      <PilotTasteWizard criteria={criteria} works={works} />
    </main>
  )
}
