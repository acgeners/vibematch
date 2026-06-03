import type { ProfileTag, TasteProfilePayload } from "./types"

export const CHAT_SYSTEM_PROMPT = `Você é um consultor de leitura conversacional dentro de um app pessoal de catalogação de obras (manhwa, anime, manga). Você conversa em português brasileiro, de forma calorosa, direta e curta (1–3 frases por resposta), pra entender o que o usuário tá a fim de ler agora e então acionar o motor de recomendação.

POSTURA — SEJA PROATIVO:
- Você CONDUZ a conversa, não fica esperando o usuário se explicar sozinho. Faça perguntas que guiam.
- Use SEMPRE o PERFIL DE GOSTO do usuário (no system) como ponto de partida. Não pergunte o que já dá pra inferir do perfil — confirme ou refine. Ex.: se ele ama slow-burn, pergunte "manter a pegada slow-burn de sempre ou variar hoje?", em vez de "que gênero você quer?".
- Personalize as perguntas com o que ele curte/evita: ancore cada pergunta em algo concreto do perfil.

COMO VOCÊ TRABALHA:
1. Você NÃO vê a lista de obras. Seu papel é entender o MOOD/INTENÇÃO do usuário pela conversa e, quando tiver clareza suficiente, chamar a tool \`recommend_works\`. O motor de ranking (que roda por baixo) é quem escolhe as obras do catálogo de descoberta do usuário, usando o PERFIL DE GOSTO dele + o contexto que você passar.
2. NÃO invente títulos, sinopses ou recomendações específicas no texto. Quem traz as obras é a tool. No texto, foque em entender o mood e em comentar de forma geral.
3. Quando o pedido for VAGO ("quero algo bom", "me indica algo"), faça 2–3 perguntas curtas e DIRIGIDAS PELO PERFIL antes de recomendar — sobre dimensões úteis (tom leve/denso, manter o padrão vs. variar, tamanho curto/longo, algo a evitar hoje). Agrupe-as numa resposta enxuta; não dispare uma pergunta por turno nem interrogue além de três.
4. Quando o usuário já tiver dado sinal suficiente de mood (tom, gênero, exclusões, tamanho, etc.), CHAME \`recommend_works\` em vez de continuar perguntando. É melhor recomendar do que sondar à toa.
5. Quando o usuário pedir pra refinar ("evita drama", "algo mais curto", "menos isekai"), chame \`recommend_works\` de novo com o contexto atualizado, somando ao que já foi dito antes na conversa.

SOBRE O CAMPO \`userContext\` DA TOOL:
- É uma frase/parágrafo curto em PT-BR que resume TODO o mood acumulado da conversa de forma auto-contida (o motor de ranking lê isso como "contexto adicional"). Ex.: "Quer algo leve hoje, romance slow-burn, sem tragédia, de preferência curto pra terminar rápido."
- Inclua exclusões explícitas ("evitar X") e preferências de tamanho/tom quando o usuário mencionar.

SOBRE \`n\` (quantas obras rankear): use 20 por padrão. Use 10 se o usuário quiser algo enxuto/rápido, 30 se quiser explorar bastante.

Se você chamar \`recommend_works\`, pode (opcionalmente) acompanhar com uma frase curta de abertura no texto — algo como "Boa, deixa eu garimpar isso pra você:". Não liste obras você mesmo.`

function topTagNames(tags: ProfileTag[], limit: number): string {
  return tags
    .slice()
    .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
    .slice(0, limit)
    .map((t) => t.name)
    .join(", ")
}

/**
 * Bloco de perfil injetado como 2º item do system (cacheável). Dá ao modelo o
 * gosto consolidado do usuário pra conversar com contexto, sem precisar da
 * biblioteca inteira.
 */
export function buildChatProfileBlock(profile: TasteProfilePayload): string {
  const lines: string[] = ["PERFIL DE GOSTO DO USUÁRIO (use como pano de fundo da conversa):"]
  if (profile.summary) lines.push(profile.summary)
  if (profile.narrative_patterns?.length) {
    lines.push("", "Padrões narrativos que ele curte:")
    for (const p of profile.narrative_patterns) lines.push(`- ${p}`)
  }
  const loved = topTagNames(profile.loved_tags ?? [], 12)
  if (loved) lines.push("", `Tags que ele ama: ${loved}.`)
  const avoided = topTagNames(profile.avoided_tags ?? [], 8)
  if (avoided) lines.push(`Tags que ele evita: ${avoided}.`)
  return lines.join("\n")
}

/** Chips estáticos de fallback quando o perfil é stub/vazio (espelha o componente). */
const FALLBACK_OPENER_CHIPS = [
  "Quero algo leve hoje, sem drama pesado",
  "No mood de drama denso e político",
  "Romance slow-burn com FL de agência forte",
  "Algo curto pra terminar rápido",
  "Me surpreende com algo fora do meu padrão",
]

function topTagList(tags: ProfileTag[], limit: number): string[] {
  return tags
    .slice()
    .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
    .slice(0, limit)
    .map((t) => t.name)
}

export interface ChatOpener {
  /** Saudação proativa (1ª "fala" da IA), ancorada no perfil. */
  greeting: string
  /** Chips de partida personalizados pelo perfil. */
  chips: string[]
}

/**
 * Monta — SEM LLM — a abertura proativa do chat a partir do perfil de gosto.
 * Usado tanto pra pintar o estado vazio quanto pra persistir como 1ª mensagem
 * da conversa. Custo zero de token; o comportamento guiado vive no system prompt.
 */
export function buildChatOpener(profile: TasteProfilePayload): ChatOpener {
  const lovedTags = topTagList(profile.loved_tags ?? [], 3)
  const avoidedTags = topTagList(profile.avoided_tags ?? [], 1)
  const pattern = profile.narrative_patterns?.[0]

  // Sem sinal de gosto suficiente → abertura genérica + chips de fallback.
  if (lovedTags.length === 0) {
    return {
      greeting:
        "Oi! 👋 Bora achar sua próxima leitura. Me conta o mood de hoje — tom (leve ou denso), tamanho (curto ou longo) e algo que você queira evitar?",
      chips: FALLBACK_OPENER_CHIPS,
    }
  }

  const lovedPhrase =
    lovedTags.length >= 2
      ? `${lovedTags.slice(0, -1).join(", ")} e ${lovedTags[lovedTags.length - 1]}`
      : lovedTags[0]
  const patternClause = pattern ? `, e curte ${pattern.toLowerCase()}` : ""
  const greeting = `Oi! 👋 Pelo seu perfil, você curte bastante ${lovedPhrase}${patternClause}. Tá no mood de algo nessa pegada de sempre hoje, ou quer variar? E me diz: leve ou denso?`

  const chips: string[] = []
  if (lovedTags[0]) chips.push(`Mais do meu padrão: ${lovedTags[0]}`)
  if (lovedTags[1]) chips.push(`No mood de ${lovedTags[1]}`)
  chips.push("Me surpreende com algo fora do meu padrão")
  if (avoidedTags[0]) chips.push(`Algo bom, mas sem ${avoidedTags[0]}`)
  chips.push("Algo curto pra terminar rápido")

  return { greeting, chips }
}
