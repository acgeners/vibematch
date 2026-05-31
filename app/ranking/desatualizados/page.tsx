import { redirect } from "next/navigation"

/**
 * A fila de IA Rk desatualizado virou a aba "IA Rk" em /ai-evaluation.
 * Mantém a rota antiga funcionando (links/bookmarks) via redirect.
 */
export default function StaleRerankPage() {
  redirect("/ai-evaluation?tab=ia-rk")
}
