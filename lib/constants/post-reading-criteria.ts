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
    "★ → História fraca. Confusa, sem direção, cheia de furos ou com conflitos ruins. A trama atrapalha a experiência.",
    "★★ → História limitada. A premissa até funciona, mas o desenvolvimento é fraco, previsível, raso ou mal resolvido.",
    "★★★ → Use 3 quando a história funciona: faz sentido, mantém interesse e entrega o básico bem. Não sobe para 4 se a trama não for um ponto forte claro.",
    "★★★★ → Use 4 quando a história é ponto forte: conflitos bem construídos, boa progressão, viradas eficientes e sustentação consistente. Não vira 5 se não for memorável.",
    "★★★★★ → Só recebe 5 se a história for memorável: muito bem amarrada, envolvente e capaz de elevar a obra inteira.",
  ],
  post_fl_score: [
    "★ → Female Lead fraca. Apagada, irritante, passiva demais ou incoerente. A protagonista atrapalha a experiência.",
    "★★ → Female Lead limitada. Tem função na história, mas pouco destaque; reage mais do que age e gera pouco apego.",
    "★★★ → Use 3 quando ela funciona bem: tem personalidade clara, participa da trama e sustenta seu papel. Não sobe para 4 se não influencia decisões ou conflitos relevantes.",
    "★★★★ → Use 4 quando ela é ponto forte: marcante, ativa, consistente e com decisões que mudam a história. Não vira 5 se não for difícil imaginar a obra sem ela.",
    "★★★★★ → Só recebe 5 se ela carrega a obra: memorável, carismática e essencial para o impacto da história.",
  ],
  post_ml_score: [
    "★ → Male Lead fraco. Sem graça, genérico, mal construído ou problemático de um jeito que prejudica a obra.",
    "★★ → Male Lead limitado. Cumpre função na história, mas tem pouca presença, profundidade ou impacto próprio.",
    "★★★ → Use 3 quando ele funciona bem: tem personalidade clara, contribui para a trama ou dinâmica principal. Não sobe para 4 se ele só cumpre papel romântico/narrativo.",
    "★★★★ → Use 4 quando ele é ponto forte: marcante, interessante e relevante para conflitos, relações ou decisões. Não vira 5 se não for memorável.",
    "★★★★★ → Só recebe 5 se ele for essencial para o impacto da obra: memorável, bem construído e difícil de substituir por outro personagem parecido.",
  ],
  post_character_development_score: [
    "★ → Desenvolvimento fraco. Personagens rasos, estáticos ou mal aproveitados; relações pouco convincentes.",
    "★★ → Desenvolvimento limitado. Existe potencial, mas os arcos são superficiais, apressados ou resolvidos de forma fácil demais.",
    "★★★ → Use 3 quando há evolução perceptível, relações convincentes e alguma profundidade. Não sobe para 4 se as mudanças forem simples ou previsíveis demais.",
    "★★★★ → Use 4 quando o desenvolvimento é ponto forte: arcos bem construídos, mudanças coerentes e relações que evoluem de forma interessante. Não vira 5 se não deixar impacto emocional.",
    "★★★★★ → Só recebe 5 se o crescimento for memorável: personagens complexos, evolução marcante e relações com impacto emocional real.",
  ],
  post_pacing_score: [
    "★ → Ritmo ruim. Muito arrastado, corrido, repetitivo ou cansativo; prejudica bastante a experiência.",
    "★★ → Ritmo irregular. Tem partes boas, mas alterna com enrolação, quedas de interesse ou aceleração brusca.",
    "★★★ → Use 3 quando a obra flui bem na maior parte do tempo, com poucos trechos cansativos. Não sobe para 4 se você sentiu vontade de pular partes importantes.",
    "★★★★ → Use 4 quando o ritmo é ponto forte: progressão equilibrada, bom controle de tensão e pouca sensação de desperdício. Não vira 5 se não prende com facilidade.",
    "★★★★★ → Só recebe 5 se o ritmo prende muito: quase tudo parece bem posicionado e dá vontade de continuar sem parar.",
  ],
  post_art_visual_score: [
    "★ → Visual fraco. Inconsistente, pouco agradável ou mal executado a ponto de atrapalhar a experiência.",
    "★★ → Visual limitado. Simples, irregular ou pouco expressivo; não estraga, mas também não valoriza muito a obra.",
    "★★★ → Use 3 quando o visual é bom e funcional: agradável, claro e consistente o suficiente. Não sobe para 4 se for bonito, mas genérico ou pouco expressivo.",
    "★★★★ → Use 4 quando o visual é ponto forte: bonito, expressivo, consistente e com boa composição ou identidade. Não vira 5 se não for memorável.",
    "★★★★★ → Só recebe 5 se o visual for diferencial: marcante, memorável e um dos grandes motivos para gostar da obra.",
  ],
  post_impact_immersion_score: [
    "★ → Pouca imersão. Não prende, não emociona e é fácil largar ou esquecer.",
    "★★ → Imersão fraca. Tem alguns momentos bons, mas o impacto geral é baixo ou passageiro.",
    "★★★ → Use 3 quando a obra prende o suficiente, gera interesse e tem bons momentos. Não sobe para 4 se você gostou, mas não criou apego real.",
    "★★★★ → Use 4 quando a imersão é ponto forte: dá vontade de continuar, cria apego e deixa cenas ou emoções marcantes. Não vira 5 se não fica na cabeça depois.",
    "★★★★★ → Só recebe 5 se a obra gruda na cabeça: forte envolvimento emocional, apego alto e impacto que continua depois de terminar.",
  ],
  post_originality_score: [
    "★ → Muito genérica. Usa clichês de forma preguiçosa e parece cópia de várias outras obras.",
    "★★ → Pouco original. A base é comum e a execução não diferencia muito, apesar de ter algum detalhe interessante.",
    "★★★ → Use 3 quando a obra usa ideias conhecidas, mas executa bem ou combina elementos de forma agradável. Não sobe para 4 se não tiver identidade própria clara.",
    "★★★★ → Use 4 quando há diferenciação real: identidade própria, boa criatividade ou clichês usados de forma inteligente. Não vira 5 se ainda parecer familiar demais.",
    "★★★★★ → Só recebe 5 se for altamente marcante: raro, criativo ou executado de um jeito tão próprio que fica difícil confundir com outra obra.",
  ],
}

