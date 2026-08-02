import { redirect } from "next/navigation"

/**
 * A fila de IA Rk desatualizado virou a aba "Veredito IA" em /fila-recomendacao
 * (antes morava em /ai-evaluation, antes de virar duas páginas). Mantém a rota
 * antiga funcionando (links/bookmarks) via redirect.
 */
export default function StaleRerankPage() {
  redirect("/fila-recomendacao?tab=ia-rk")
}
