/**
 * CONTRATO CANÔNICO — a decisão, sem I/O. A fonte da verdade mora no BANCO (`canonical_contract`,
 * migration 202); quem lê é `server/queries/canonical-contract.ts`.
 *
 * Este é o PREFLIGHT do código atual: recusar ANTES de pagar o provider (avaliação) e ANTES de
 * calcular/gravar (recalc). A barreira final é o banco — os triggers da 202 recusam o writer que
 * não tem este preflight (um checkout mais antigo que ele). O preflight existe para que o checkout
 * ATUALIZADO, quando ficar defasado, descubra isso sem gastar uma chamada paga.
 *
 * ⚠️ Contrato ausente (tabela não migrada, ou sem linha) = NÃO imposto — o mesmo que o trigger faz.
 * É o estado de todo banco antes da 202 e do banco local depois do `db:pull` (que desliga o
 * `enforce`), e falhar ali pararia produção e desenvolvimento sem proteger nada.
 */

export interface ContratoCanonico {
  evalPromptVersions: string[]
  scoringContracts: string[]
  enforce: boolean
}

export type EixoDoContrato = "avaliacao" | "scoring"

export type DecisaoDoContrato =
  | { permitido: true; imposto: boolean }
  | { permitido: false; mensagem: string }

export function decidirContratoCanonico(
  eixo: EixoDoContrato,
  contrato: ContratoCanonico | null,
  local: string,
): DecisaoDoContrato {
  if (contrato == null || !contrato.enforce) return { permitido: true, imposto: false }
  const permitidos = eixo === "avaliacao" ? contrato.evalPromptVersions : contrato.scoringContracts
  if (permitidos.includes(local)) return { permitido: true, imposto: true }
  return { permitido: false, mensagem: mensagemDeContratoIncompativel(eixo, local, permitidos) }
}

function mensagemDeContratoIncompativel(eixo: EixoDoContrato, local: string, permitidos: string[]): string {
  const oQue = eixo === "avaliacao" ? `o producer deste código (prompt_version ${local})` : `o scoring deste código (${local})`
  const consequencia =
    eixo === "avaliacao"
      ? "Nenhuma chamada paga foi feita."
      : "Nada foi calculado nem gravado, e recalc_pending continua de pé."
  return (
    `contrato canônico INCOMPATÍVEL: ${oQue} não está entre os permitidos no banco ` +
    `(${permitidos.join(", ")}). ${consequencia} Este checkout está defasado em relação ao contrato ` +
    `vigente — rode a partir de um checkout atualizado (git fetch + origin/main). Ver migration 202.`
  )
}
