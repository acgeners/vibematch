/**
 * Nota embutida NO CORPO da review ("I'd say 8/10", "80/100", "4/5", "8 out of
 * 10"). Fontes de fórum/comentário (mangago, comix, mangadex, kitsu) não têm nota
 * por review, mas muitos usuários põem a nota no texto. Normaliza pra 0-10 e pega
 * a ÚLTIMA ocorrência (o veredito costuma vir no fim). NÃO altera o texto.
 *
 * Escalas aceitas: `X/10`, `X.Y/10`, `X,Y/10`, `XX/100`, `X/5`, e as variantes
 * "X out of 10" / "X de 10". Anti-falso-positivo: rejeita datas ("8/10/2024") e
 * "X/10 chapters/episodes/pages/volumes".
 */
export function extractInlineRating(text: string): number | undefined {
  const re = /\b(\d{1,3})(?:[.,](\d+))?\s*(?:\/|\s+(?:out\s+of|de)\s+)\s*(100|10|5)\b(?!\s*[/.]?\d)(?!\s*(?:chapters?|episodes?|eps?|pages?|volumes?|ch\b|vol\b))/gi
  let m: RegExpExecArray | null
  let last: number | undefined
  while ((m = re.exec(text)) !== null) {
    const denom = Number(m[3])
    const intPart = Number(m[1])
    // Numerador implausível pra escala → provavelmente não é nota.
    if (denom === 10 && intPart > 15) continue // aceita hipérbole "11/10"
    if (denom === 5 && intPart > 5) continue
    if (denom === 100 && intPart > 100) continue
    const raw = intPart + (m[2] ? Number(`0.${m[2]}`) : 0)
    const value = denom === 100 ? raw / 10 : denom === 5 ? raw * 2 : raw
    if (value < 0) continue
    last = Math.min(10, Math.round(value * 10) / 10)
  }
  return last
}
