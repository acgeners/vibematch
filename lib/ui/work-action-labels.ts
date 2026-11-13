/**
 * Rótulos dos botões da página da obra que OUTRA tela cita pelo nome.
 *
 * O cartão do "Gerar tudo" (`lib/generate-all/work-pieces.ts`) diz qual botão resolve o
 * que falta na obra — "“Calcular” no Veredito IA", "“Inferir tags” na aba Gêneros e
 * Tags". Escrito à mão nos dois lugares, um rename do botão faria o cartão mandar a
 * pessoa procurar um botão que não existe mais, sem nada acusar. Por isso o botão e o
 * cartão leem o rótulo daqui.
 *
 * O rótulo do Interesse não mora aqui: ele tem dono próprio, porque muda com o estado
 * da previsão (`lib/ui/interest-predict-label.ts`).
 */
export const WORK_ACTION_LABELS = {
  /** `RegenerateSynopsisAction`, no card Sinopses. */
  regenerateSynopsis: "Regerar",
  /** `TagRowAction` sem inferência anterior, na aba Gêneros e Tags. */
  inferTags: "Inferir tags",
  /** `RerankAiRkButton` sem Veredito, no card Notas calculadas. */
  calculateVerdict: "Calcular",
  /** `AiEvaluationButton` de obra com notas, na aba Análise da IA. */
  reevaluate: "Reavaliar com IA",
  /** Painel de embeddings das configurações da curadoria. */
  updateEmbeddings: "Atualizar embeddings",
} as const

/** Botão de síntese do card de reviews: sem resumo ele faz os dois; com resumo, só o digest. */
export function reviewsSynthesisLabel(hasSummary: boolean): string {
  return hasSummary ? "Destilar" : "Sintetizar reviews"
}
