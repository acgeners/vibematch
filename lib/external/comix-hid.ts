/**
 * Extrai o hid da Comix de um input livre — aceita o hid cru ("003kd"),
 * o segmento com slug ("003kd-jinx") ou uma URL completa
 * (https://comix.to/title/003kd-jinx). Retorna null se não der pra extrair
 * um hid plausível. Util PURO (sem deps de server) pra ser usado tanto no
 * client (inputs manuais) quanto no server (validação/persistência).
 */
export function extractComixHid(input: string): string | null {
  const s = (input ?? "").trim()
  if (!s) return null

  // URL do comix.to (com ou sem protocolo): /title/{hid}-{slug}
  const urlMatch = s.match(/comix\.to\/title\/([0-9a-z]+)/i)
  if (urlMatch) return urlMatch[1].toLowerCase()

  // Caso geral: último segmento de path, hid = parte antes do 1º "-".
  const segment = s.split(/[/?#]/)[0] ?? s
  const hid = segment.split("-")[0].trim()
  return /^[0-9a-z]{3,}$/i.test(hid) ? hid.toLowerCase() : null
}
