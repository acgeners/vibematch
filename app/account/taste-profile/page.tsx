import { getTasteProfileStatusAction } from "@/server/actions/recommendations"
import { getAlignedWorkSplit, getPredictionDrivers } from "@/server/queries/recommendations"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { TasteProfilePanel } from "@/components/account/taste-profile-panel"
import type { DeclaredTagLite } from "@/lib/ai-recommendation/profile-tag-origin"

// Mesmo padrão de /recommendations: limita a staleness do TasteProfile.
export const revalidate = 60

/** Trilha de confirmação: 6 cabem numa linha de 6 colunas sem sobra. */
const READ_RAIL = 6
/** Próximas leituras: 2 páginas de 6 — a paginação vive no cliente. */
const UNREAD_RAIL = 12

export const metadata = { title: "Perfil de gosto" }

export default async function ContaPerfilPage() {
  const [status, aligned, drivers, declared] = await Promise.all([
    getTasteProfileStatusAction(),
    getAlignedWorkSplit(READ_RAIL, UNREAD_RAIL),
    getPredictionDrivers(7),
    getDeclaredTagPreferences(),
  ])

  // Só nome/stance/nível atravessam pro cliente: o resto de `DeclaredTagPref` (slug,
  // grupo, peso) não é usado na classificação e são ~150 linhas por render.
  const declaredLite: DeclaredTagLite[] = declared.map((d) => ({
    name: d.name,
    stance: d.stance,
    source: d.source,
  }))

  return (
    <TasteProfilePanel
      status={status}
      aligned={aligned}
      drivers={drivers}
      declared={declaredLite}
      unreadPageSize={UNREAD_RAIL / 2}
    />
  )
}
