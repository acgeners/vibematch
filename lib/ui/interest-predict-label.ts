/**
 * Rótulo do botão que dispara a previsão de Interesse — DONO ÚNICO (2026-08-15).
 *
 * 🔴 A mesma ação tinha TRÊS nomes em três telas: "Prever de novo" na página da obra,
 * "Reprever" na fila de Interesse (`/fila-recomendacao?tab=sinopse`) e "Prever" no
 * popup de custo. Ninguém escreveu isso de propósito — cada tela nomeou o botão quando
 * foi construída, e nada as obrigava a concordar. É a família "dois critérios pro mesmo
 * fato" do CLAUDE.md, aqui no vocabulário: quem aprende o botão numa tela não o
 * reconhece na outra.
 *
 * ⚠️ **O rótulo fala do ESTADO, não de "já rodou antes".** "Atualizar previsão" promete
 * trocar algo velho por algo novo — dizer isso sobre uma previsão fresca é oferecer um
 * conserto para o que não está quebrado, e ainda por cima é uma chamada PAGA. Por isso
 * o eixo é `stale`, e não `hasPrediction`:
 *
 * | tem previsão | desatualizada | rótulo               |
 * |--------------|---------------|----------------------|
 * | não          | —             | `Prever interesse`   |
 * | sim          | não           | `Prever de novo`     |
 * | sim          | sim           | `Atualizar previsão` |
 *
 * 🔴 **Na fila, `hasPrediction` PARECE servir de atalho para `stale` — e não serve.**
 * O painel só lista obra "sem previsão OU desatualizada", então lá dentro os dois
 * coincidem hoje. Mas isso é uma propriedade do FILTRO daquela página, não do botão:
 * afrouxar o filtro (ou reusar o componente noutra fila) faria o rótulo prometer
 * "atualizar" sobre previsão fresca, sem nada acusar. Passe o fato, não o proxy.
 *
 * ⚠️ O popup de confirmação de custo fica de FORA de propósito: "Prever" ali é o verbo
 * de um botão de confirmação ("Cancelar / Prever"), não o nome da ação na tela.
 */
export interface InterestPredictLabelInput {
  /** Existe previsão persistida pra esta obra? */
  hasPrediction: boolean
  /** A previsão existente ficou para trás (sinopse ou perfil de gosto mudaram)? */
  stale: boolean
}

export function interestPredictLabel({ hasPrediction, stale }: InterestPredictLabelInput): string {
  if (!hasPrediction) return "Prever interesse"
  return stale ? "Atualizar previsão" : "Prever de novo"
}
