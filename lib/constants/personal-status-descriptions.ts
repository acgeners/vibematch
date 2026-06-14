/**
 * Fallback PT para quando a descrição (comment) do Supabase está vazia.
 * A fonte de verdade é o campo `comment` de `personal_status` no Supabase.
 */
export const PERSONAL_STATUS_DESCRIPTIONS_PT: Record<string, string> = {
  Completed: "Já li até o final do que está disponível",
  Reading: "Acompanhando o lançamento dos novos capítulos",
  Started: "Comecei a leitura recentemente, ainda não terminei",
  Stalled: "Comecei e pausei por tensão na história — pretendo terminar",
  Paused: "Comecei e pausei, pretendo terminar depois",
  Hiatus: "Aguardando nova temporada / retorno do título",
  "On-hold": "Comecei, planejo retomar, mas preciso reler antes",
  "Want to Read": "Não comecei — está na lista de leitura",
  Dropped: "Abandonado, não pretendo continuar",
}

/**
 * Descrição do status pessoal para tooltip. Prioriza `comment` (vindo do
 * Supabase via getStatusOptions / PERSONAL_STATUSES_BY_ID); cai no dicionário
 * PT local só quando o Supabase não tem descrição.
 */
export function getPersonalStatusDescription(
  status: string,
  comment?: string | null
): string {
  return comment?.trim() || PERSONAL_STATUS_DESCRIPTIONS_PT[status] || ""
}
