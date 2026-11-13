import type { CascadeStatus } from "@/lib/generate-all/types"

/**
 * O estado para onde a obra volta quando a pergunta da cascata fica sem resposta (cancelar,
 * fechar o diálogo, fechar a aba). PURO, usado pelo servidor e pelo botão.
 *
 * "Aguardando autorização" só é verdade enquanto o diálogo está aberto. Gravá-lo no banco
 * fazia o cancelamento deixar a obra presa nele: em 13/11/2026 eram 3 obras assim desde
 * agosto e setembro, todas já avaliadas por outros botões.
 *
 * Só os estados de repouso voltam; um estado de passagem (verificando, gerando, aguardando)
 * herdado de uma execução interrompida vira "idle". `blocked_manual` também: quem chegou à
 * pergunta já passou pela trava do Comix.
 */
export function restingCascadeStatus(previous: CascadeStatus | null | undefined): CascadeStatus {
  return previous === "done" || previous === "failed" ? previous : "idle"
}
