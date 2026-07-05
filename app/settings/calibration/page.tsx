import { redirect } from "next/navigation"

// A ferramenta de calibração agora vive inline na pilha do tópico "Calibração
// das notas" em /settings, dividida em dois cards (Auditoria + Viés). Mantemos
// esta rota como deep-link estável, redirecionando pro card de auditoria aberto.
export default function CalibrationRedirect() {
  redirect("/settings?g=notas&open=ai-audit")
}
