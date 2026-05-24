export const PERSONAL_STATUS_DESCRIPTIONS_PT: Record<string, string> = {
  Completed: "Já li até o final do que está disponível",
  Reading: "Acompanhando o lançamento dos novos capítulos",
  Started: "Comecei a leitura recentemente, ainda não terminei",
  Stalled: "Comecei e pausei por tensão na história — pretendo terminar",
  Paused: "Comecei e pausei, pretendo terminar depois",
  Hiatus: "Aguardando nova temporada / retorno do título",
  "On-hold": "Comecei, planejo retomar, mas preciso reler antes",
  "To read": "Não comecei — está na lista de leitura",
  Dropped: "Abandonado, não pretendo continuar",
}

export function getPersonalStatusDescription(
  status: string,
  fallback?: string | null
): string {
  const pt = PERSONAL_STATUS_DESCRIPTIONS_PT[status]
  if (pt) return pt
  return fallback?.trim() ?? ""
}
