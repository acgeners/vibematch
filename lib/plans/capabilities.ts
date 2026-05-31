// ============================================================
// Plano Free vs Pago — fonte única de verdade (Bloco 2)
// ============================================================
// Toda feature que diferencia free/pago consulta este mapa. Não espalhe
// checagens de `plan === "paid"` pelo código — use `planAllows(plan, cap)`.
//
// Regra: capability NÃO listada aqui é Free por padrão. Liste só o que é
// restrito ao Pago. Assim o default é o plano mais permissivo de leitura
// (previsão estatística), e o gate é explícito no que custa LLM/qualidade.

export type UserPlan = "free" | "paid"

/**
 * Capabilities restritas ao Pago. A descrição documenta a diferenciação
 * (espelha a tabela em plan-arquitetura-notas.md §4).
 */
export const PAID_CAPABILITIES = {
  // Previsão rica
  l0_quality_eval: "IA estima os 8 critérios de qualidade pra obras não-lidas (afina a faixa do expected_score)",
  llm_taste_profile: "TasteProfile gerado por LLM (Free usa heurístico)",
  // Recomendação L3 (consultor sob demanda)
  smart_shortlist: "Re-rank por IA com match_score (Free ordena por expected×fit, sem LLM)",
  deep_dive: "Análise profunda de 1 obra (extended thinking)",
  mood_input: "Contexto/mood livre no ranking ('algo leve hoje')",
  chat_recommend: "Recomendação conversacional por chat (Free usa o formulário one-shot)",
} as const

export type Capability = keyof typeof PAID_CAPABILITIES

/** True se o plano libera a capability. Pago libera tudo; Free só o não-listado. */
export function planAllows(plan: UserPlan, _cap: Capability): boolean {
  // Toda key de PAID_CAPABILITIES é, por definição, restrita ao Pago.
  void _cap
  return plan === "paid"
}

/** Mensagem padrão de upsell quando uma capability paga é bloqueada no Free. */
export function paidOnlyMessage(cap: Capability): string {
  return `Recurso do plano Pago: ${PAID_CAPABILITIES[cap]}.`
}