export const POST_READING_CRITERIA_DESCRIPTIONS: Record<PostReadingScoreField, string> = {
  post_story_score: "• Coerência do enredo\n• Qualidade dos conflitos\n• Lógica interna\n• Progressão e construção/resolução da história\n\n→ A história se sustenta por conta própria ou funciona mais como suporte para personagens, romance ou estética?",
  post_fl_score: "• Carisma e presença\n• Agência e decisões relevantes\n• Inteligência emocional/estratégica\n• Consistência de comportamento\n• Impacto na trama e nas relações\n\n→ A protagonista move a história com identidade própria ou só reage ao que acontece?",
  post_ml_score: "• Carisma e presença\n• Construção como personagem\n• Agência e decisões relevantes\n• Consistência de comportamento\n• Impacto na trama, romance ou dinâmica principal\n\n→ O Male Lead acrescenta força à obra ou existe só como par romântico/apoio da protagonista?",
  post_character_development_score: "• Evolução ao longo da história\n• Profundidade dos personagens\n• Arcos individuais\n• Relações, química e conflitos\n• Mudanças coerentes com as experiências vividas\n\n→ Os personagens crescem de forma convincente ou só mudam porque a trama precisa?",
  post_pacing_score: "• Fluidez da leitura\n• Equilíbrio entre partes lentas e rápidas\n• Enrolação, repetição ou cortes bruscos\n• Controle de tensão e progressão\n\n→ A obra flui naturalmente ou dá vontade de pular, pausar ou abandonar partes?",
  post_art_visual_score: "• Qualidade do desenho/animação\n• Consistência visual\n• Expressividade dos personagens\n• Composição de cenas\n• Identidade estética\n\n→ O visual apenas cumpre função ou realmente valoriza a experiência?",
  post_impact_immersion_score: "• Envolvimento emocional\n• Vontade de continuar\n• Apego aos personagens\n• Cenas ou momentos memoráveis\n• Quanto a obra fica na cabeça depois\n\n→ A obra te puxou de verdade ou você só reconhece que ela é boa?",
  post_originality_score: "• Identidade própria\n• Criatividade da premissa ou execução\n• Uso inteligente de clichês\n• Diferenciação dentro do gênero\n• Sensação de novidade ou personalidade\n\n→ A obra parece ter voz própria ou soa como mais uma versão do mesmo molde?",
}

export interface PostReadingStarLegendEntry {
  stars: number
  value: number
  label: string
  description: string
}

export const POST_READING_STAR_LEGEND: PostReadingStarLegendEntry[] = [
  { stars: 1, value: 2, label: "Prejudica", description: "Prejudica a experiência. História confusa, personagens sem graça/irritantes ou visual fraco." },
  { stars: 2, value: 4, label: "Fraco/limitado", description: "Tem problemas claros, mas ainda é aproveitável. Premissa aceitável, mas desenvolvimento raso, ritmo irregular ou clichês comuns." },
  { stars: 3, value: 6.5, label: "Funciona", description: "Funciona bem, sem ser grande destaque.\nObra funcional, boa imersão e desenvolvimento satisfatório, mesmo sem ser brilhante." },
  { stars: 4, value: 8, label: "Ponto forte", description: "É um ponto forte da obra.\nHistória cativante, personagens marcantes, boa arte/visual e ritmo bem equilibrado." },
  { stars: 5, value: 10, label: "Diferencial/memorável", description: "É memorável ou um dos principais motivos para gostar da obra. Excepcional em todos os aspectos: memorável, extremamente imersivo e original." },
]

export interface SynopsisInterestLegendEntry {
  glyph: string
  label: string
  description: string
}

export const SYNOPSIS_INTEREST_LEGEND: SynopsisInterestLegendEntry[] = [
  { glyph: "♡", label: "Fraca", description: "A sinopse não me chamou atenção; parece pouco interessante ou fora do meu gosto." },
  { glyph: "♥♥", label: "Regular", description: "Tem algum elemento interessante, mas não gerou muita vontade de começar." },
  { glyph: "♥♥♥", label: "Boa", description: "A sinopse me interessou; parece uma obra que eu provavelmente testaria." },
  { glyph: "♥♥♥♥", label: "Ótima", description: "A sinopse me deixou com muita vontade de ler; combina bastante com o que eu procuro." },
]

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
