import { describe, it, expect } from "vitest"
import { extractInlineRating } from "@/lib/external/inline-rating"

const REVIEW_WITH_INLINE_SCORE = `As for the story, I'm not really sure how I feel about it. I didn't fully love it, but the art stands out. The pastel colors are pretty. So yeah, it's not the best thing out there, but it's still enjoyable and worth a read. I'd say 8/10.`

describe("extractInlineRating", () => {
  const cases: Array<[string, number | undefined]> = [
    // Nota no fim de uma review real (o caso que motivou a feature)
    [REVIEW_WITH_INLINE_SCORE, 8],
    // Formatos e escalas
    ["I'd say 8/10.", 8],
    ["8,0/10", 8],
    ["8.5/10 great", 8.5],
    ["80/100 solid", 8],
    ["4/5 stars", 8],
    ["8 out of 10", 8],
    ["nota 7 de 10", 7],
    ["10/10 would recommend", 10],
    ["11/10 masterpiece", 10], // hipérbole → clamp em 10
    // Nota como manchete no INÍCIO (nota única → sempre pega, posição não importa)
    ["8/10. The art carries an otherwise mid story.", 8],
    // Várias notas: o marcador de veredito do autor vence, onde quer que esteja
    ["some say 9/10 but i'd give 6/10", 6], // marcador antes do 6
    ["I'd rate it 9/10. Some say 6/10 but they're wrong.", 9], // marcador antes do 9 (início)
    ["overall 8/10, though the pacing dips to a 5/10 midway", 8],
    // Várias notas SEM marcador → a primeira (manchete)
    ["8/10 for me. reminds me of a 5/10 series i dropped", 8],
    // Falsos-positivos rejeitados
    ["read 8/10 chapters so far", undefined],
    ["dropped at 3/10 episodes", undefined],
    ["posted on 8/10/2024", undefined], // data
    ["9/11 was a sad day", undefined], // denom não é 5/10/100
    ["the mc is 1/2 human", undefined], // /2 não conta
    ["no rating here at all", undefined],
  ]

  for (const [text, expected] of cases) {
    it(`${JSON.stringify(text.slice(0, 42))} → ${expected}`, () => {
      expect(extractInlineRating(text)).toBe(expected)
    })
  }
})
