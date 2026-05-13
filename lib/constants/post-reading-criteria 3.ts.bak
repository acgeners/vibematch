export const POST_READING_WEIGHT_STORAGE_KEY = "animedb:post-reading-weights"

export const POST_READING_STAR_VALUES = [2, 4, 6.5, 8, 10] as const
export type PostReadingStarValue = (typeof POST_READING_STAR_VALUES)[number]

export const DEFAULT_POST_READING_WEIGHTS = {
  post_story_score: 2,
  post_fl_score: 2,
  post_ml_score: 1,
  post_character_development_score: 1,
  post_pacing_score: 1,
  post_art_visual_score: 1,
  post_impact_immersion_score: 2,
  post_originality_score: 1,
} as const

export type PostReadingScoreField = keyof typeof DEFAULT_POST_READING_WEIGHTS

export const POST_READING_WEIGHT_LABELS: Record<PostReadingScoreField, string> = {
  post_story_score: "História",
  post_fl_score: "Female Lead",
  post_ml_score: "Male Lead",
  post_character_development_score: "Desenvolvimento dos Personagens",
  post_pacing_score: "Ritmo",
  post_art_visual_score: "Arte/Visual",
  post_impact_immersion_score: "Impacto/Imersão",
  post_originality_score: "Originalidade",
}

export const POST_READING_STAR_HINTS: Record<PostReadingScoreField, string[]> = {
  post_story_score: [
    "★ → História fraca, confusa ou mal sustentada. Muitos furos, conflitos ruins ou sensação de que a obra não sabe para onde vai.",
    "★★ → História básica ou irregular. Tem uma premissa ok, mas desenvolvimento previsível, raso ou com partes mal resolvidas.",
    "★★★ → História boa e funcional. Faz sentido, mantém interesse e entrega uma progressão satisfatória, mesmo sem ser brilhante.",
    "★★★★ → História muito boa. Conflitos bem construídos, boa progressão e momentos fortes que sustentam bem a obra.",
    "★★★★★ → História excelente. Muito bem amarrada, envolvente, memorável e com resolução/construção que eleva a obra inteira.",
  ],
  post_fl_score: [
    "★ → Female Lead apagada, irritante ou sem agência. Parece ser arrastada pela história e não tem presença própria.",
    "★★ → Female Lead mediana ou pouco marcante. Cumpre sua função, mas não se destaca muito nem gera grande apego.",
    "★★★ → Female Lead boa e funcional. Tem carisma, personalidade clara e participa bem do desenvolvimento da história.",
    "★★★★ → Female Lead muito boa. Marcante, ativa, consistente e com decisões relevantes que influenciam a trama.",
    "★★★★★ → Female Lead excelente. Carrega grande parte da obra, tem presença forte, identidade memorável e é um dos principais motivos para acompanhar a história.",
  ],
  post_ml_score: [
    "★ → Male Lead sem graça, problemático ou mal construído. Pode parecer genérico, forçado ou prejudicar a dinâmica da obra.",
    "★★ → Male Lead mediano. Cumpre sua função na história, mas não se destaca muito nem deixa grande impacto.",
    "★★★ → Male Lead bom e consistente. Tem presença, personalidade clara e funciona bem dentro da trama ou da dinâmica romântica.",
    "★★★★ → Male Lead muito bom. Marcante, interessante, com presença forte e influência real no desenvolvimento da história.",
    "★★★★★ → Male Lead excelente. Memorável, carismático, essencial para o impacto da obra e um dos grandes pontos fortes da história.",
  ],
  post_character_development_score: [
    "★ → Personagens rasos, estáticos ou mal aproveitados. Relações pouco convincentes e quase nenhuma evolução.",
    "★★ → Desenvolvimento limitado. Alguns personagens têm potencial, mas a obra explora pouco ou resolve tudo de forma superficial.",
    "★★★ → Desenvolvimento bom. Há evolução perceptível, relações funcionam e os personagens têm alguma profundidade.",
    "★★★★ → Desenvolvimento muito bom. Arcos bem construídos, relações interessantes e mudanças coerentes ao longo da obra.",
    "★★★★★ → Desenvolvimento excelente. Personagens complexos, evolução forte, relações memoráveis e crescimento emocional muito bem trabalhado.",
  ],
  post_pacing_score: [
    "★ → Ritmo ruim. Muito arrastado, corrido, repetitivo ou cansativo. A experiência sofre bastante.",
    "★★ → Ritmo irregular. Tem boas partes, mas alterna com enrolação, cortes bruscos ou trechos que quebram o interesse.",
    "★★★ → Ritmo bom. A obra flui bem na maior parte do tempo, com poucos momentos cansativos.",
    "★★★★ → Ritmo muito bom. Progressão equilibrada, bom controle de tensão e pouca sensação de desperdício.",
    "★★★★★ → Ritmo excelente. Difícil parar de assistir/ler. Cada parte parece bem posicionada e a obra prende sem cansar.",
  ],
  post_art_visual_score: [
    "★ → Visual fraco ou inconsistente. A arte/animação atrapalha a experiência.",
    "★★ → Visual simples ou irregular. Não chega a estragar, mas também não valoriza muito a obra.",
    "★★★ → Visual bom. Cumpre bem, é agradável e consistente na maior parte do tempo.",
    "★★★★ → Visual muito bom. Bonito, expressivo, com boa composição de cenas e identidade visual clara.",
    "★★★★★ → Visual excelente. Marcante, muito bem executado e um dos grandes pontos fortes da obra.",
  ],
  post_impact_immersion_score: [
    "★ → Pouco envolvente. Não prende, não emociona e é fácil largar ou esquecer.",
    "★★ → Envolve pouco. Tem alguns momentos bons, mas o impacto geral é fraco ou passageiro.",
    "★★★ → Boa imersão. A obra prende, gera interesse e tem momentos emocionalmente funcionais.",
    "★★★★ → Muito imersiva. Dá vontade de continuar, cria apego e deixa cenas/momentos marcantes.",
    "★★★★★ → Extremamente imersiva. A obra gruda na cabeça, gera forte envolvimento emocional e deixa impacto depois de terminar.",
  ],
  post_originality_score: [
    "★ → Muito genérica. Usa clichês de forma preguiçosa e não apresenta identidade própria.",
    "★★ → Pouco original. A base é conhecida, mas ainda tem um ou outro elemento interessante.",
    "★★★ → Boa originalidade. Mesmo usando ideias comuns, executa bem ou combina elementos de forma agradável.",
    "★★★★ → Muito original ou muito bem diferenciada. Tem identidade própria e usa clichês de forma inteligente.",
    "★★★★★ → Altamente original/marcante. Traz algo raro, criativo ou executado de um jeito tão próprio que fica difícil confundir com outra obra.",
  ],
}

export function starsToPostReadingScore(stars: number): PostReadingStarValue {
  const index = Math.min(Math.max(Math.round(stars), 1), POST_READING_STAR_VALUES.length) - 1
  return POST_READING_STAR_VALUES[index]
}

export function scoreToPostReadingStars(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null
  let bestIndex = 0
  let bestDistance = Infinity
  POST_READING_STAR_VALUES.forEach((value, index) => {
    const distance = Math.abs(value - score)
    if (distance < bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
  })
  return bestIndex + 1
}

export function normalizePostReadingScore(score: number | null | undefined): PostReadingStarValue | null {
  const stars = scoreToPostReadingStars(score)
  return stars == null ? null : starsToPostReadingScore(stars)
}
