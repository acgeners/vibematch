/**
 * O código da URL nova do MangaUpdates (`/series/s5pb9ht`) é o MESMO id numérico da API
 * (`61294752209`), escrito em base 36. O app guarda o decimal: as 1.077 linhas de
 * `work_external_ids` com fonte MangaUpdates são todas numéricas (conferido em 2026-11-12).
 *
 * Duas fontes entregam o MangaUpdates nesse formato de código e dependem desta conversão para
 * casar: a Comix (link da obra) e o MangaDex (`attributes.links.mu`). Sem ela, o casamento NUNCA
 * batia — `Number("s5pb9ht")` é NaN e o vínculo era descartado sem aviso.
 *
 * BigInt para não perder precisão quando o código crescer (8+ caracteres passam de 2^53 na
 * conta, embora hoje caibam). Código fora de [0-9a-z] devolve undefined.
 */
export function mangaUpdatesSlugToId(slug: string | undefined): string | undefined {
  const s = slug?.trim().toLowerCase()
  if (!s || !/^[0-9a-z]+$/.test(s)) return undefined
  let n = BigInt(0)
  for (const ch of s) n = n * BigInt(36) + BigInt(parseInt(ch, 36))
  return n.toString()
}
