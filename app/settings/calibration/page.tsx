import { redirect } from "next/navigation"

// A ferramenta de "Calibração de critérios IA" agora vive inline na pilha do
// tópico "Calibração das notas" em /settings (expandida via ?open=). Mantemos
// esta rota como deep-link estável, redirecionando pro card já aberto.
export default function CalibrationRedirect() {
  redirect("/settings?g=notas&open=ai-calibration")
}
