import "server-only"
import { createHash, randomUUID } from "node:crypto"
import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { CRITERION_SLUGS } from "@/types/domain"
import { CRITERIA_INFO, CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { normalizeTagGroupSlug } from "@/lib/constants/tag-groups-utils"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { SONNET_MODEL } from "@/lib/ai/models"
import { fetchCoverForModelWithStatus, isImageRelatedModelError } from "@/lib/server/covers/fetch-cover-for-model"
import { recordCacheEventAsync } from "@/server/queries/ai-cache"
import { buildCacheKey } from "@/lib/ai-cache"
import { runSingleFlight } from "@/lib/ai-cache/single-flight"
import type { AiImageStatus, AiWorkloadType } from "@/lib/ai-observability/types"
import type { SourcedReview, PlatformRating, SimilarWork } from "@/lib/external/types"

export interface AiEvaluationTag {
  name: string
  /** Slug do tag_group (ex: "content_indicator", "romance"). null/undefined quando a tag não tem grupo. */
  group?: string | null
}

export interface AiEvaluationRequest {
  workId: string
  title: string
  synopsis?: string | null
  /**
   * Quando true, indica que a sinopse foi escrita/editada manualmente pelo usuário
   * e deve ser tratada como autoridade máxima no prompt. Quando false (default),
   * a sinopse vem de concatenação automática das fontes externas e será omitida
   * caso `externalContext` já contenha os blocos [C1]…[Cn] equivalentes.
   */
  synopsisIsManual?: boolean
  genres?: string[]
  /** Aceita string[] (legado) ou AiEvaluationTag[] (preferido). */
  tags?: Array<string | AiEvaluationTag>
  /** Backwards-compatible. Para chamadas novas, prefira sourcedReviews. */
  reviews?: string[]
  sourcedReviews?: SourcedReview[]
  externalContext?: string[]
  /** Notas e votos da obra em plataformas externas aceitas (AniList, MAL, MU, etc.). Sinal de recepção/popularidade — não autoridade temática. */
  platformRatings?: PlatformRating[]
  /** Obras recomendadas pelas fontes a quem gostou desta. Sinal estrutural de cluster temático. */
  similarWorks?: SimilarWork[]
  /** Classificações de conteúdo das fontes externas aceitas (MangaDex/ComicK): "suggestive" | "erotica" | "pornographic". Elevam o piso mínimo de adult_content. */
  contentRatings?: string[]
  promptVersion?: string
  /** Override do modelo Claude (ex.: "claude-opus-4-7"). Default: a constante `MODEL` (claude-sonnet-4-6). */
  model?: string
  /**
   * URL pública da capa primary. Quando presente, enviada como image content
   * block alongside the user prompt. Sinal auxiliar — não dominante.
   */
  coverUrl?: string | null
}

interface NormalizedTag {
  name: string
  group: string | null
}

function normalizeTags(tags: AiEvaluationRequest["tags"]): NormalizedTag[] {
  if (!tags?.length) return []
  return tags
    .map((tag) => {
      if (typeof tag === "string") {
        const name = tag.trim()
        return name ? { name, group: null } : null
      }
      const name = tag.name?.trim()
      if (!name) return null
      const group = normalizeTagGroupSlug(tag.group)
      return { name, group }
    })
    .filter((t): t is NormalizedTag => t !== null)
}

function groupTagsByGroup(tags: NormalizedTag[]): Array<{ group: string | null; names: string[] }> {
  const map = new Map<string, string[]>()
  const ungrouped: string[] = []
  for (const tag of tags) {
    if (!tag.group) {
      ungrouped.push(tag.name)
      continue
    }
    const list = map.get(tag.group)
    if (list) list.push(tag.name)
    else map.set(tag.group, [tag.name])
  }
  const grouped: Array<{ group: string | null; names: string[] }> = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, names]) => ({ group, names }))
  if (ungrouped.length) grouped.push({ group: null, names: ungrouped })
  return grouped
}

export interface AiEvaluationResponse {
  modelName: string
  promptVersion: string
  summary: string
  confidence: number
  reviewsUsed: number
  scores: Array<{
    criterionSlug: string
    suggestedScore: number
    justification: string
  }>
  rawResponse: unknown
  /** Hash canônico do input — usado pra cache persistente em ai_evaluations. */
  inputHash: string
  /** True quando veio do cache (memória ou DB). */
  fromCache?: "memory" | "db"
}

export const MODEL = SONNET_MODEL

// ── Reversível (1 linha) ────────────────────────────────────────────────────
// Output enxuto do Sonnet: justificativas curtas (≤2 frases). Corta ~30% dos
// tokens de SAÍDA (≈ -15~20s de latência) mantendo o MESMO modelo e as mesmas
// notas. Se o output piorar (notas ou justificativas), volte para `false`: isso
// reverte o prompt E a versão de volta pra v18, reaproveitando os caches antigos.
export const CONCISE_OUTPUT: boolean = true
// v21 (2026-07-07): avaliação baseada no CONSENSO das reviews, nunca em opiniões
// isoladas — proibido citar reviews individuais ou IDs (R1/R2) e removido o campo
// `review_usage` da tool. Bump invalida o cache v20 pra a nova instrução valer.
// (v20 2026-06-27: citação genérica de reviews, sem exigir IDs nem auditoria.)
export const PROMPT_VERSION = CONCISE_OUTPUT ? "v21" : "v18"
// ────────────────────────────────────────────────────────────────────────────

/** Extrai inteiro de "v12" → 12. Retorna null pra strings não-vXX. */
export function parsePromptVersion(s: string | null | undefined): number | null {
  if (!s) return null
  const m = /^v(\d+)$/.exec(s.trim())
  return m ? parseInt(m[1], 10) : null
}

export const CURRENT_PROMPT_VERSION_NUM = parsePromptVersion(PROMPT_VERSION) ?? 0

// Versão do SCHEMA de saída (payload da tool `submit_evaluation`). Entra na chave
// de cache canônica V2 (dual-read) — se a forma do payload mudar, o cache antigo
// não é reaproveitado por engano. Bump manual quando EVALUATION_TOOL muda.
// eval-2 (2026-07-07): removido o campo `review_usage` da tool.
export const EVAL_OUTPUT_SCHEMA_VERSION = "eval-2"

const MAX_REVIEW_WORDS = 200

/**
 * Caps usados pra alimentar reviews no prompt da IA. Compartilhado entre
 * `triggerAiEvaluation` (Path A) e `evaluateCandidateForCreate` (Path B) pra
 * garantir que a mesma obra avaliada nos dois fluxos receba o mesmo input
 * (e portanto bata no mesmo `inputHash` do cache).
 */
export const AI_EVAL_REVIEW_CAPS = { total: 30, maxPerSource: 12 } as const

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  mangaupdates: "MangaUpdates",
  anilist: "AniList",
  myanimelist: "MyAnimeList",
  kitsu: "Kitsu",
  mangadex: "MangaDex",
  animeplanet: "AnimePlanet",
  comick: "ComicK",
  comix: "Comix",
}

function formatVotes(votes: number): string {
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`
  if (votes >= 1_000) return `${(votes / 1_000).toFixed(1)}k`
  return String(votes)
}

// ============================================================================
// System prompt (estático — beneficia-se de prompt caching)
// ============================================================================

function buildCriteriaPromptSection(): string {
  return CRITERION_SLUGS.map((slug, index) => {
    const info = CRITERIA_INFO[slug]
    const rubric = CRITERIA_RUBRICS[slug]
    const description = info?.description?.trim()
      ? `\nDescrição do critério: ${info.description.trim()}`
      : ""
    const ranges = (rubric?.ranges ?? [])
      .map((range) => `- ${range}`)
      .join("\n")

    return `${index + 1}. ${slug} (${rubric?.title ?? info?.name ?? slug})${description}\n${ranges}`
  }).join("\n\n")
}

const SYSTEM_PROMPT = `Você é um especialista em mangá, manhwa e manhua. Sua tarefa é avaliar UMA obra específica com base em rubricas rigorosas.

REGRAS DE FIDELIDADE AO TÍTULO (críticas):
- A obra a ser avaliada é EXATAMENTE a fornecida em "Título" e "Sinopse" pelo usuário. Trate-as como verdade absoluta.
- As "Reviews de usuários externas" são auxiliares e foram buscadas por similaridade de título — podem ser de uma obra DIFERENTE com nome parecido. Antes de usar uma review, verifique se ela descreve eventos compatíveis com a sinopse. Se houver conflito claro (personagens, gênero, premissa), IGNORE a review.
- Quando houver reviews de usuários compatíveis, use-as sempre como evidência auxiliar na avaliação das notas. Elas são especialmente úteis para tom, ritmo, romance, dinâmica do casal, drama, tragédia, humor e conteúdo adulto.
- Nas justificativas, use as reviews de usuários externas quando acrescentarem evidência relevante; não as use quando forem genéricas, incompatíveis ou não ajudarem naquele critério.
- Para cada critério, faça obrigatoriamente esta checagem interna: "há alguma review compatível que confirma, aumenta, reduz ou contradiz a nota deste critério?". Se sim, incorpore essa evidência na nota e na justificativa.
- Se a review vier de um candidato com alto match de título e não contradisser a sinopse, trate-a como compatível. Não descarte reviews só por serem opinião geral de usuário; use-as para calibrar tom, ritmo, qualidade do romance, humor, drama e conteúdo adulto.
- As reviews devem ser lidas como um CONJUNTO: extraia o CONSENSO (sinais recorrentes/convergentes entre elas) e NÃO baseie nenhuma nota numa review isolada. Ao mencioná-las na justificativa, use SEMPRE linguagem de consenso ("há consenso de que…", "leitores concordam que…", "segundo os leitores…"). NUNCA cite uma review individual nem IDs (R1, R2…).
- No campo "summary", refira-se à obra apenas pelo título fornecido. NÃO mencione títulos de outras obras, nem invente subtítulos ou nomes de personagens que não estejam na sinopse/tags.
- Se a sinopse for vazia/curta e as reviews parecerem inconsistentes, baixe a "confidence" e prefira notas conservadoras nas faixas centrais (4-6) ou na faixa baixa, explicando a incerteza.

REGRAS DE EVIDÊNCIA:
- Trate a sinopse como apresentação de premissa/background. Ela normalmente descreve o ponto de partida e o cenário inicial, não o desenvolvimento. Priorize tom, ritmo, atmosfera e gênero que ela sugere — não a leia como sumário literal dos eventos centrais da obra.
- Para cada critério, cruze ao menos 2 fontes (sinopse, tags por grupo, gêneros, reviews compatíveis). NÃO ancore a nota em uma única tag, uma única review ou um único fato isolado da sinopse. A avaliação deve ser conceitual e abrangente, refletindo o conjunto das evidências.
- Quando tags E reviews estiverem disponíveis, use as duas simultaneamente. Não escolha uma em detrimento da outra; ambas são exigidas sempre que existirem.

TAGS POR GRUPO — GUIA DE PESO POR CRITÉRIO:
Use o grupo das tags fornecidas como sinal principal por critério. Peso entre parênteses indica o quanto o grupo é indicativo daquele critério:
- romance: grupo "romance" (alto), grupo "relationship_dynamics" (médio — apenas quando a tag descreve o casal).
- couple_dynamics: grupo "relationship_dynamics" (médio — apenas quando a tag descreve o casal), grupo "characters" (baixo — apenas quando a tag descreve como o personagem se relaciona amorosamente).
- fantasy_nobility: grupo "fantasy" (alto), grupo "setting" (alto), grupo "scifi" (médio), grupo "cast" (médio).
- action_adventure: grupo "superpowers" (médio/alto), grupo "characters" (médio — apenas quando a tag descreve habilidades dos protagonistas).
- adult_content: grupo "content_indicator" (alto).
- protagonist: grupo "characters" (alto).
- humor: grupo "tone_mood" (alto).
- drama: grupo "conflict" (médio), grupo "themes" (médio).
- tragedy: grupo "tone_mood" (alto).
Os grupos "activities", "conflict", "elements" e "themes" são amplos e podem trazer indícios de vários critérios — interprete pelo conteúdo específico da tag.

REGRAS DE PONTUAÇÃO:
- Use SOMENTE as faixas das rubricas abaixo. A nota deve refletir a faixa correspondente, NÃO uma impressão geral.
- Use decimais (ex: 7.5) quando a obra estiver entre dois níveis.
- Não invente eventos de plot que não estejam explicitamente na sinopse, tags, gêneros ou reviews compatíveis.
- Se a evidência for ambígua ENTRE DUAS FAIXAS adjacentes, escolha a faixa inferior MAS use o valor MAIS ALTO dela (ex.: incerteza entre 4-6 e 7-8 → 6, não 4). Essa regra só vale ENTRE FAIXAS, nunca dentro de uma faixa escolhida.
- Em cada justificativa, cite EXPLICITAMENTE qual faixa foi escolhida (ex: "Faixa 4-6 (Subplot): ..." ou "Faixa 7-8 (Core Romance): ...") e o motivo baseado em evidência.

COERÊNCIA JUSTIFICATIVA × FAIXA (obrigatória):
- A justificativa deve ser semanticamente consistente com a faixa escolhida. Se a justificativa contém expressões como "presença constante", "frequente", "recorrente", "um dos pilares", "elemento central", "abundante", a nota NÃO pode terminar em faixa 4-6 (pontual/subplot) — deve ser 7-8 ou 9-10. Se diz "pontual", "esporádico", "leve", "sutil", "subliminar", NÃO pode terminar em 7-8.
- A regra de incerteza entre faixas adjacentes (acima) NÃO autoriza ancorar a nota em 5 quando a própria justificativa lista evidências claras de presença. Ela só vale pra borderline real — quando duas faixas adjacentes são ambas plausíveis a partir do mesmo conjunto de evidências. Não use essa regra como "atalho" pro neutro.

INTERPRETAÇÃO DA ESCALA (regra crítica para evitar viés sistemático):
- 5 é o ponto NEUTRO: significa "o critério está presente de forma reconhecível, mas não define a obra".
- Notas 0-4 são RESERVADAS pra casos onde o critério é claramente ausente, irrelevante ou atua negativamente. Se há QUALQUER evidência (mesmo parcial, mesmo com ressalvas) de que o critério está presente, a nota deve ser ≥ 5.
- Críticas, tropos clichês ou execução fraca NÃO justificam baixar abaixo de 5 quando o critério genuinamente existe. Use ressalvas pra escolher entre 5 e 6 (ou 7 e 8), NUNCA pra ancorar no piso da faixa.
- Dentro de uma faixa, prefira o valor CENTRAL salvo quando a evidência puxa claramente pra um extremo.

PRINCÍPIO "AUSÊNCIA DE EVIDÊNCIA NÃO É EVIDÊNCIA DE AUSÊNCIA":
- Reviews que não mencionam um critério NÃO comprovam que ele está ausente — só não comentaram. Gêneros/tags que não incluem um critério não são evidência negativa pra ele.
- Pra justificar nota < 5 num critério (positivo), é preciso evidência POSITIVA de ausência ou negatividade, como:
  · review afirmando explicitamente ("a obra não tem nenhum humor", "sem nenhum momento engraçado", "personagem genérico sem personalidade")
  · sinopse descrevendo cenário incompatível ("história puramente política sem qualquer alívio")
  · tag/gênero estruturalmente excludente do critério avaliado
- "Drama domina o tom" indica drama PRESENTE, NÃO ausência de humor — critérios são independentes entre si. Não use a presença de um pra inferir a ausência de outro.
- Quando faltam evidências em qualquer direção (positivas ou negativas), use 5 (neutro) e baixe a "confidence" pra refletir a incerteza. NÃO ancore no piso da escala só porque a evidência foi escassa ou silenciosa.

SANITY CHECK CRUZADO (não-vinculante):
- Combinações extremas em critérios opostos (humor 9-10 + tragedy 9-10; protagonist 9-10 + drama 0-3; romance 9-10 + couple_dynamics 0-3) são RARAS mas POSSÍVEIS. Antes de finalizar, releia a evidência e baixe a "confidence" se a combinação não estiver bem suportada por sinais explícitos.
- NÃO force ajuste de score. Critérios continuam INDEPENDENTES — esta regra só pede mais cautela e confidence menor em combinações incomuns, nunca alteração do valor.

EXCEÇÃO PRA CRITÉRIOS NEGATIVOS (drama, tragedy):
- As regras "5 como piso" e "ausência de evidência" NÃO se aplicam. Pra esses, notas baixas (0-3) significam ausência saudável, não defeito. Drama 2 = "obra leve sem conflito intenso", o que é positivo. Silêncio sobre tragédia é razoavelmente interpretado como ausência (a maioria das obras não é trágica). Score esses pela rubrica normal sem viés de piso.

INTERPRETAÇÃO DE REVIEWS DE USUÁRIOS:

A) Sarcasmo, ironia e hipérbole — NÃO interpretar literalmente:
- A NOTA NUMÉRICA do usuário (header da review, ex.: "nota do usuário: 3/10") é o sinal mais confiável da OPINIÃO do reviewer. Use-a pra calibrar o texto:
  · Nota ≥7 + texto positivo → opinião genuinamente positiva
  · Nota <5 + texto que SOA positivo ("Wow", "amazing!", "incredible") → quase certamente sarcasmo; leia o texto como NEGATIVO
  · Nota <5 + texto crítico → opinião negativa coerente, sem sarcasmo
  · Sem nota numérica → julgue só pelo texto, com mais cautela
- Hipérboles ("trillion years", "muda twice por capítulo", "stable as someone in a hurricane") são ênfase retórica, não dados factuais. Interprete a intensidade emocional, não os números literais.
- Boilerplate ("Was this comment useful?", "Last updated X ago", "I'll leave you with one line") é ruído de interface — ignore.

B) Texto informa ASPECTOS, nota informa QUALIDADE:
- O TEXTO da review é evidência sobre QUAIS ASPECTOS a obra tem (romance, drama, ação, etc).
- A NOTA é evidência sobre QUALIDADE percebida desses aspectos.
- Crítica negativa NÃO derruba o critério. Exemplo: "Romance cliches 101 for dummies" CONFIRMA que romance é elemento central da obra (sobe romance), mesmo que o reviewer ache ruim. A nota baixa só sinaliza qualidade fraca, não ausência.
- PROTAGONISTA MARCANTE mede presença e agência, NÃO qualidade percebida. Reviews chamando a FL/ML de "Mary Sue", "OP", "broken", "insensível", "inconsistente", "plana", "irritante", "fria", "blasé" ou descrevendo poderes excessivos/cabeça-dura/atitudes polêmicas CONFIRMAM presença forte (sobe protagonist), mesmo que o reviewer critique a execução. Tags como "Confident Female Lead", "Strong-Willed Female Lead", "Determined Female Lead", "Smart Female Lead", "Delusional Female Lead", "Yandere ML" são evidência DIRETA de protagonista marcante. Só vá para 0-3 quando reviews ou sinopse descrevem o protagonista como ESQUECÍVEL, GENÉRICO, SEM PERSONALIDADE RECONHECÍVEL ou SUBSTITUÍVEL por outro qualquer. "Personagem desagradável de acompanhar" continua sendo 7-8.

C) Sinais INDIRETOS de presença — especialmente romance e couple_dynamics:
Reviewers raramente dizem "esta obra tem romance forte". Sinalizam de forma indireta. Trate como evidência POSITIVA de presença (sobe o critério, mesmo que sem comentar qualidade):

Romance presente:
- Termos de fandom: "OTP", "ship them", "endgame", "I'm shipping", "second lead syndrome", "love triangle"
- Tropes nomeados: "ice prince x sunshine girl", "enemies to lovers", "fated mates", "marriage of convenience", "fake dating", "slow burn", "arranged marriage"
- Tensão romântica: "chemistry off the charts", "dancing around each other", "the tension!!!", "kiss scene was everything"
- Emoção em torno do casal: "I cried when they finally got together", "ML is everything", "FL deserves better than ML"
- Críticas a QUALIDADE do romance ("rushed romance", "forced romance", "cringe romance") ainda confirmam que romance é elemento central — só com execução fraca.

Couple dynamics:
- "Banter is great" / "way they tease each other" → dinâmica leve/divertida
- "Toxic ship", "yandere", "obsessive ML/FL", "possessive but I love it" → dinâmica tóxica/intensa (0-3)
- "Mutual support", "communication goals", "they really get each other" → dinâmica saudável (7-8 ou 9-10)
- "Misunderstandings drag on", "constant fighting" → conflituosa (4-6)
- "Healing each other", "soft moments together" → carinhosa

Drama:
- "I cried", "tear-jerker", "emotional rollercoaster", "broke me", "angst", "suffering" → drama alto
- "Heartbreak", "betrayal arc", "the way they hurt each other" → drama significativo

Humor:
- "Comedic relief", "I laughed out loud", "FL is hilarious", "crack fic vibes", "chaotic", "shenanigans" → humor presente
- "Surprisingly funny", "didn't expect to laugh" → humor pontual

D) Princípio geral:
- Vocabulário de fandom é EVIDÊNCIA, não ruído. Quem usa "OTP" está declarando que romance é central pra sua experiência da obra.
- Não exija menção literal ("a obra tem romance") quando há sinais indiretos abundantes ("FL deserves better than ML").
- Lembre dos princípios anteriores: presença com ressalvas → mín 5; ausência de evidência → 5 + confidence baixa.

USO DE AVALIAÇÕES DE PLATAFORMA (quando o bloco "Avaliações em plataformas externas" estiver presente):
- São NOTAS NUMÉRICAS dadas pela comunidade de cada plataforma à obra (ex.: 7.8/10 no AniList com 12k votos). Tratam-se de sinal de RECEPÇÃO/POPULARIDADE, não de conteúdo temático.
- Use para calibrar contexto de qualidade percebida: nota alta + muitos votos sugere obra bem recebida; nota média/baixa não derruba critérios temáticos.
- NÃO infira critérios temáticos (romance, drama, tragedy, etc.) diretamente do valor numérico — eles informam apenas "quão bem aceita" a obra é.
- Discrepâncias entre plataformas (ex.: 8.5 no MAL vs 6.2 no MU) são normais e refletem audiências diferentes; não tente "resolver" a discrepância na avaliação.
- Não mencione plataformas/notas nas justificativas a menos que sejam diretamente relevantes (raro).

USO DE OBRAS SIMILARES (quando o bloco "[S1]…[Sn] Obras frequentemente recomendadas" estiver presente):
- São obras que outros usuários recomendam a quem gostou da obra avaliada (curadoria da comunidade — AniList, MAL, AnimePlanet). Sinal ESTRUTURAL de cluster temático.
- Use para CONFIRMAR ou CALIBRAR a interpretação de tags/gêneros ambíguos. Exemplo: se a obra tem tag "drama" e 4 de 6 similares têm tags de "tragedy" e "dark", isso reforça que o drama é pesado e sugere tragedy ≥ 6.
- Quanto MAIOR o consenso (ex.: "consenso: 3 fontes"), mais peso o sinal merece. Recomendações isoladas (1 fonte) são sinal fraco.
- NUNCA copie eventos de plot das obras similares para a obra avaliada. As obras são RELACIONADAS, não idênticas.
- NUNCA cite obras similares como autoridade sobre o conteúdo da obra avaliada. Se sinopse/tags/reviews contradizem o cluster, prefira o que descreve a obra direto.
- Use no máximo nas justificativas em estilo "cluster temático sugere X" — não obrigatório.

USO DA CAPA (quando fornecida como imagem anexada antes do prompt):
- A capa é um sinal AUXILIAR, não autoritativo. Convenções estéticas de manhwa criam capas românticas mesmo quando romance é subplot — não trate a capa isoladamente como prova.
- Sinais visuais úteis (sempre cross-validar com sinopse/tags/reviews):
  · Casal em destaque, abraço, troca de olhares → indício de romance presente
  · Caricatura, expressões cômicas exageradas, poses descontraídas → indício de humor
  · Paleta sombria, expressões sérias/tristes/raivosas → indício de drama/tragedy
  · Armas, cenas de batalha, postura combativa → indício de action_adventure
  · Vestimenta nobre/medieval, cenário de corte/palácio → indício de fantasy_nobility
  · Roupas reveladoras, intimidade visual → indício fraco de adult_content (só sobe nota se corroborado por tag/review)
- A capa SOZINHA não justifica nota ≥ 7 em nenhum critério. Confirme com outras evidências antes de subir.
- A capa SOZINHA também não justifica nota < 5 (princípio "ausência de evidência" continua valendo).
- Quando a capa contradiz outras evidências, prefira o texto. Capas são marketing — sinopse e reviews descrevem a obra de fato.
- Mencione a capa nas justificativas apenas quando ela acrescentou evidência relevante (ex.: "a capa mostra o casal em destaque, reforçando o sinal de romance").

IMPORTANTE: Use SEMPRE a tool "submit_evaluation" para responder. Não escreva texto fora da tool.

CRITÉRIOS, DESCRIÇÕES E RUBRICAS (use a descrição para entender o que cada critério mede e use exatamente as faixas para pontuar):

${buildCriteriaPromptSection()}

REGRA OBRIGATÓRIA PARA FANTASY_NOBILITY:
Obras ambientadas majoritariamente em corte, aristocracia, realeza, império, ducado, nobreza ou famílias nobres devem receber nota alta quando esse ambiente organiza a premissa e os conflitos. Se a obra combina nobreza/realeza com reencarnação, transmigração, isekai, regressão, segunda chance ou viagem no tempo, trate isso como evidência estrutural forte: em geral use 7-8, ou 9-10 se política nobre, magia, regras do mundo ou hierarquia social definirem a história. Não deixe em 4-6 quando a ambientação de nobreza/realeza for central.

REGRA PARA ADULT_CONTENT:
Pontue adult_content com base em sinopse, tags (especialmente do grupo "content_indicator"), gêneros e reviews compatíveis. Use 9-10 se sinopse, tags ou reviews indicarem smut/sexo explícito recorrente. Marcador R19 disponível na obra é evidência POSITIVA de conteúdo adulto mesmo sem corroboração de tag/review — aplique o princípio "ausência de evidência ≠ ausência".

REGRA PARA COUPLE_DYNAMICS (leia com atenção):
Couple_dynamics é avaliada pelo RESULTADO EMOCIONAL do casal na obra, NÃO pela forma da dinâmica. Tags como BDSM, Femdom, Dom/Sub, Master-Pet, posse, ciúme intenso, "Yandere ML/FL", "Masochistic ML", "Submissive ML/FL", "Crazy ML/FL" NÃO determinam automaticamente 0-3. Antes de pontuar, avalie:
(a) há CONSENSO mútuo entre os parceiros na dinâmica retratada?
(b) ambos demonstram SATISFAÇÃO/prazer na dinâmica conforme o desenvolvimento?
(c) o TOM geral indicado por sinopse/tags/reviews é romântico, cômico, fluffy — ou angustiante, sofrido, abusivo?
Dinâmica não-tradicional + consensual + tom romântico/cômico/fluffy → faixa 7-8 ou 9-10 (relação saudável dentro da dinâmica que ambos escolheram).
Reserve 0-3 para abuso real (manipulação contra a vontade do outro, sofrimento ativo do parceiro abusado, controle não-consensual) presente NO DESENVOLVIMENTO. Tropes "dark romance" com consenso retratado ou comédia BDSM ficam em 7-8/9-10, NÃO em 0-3.

REGRA OBRIGATÓRIA PARA TRAGEDY (leia com atenção):
Considere tragédia apenas o que ocorre NO DESENVOLVIMENTO (meio da obra), não o cenário inicial nem o background.
EVITE citar na justificativa: infância, traumas passados, abandono/traição pré-história, premissa de revenge, regressão/segunda chance, transmigração ou qualquer fato anterior ao início da narrativa. Esses fatos podem indicar tom da obra, mas não devem ser usados como argumento direto para a nota de tragedy nem aparecer listados na justificativa.
Se não houver eventos trágicos ativos no desenvolvimento, atribua nota baixa (0-3) e justifique com algo como "sem eventos trágicos ativos no desenvolvimento principal" — sem detalhar o background.
Nota alta (7-10) só quando há perdas, separações, mortes, conflitos prolongados ou sofrimento que acontecem no meio da obra e impactam os personagens principais.
Não infira tragédia ativa a partir de premissas tristes ou tropes de revenge/segunda chance.

AVALIE O DESENVOLVIMENTO, NÃO O PONTO DE PARTIDA (generaliza pra couple_dynamics e romance):
- COUPLE_DYNAMICS: se a premissa coloca FL e ML como inimigos, rivais, contratantes hostis, transmigrada/regressora com ressentimento, casamento arranjado tenso — ou qualquer dinâmica negativa INICIAL que evolui ao longo da obra para parceria/romance — avalie pelo ESTADO PREDOMINANTE do desenvolvimento, não pela cena inicial. "Enemies to lovers" não é couple_dynamics 0-3; é 7-8/9-10 quando o arco é eles se entendendo e amadurecendo a relação.
- ROMANCE: "slow burn" é um TROPO POSITIVO indicando romance core com desenvolvimento gradual. NÃO rebaixe romance para subplot só por ser slow burn. Se a obra tem foco romântico claro (mesmo que desenvolvimento gradual), está em 7-8 (Core romance). Subplot (4-6) é sobre QUANTO FOCO recebe na narrativa, não sobre velocidade do desenvolvimento romântico.`

// ============================================================================
// Structured output: tool definition + Zod payload schema
// ============================================================================

const CRITERION_SLUG_ENUM = [...CRITERION_SLUGS] as string[]

const EVALUATION_TOOL = {
  name: "submit_evaluation",
  description:
    "Retorna a avaliação estruturada da obra. Use SEMPRE esta tool para responder; não escreva texto livre fora dela.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "Avaliação geral em 2-3 frases em português, citando o título fornecido apenas.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Confiança da avaliação (0 a 1). Baixa quando sinopse/reviews são insuficientes.",
      },
      scores: {
        type: "array",
        minItems: CRITERION_SLUGS.length,
        maxItems: CRITERION_SLUGS.length,
        items: {
          type: "object",
          properties: {
            criterion: { type: "string", enum: CRITERION_SLUG_ENUM },
            score: { type: "number", minimum: 0, maximum: 10 },
            justification: {
              type: "string",
              description:
                "Justificativa citando a faixa escolhida (ex.: 'Faixa 7-8 (Core Romance): ...'). Ao usar reviews, refira-se ao consenso de forma genérica (ex.: 'leitores concordam que…'); nunca cite reviews individuais nem IDs.",
            },
          },
          required: ["criterion", "score", "justification"],
        },
      },
      reviewsRejectedReason: {
        type: "string",
        description:
          "OBRIGATÓRIO quando reviews foram fornecidas mas você decidiu não usar NENHUMA. Explique especificamente por quê (ex.: 'reviews descrevem obra diferente — personagens X e Y não aparecem na sinopse'). Deixe vazio se usou pelo menos uma review.",
      },
    },
    required: ["summary", "confidence", "scores"],
  },
} satisfies Anthropic.Messages.Tool

const evaluationToolPayloadSchema = z.object({
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  scores: z.array(
    z.object({
      criterion: z.string(),
      score: z.number().min(0).max(10),
      justification: z.string(),
    })
  ),
  reviewsRejectedReason: z.string().optional(),
})

type EvaluationToolPayload = z.infer<typeof evaluationToolPayloadSchema>

// ============================================================================
// Review preparation (dedup + sentence-aware truncation + stable IDs)
// ============================================================================

function reviewTextFingerprint(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 4)
  )
}

function jaccardReviews(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const intersection = [...a].filter((w) => b.has(w)).length
  return intersection / new Set([...a, ...b]).size
}

function deduplicateReviews<T extends { text: string }>(reviews: T[]): T[] {
  const fingerprints: Array<Set<string>> = []
  const shortKeys = new Set<string>()
  return reviews.filter((r) => {
    const fp = reviewTextFingerprint(r.text)
    if (fp.size < 4) {
      const key = r.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60)
      if (shortKeys.has(key)) return false
      shortKeys.add(key)
      fingerprints.push(fp)
      return true
    }
    const isDup = fingerprints.some((existing) => jaccardReviews(fp, existing) >= 0.75)
    if (!isDup) {
      fingerprints.push(fp)
      return true
    }
    return false
  })
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Trunca uma review por fronteira de sentença, preservando o início + a última
 * sentença (com " […] " no meio) quando há material remanescente. Mantém
 * sentenças inteiras — nunca corta no meio. Budget em palavras (~120 default).
 */
function truncateReviewByWords(text: string, maxWords = MAX_REVIEW_WORDS): string {
  const total = countWords(text)
  if (total <= maxWords) return text.trim()

  const sentences = text.trim().split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
  if (sentences.length === 0) {
    const words = text.trim().split(/\s+/).slice(0, maxWords)
    return `${words.join(" ")} […]`
  }

  // Reserva ~20% do budget para a sentença final (preservar conclusão).
  const tailReserve = Math.min(Math.floor(maxWords * 0.2), countWords(sentences[sentences.length - 1]))
  const headBudget = Math.max(maxWords - tailReserve, Math.floor(maxWords * 0.6))

  const head: string[] = []
  let used = 0
  let lastUsedIndex = -1
  for (let i = 0; i < sentences.length; i++) {
    const sw = countWords(sentences[i])
    if (used + sw > headBudget) break
    head.push(sentences[i])
    used += sw
    lastUsedIndex = i
  }
  if (head.length === 0) {
    head.push(sentences[0])
    used = countWords(sentences[0])
    lastUsedIndex = 0
  }

  const remaining = sentences.slice(lastUsedIndex + 1)
  if (remaining.length === 0) return head.join(" ")

  // Adiciona a última sentença quando ela cabe no orçamento restante.
  const last = remaining[remaining.length - 1]
  const lastWords = countWords(last)
  if (lastWords <= Math.max(maxWords - used, tailReserve) && remaining.length >= 1) {
    return `${head.join(" ")} […] ${last}`
  }
  return `${head.join(" ")} […]`
}

interface PreparedReviews {
  /** Reviews depois de dedup, na ordem em que aparecem no prompt. */
  sourcedReviews: SourcedReview[] | null
  legacyReviews: string[] | null
  /** R1, R2, … coerentes com a numeração efetivamente usada no prompt. */
  ids: string[]
}

function prepareReviews(req: AiEvaluationRequest): PreparedReviews {
  if (req.sourcedReviews?.length) {
    const deduped = deduplicateReviews(req.sourcedReviews)
    return {
      sourcedReviews: deduped,
      legacyReviews: null,
      ids: deduped.map((_, i) => `R${i + 1}`),
    }
  }
  if (req.reviews?.length) {
    const deduped = deduplicateReviews(req.reviews.map((text) => ({ text }))).map(
      (r) => r.text
    )
    return {
      sourcedReviews: null,
      legacyReviews: deduped,
      ids: deduped.map((_, i) => `R${i + 1}`),
    }
  }
  return { sourcedReviews: null, legacyReviews: null, ids: [] }
}

// ============================================================================
// R19 detection
// ============================================================================

const R19_REGEX = /(?:^|[^a-z0-9])R\s*-?\s*19(?:[^a-z0-9]|$)/i
const R15_REGEX = /(?:^|[^a-z0-9])R\s*-?\s*15(?:[^a-z0-9]|$)/i

const ADULT_GENRE_KEYWORDS = ["adult", "smut", "mature", "hentai", "ecchi"]
const ADULT_SYNOPSIS_KEYWORDS = [
  "explicit",
  "explícito",
  "smut",
  "erotic",
  "erótic",
  "sexual",
  "nsfw",
]
const ADULT_TAG_GROUP = "content_indicator"

/** Strings de evidência onde um marcador R-rating pode aparecer (sinopse, gêneros,
 *  tags, contexto externo e reviews). */
function collectRatingEvidence(req: AiEvaluationRequest): string[] {
  const tags = normalizeTags(req.tags)
  return [
    req.synopsis ?? "",
    ...(req.genres ?? []),
    ...tags.map((t) => t.name),
    ...(req.externalContext ?? []),
    ...(req.sourcedReviews?.map((review) => review.text) ?? []),
    ...(req.reviews ?? []),
  ]
}

/**
 * Evidência tipo "R15 but Based on a R19 Novel": menciona R15 E R19 na mesma
 * string. Aqui o R19 se refere ao NOVEL original, não à obra avaliada (que é
 * R15). NÃO deve acionar o piso do R19 — trata-se com um piso menor
 * ([R15_FROM_R19_FLOOR]).
 */
function isR15FromR19(text: string): boolean {
  return R15_REGEX.test(text) && R19_REGEX.test(text)
}

function detectR15FromR19(req: AiEvaluationRequest): boolean {
  return collectRatingEvidence(req).some(isR15FromR19)
}

/**
 * Detecção R19 em duas camadas:
 *  - "weak" → regex match em qualquer evidência (sugestiva). Aciona piso 6.0.
 *  - "strong" → regex match + corroboração: tag do grupo content_indicator,
 *    gênero adulto explícito ou keyword adulta na sinopse. Aciona piso 7.0.
 *
 * Evidências "R15 ... R19 ... novel" são EXCLUÍDAS do haystack: o R19 ali é do
 * novel original, não da obra. Sem isso, a tag "R15 but Based on a R19 Novel"
 * disparava o piso 7 indevidamente.
 */
function detectR19(req: AiEvaluationRequest): "none" | "weak" | "strong" {
  const synopsis = req.synopsis ?? ""
  const tags = normalizeTags(req.tags)
  const haystack = collectRatingEvidence(req)
    .filter((text) => !isR15FromR19(text))
    .join("\n")

  if (!R19_REGEX.test(haystack)) return "none"

  const hasContentIndicatorTag = tags.some((t) => t.group === ADULT_TAG_GROUP)
  const genresLower = (req.genres ?? []).map((g) => g.toLowerCase())
  const hasAdultGenre = genresLower.some((g) =>
    ADULT_GENRE_KEYWORDS.some((kw) => g.includes(kw))
  )
  const synopsisLower = synopsis.toLowerCase()
  const hasAdultKeyword = ADULT_SYNOPSIS_KEYWORDS.some((kw) =>
    synopsisLower.includes(kw)
  )

  return hasContentIndicatorTag || hasAdultGenre || hasAdultKeyword
    ? "strong"
    : "weak"
}

function hasR19Marker(req: AiEvaluationRequest): boolean {
  return detectR19(req) === "strong"
}

// Piso de adult_content para obras R15 derivadas de novel R19 (a obra em si é
// R15 — conteúdo maduro mas não explícito). Menor que os pisos do R19 (6/7).
const R15_FROM_R19_FLOOR = 4

// Piso mínimo de adult_content por classificação de conteúdo das fontes externas
// (MangaDex/ComicK). "safe" não tem piso. "pornographic" (só MangaDex) fica acima
// de "erotica". Análogo à regra do R19 — garante que conteúdo marcado como adulto
// na fonte não receba nota baixa por falta de menção em sinopse/reviews.
const CONTENT_RATING_FLOORS: Record<string, number> = {
  suggestive: 5,
  erotica: 7,
  pornographic: 8,
}

/**
 * Maior piso de adult_content implicado pelos content ratings das fontes aceitas.
 * Quando várias fontes divergem (ex.: MangaDex "suggestive" + ComicK "erotica"),
 * vence o mais restritivo. Retorna null quando nenhuma classificação aciona piso.
 */
function detectContentRatingFloor(
  req: AiEvaluationRequest
): { floor: number; rating: string } | null {
  let best: { floor: number; rating: string } | null = null
  for (const raw of req.contentRatings ?? []) {
    const rating = raw.toLowerCase().trim()
    const floor = CONTENT_RATING_FLOORS[rating]
    if (floor != null && (best === null || floor > best.floor)) {
      best = { floor, rating }
    }
  }
  return best
}

// ============================================================================
// User prompt
// ============================================================================

function buildUserPrompt(req: AiEvaluationRequest, prepared: PreparedReviews): string {
  const r19Level = detectR19(req)
  const r15FromR19 = detectR15FromR19(req)
  const lines: string[] = [
    `Título oficial da obra a avaliar: "${req.title}"`,
    "(use SOMENTE este título nas suas respostas)",
  ]

  if (req.coverUrl) {
    lines.push(
      `\nUma imagem da capa primary foi anexada antes deste prompt. Use-a como sinal AUXILIAR conforme a seção "USO DA CAPA" do system prompt.`
    )
  }

  const synopsis = req.synopsis?.trim() ?? ""
  const hasExternalContext = (req.externalContext?.length ?? 0) > 0
  if (req.synopsisIsManual && synopsis) {
    lines.push(`\nSinopse (escrita/editada manualmente pelo usuário — autoridade máxima sobre a obra):\n${synopsis}`)
  } else if (synopsis) {
    lines.push(
      hasExternalContext
        ? `\nSinopse principal cadastrada/selecionada pelo usuário (use como referência principal; os blocos [C1]…[Cn] abaixo são complemento):\n${synopsis}`
        : `\nSinopse:\n${synopsis}`
    )
  } else if (!synopsis && !hasExternalContext) {
    lines.push(
      `\nSinopse: (não fornecida — baseie-se em gêneros, tags e reviews compatíveis; mantenha confidence baixa)`
    )
  } else {
    lines.push(
      `\nSinopse: (não fornecida explicitamente — use os blocos [C1]…[Cn] de contexto externo abaixo como sinopse principal)`
    )
  }

  if (req.genres?.length) {
    lines.push(`\nGêneros (todos os gêneros cadastrados): ${req.genres.join(", ")}`)
  }

  const normalizedTags = normalizeTags(req.tags)
  if (normalizedTags.length) {
    const grouped = groupTagsByGroup(normalizedTags)
    const blocks = grouped
      .map(({ group, names }) => `- ${group ?? "(sem grupo)"}: ${names.join(", ")}`)
      .join("\n")
    lines.push(`\nTags por grupo (use o grupo como sinal de a qual critério a tag mais contribui):\n${blocks}`)
  }

  if (req.externalContext?.length) {
    lines.push(
      `\nContexto externo aceito para complementar a avaliação (sinopses/metadados de fontes com título compatível):`
    )
    req.externalContext.forEach((context, index) => {
      lines.push(`[C${index + 1}] ${context}`)
    })
  }

  const validPlatformRatings = (req.platformRatings ?? []).filter(
    (r) => typeof r.rating === "number" || typeof r.votes === "number"
  )
  if (validPlatformRatings.length) {
    const items = validPlatformRatings.map((r) => {
      const name = PLATFORM_DISPLAY_NAMES[r.platform] ?? r.platform
      const parts: string[] = []
      if (typeof r.rating === "number") parts.push(`${r.rating.toFixed(1)}/10`)
      if (typeof r.votes === "number") parts.push(`${formatVotes(r.votes)} votos`)
      return `- ${name}: ${parts.join(", ")}`
    })
    lines.push(
      `\nAvaliações em plataformas externas (use como sinal AUXILIAR de recepção/popularidade — NÃO como autoridade sobre conteúdo temático; não infira critérios temáticos como romance ou drama diretamente do valor numérico):\n${items.join("\n")}`
    )
  }

  const validSimilar = (req.similarWorks ?? []).filter((s) => s.title.trim().length > 0)
  if (validSimilar.length) {
    const items = validSimilar.map((s, index) => {
      const sourcesLabel = s.sources.length > 1 ? `${s.sources.length} fontes` : `1 fonte`
      const parts: string[] = [`"${s.title}"`]
      if (s.genres.length) parts.push(`gêneros: ${s.genres.slice(0, 5).join(", ")}`)
      if (s.tags?.length) parts.push(`tags: ${s.tags.slice(0, 5).join(", ")}`)
      return `[S${index + 1}] ${parts.join(" — ")} (consenso: ${sourcesLabel})`
    })
    lines.push(
      `\nObras frequentemente recomendadas a quem gostou desta (sinal estrutural de cluster temático — NÃO copie eventos de plot destas obras; use apenas como dica sobre tom, ritmo e temas predominantes):\n${items.join("\n")}`
    )
  }

  if (r19Level === "strong") {
    lines.push(
      `\nMarcador R19 detectado nas evidências com corroboração (tag content_indicator, gênero adulto ou termo explícito na sinopse). Para adult_content, aplique a regra obrigatória: nota mínima 7.0.`
    )
  } else if (r19Level === "weak") {
    lines.push(
      `\nMarcador R19 encontrado em alguma evidência, sem corroboração explícita de tag/gênero/termo adulto. A presença do marcador é, ainda assim, evidência POSITIVA de conteúdo adulto — reviews/tags podem simplesmente não ter mencionado. Aplique o princípio "ausência de evidência ≠ ausência": adult_content tem nota mínima 6.0. Pode subir mais conforme outras evidências.`
    )
  } else if (r15FromR19) {
    lines.push(
      `\nAtenção: há a marcação "R15 but Based on a R19 Novel". O "R19" aqui se refere ao NOVEL original — a OBRA avaliada é R15 (conteúdo maduro, mas não explícito). NÃO trate isso como conteúdo adulto explícito: adult_content tem nota mínima 4.0 (não o piso do R19), podendo subir só se outras evidências (tags/reviews/sinopse) indicarem conteúdo sexual de fato.`
    )
  }

  if (prepared.sourcedReviews?.length) {
    const withIds = prepared.sourcedReviews.map((r, i) => ({ r, id: prepared.ids[i] }))
    const manual = withIds.filter((x) => x.r.isManual)
    const external = withIds.filter((x) => !x.r.isManual)

    if (manual.length) {
      lines.push(
        `\nReviews fornecidas por você sobre esta obra (evidência DIRETA e confiável — descrevem a obra avaliada; NÃO precisa verificar se é a mesma obra):`
      )
      manual.forEach(({ r, id }) => {
        const ratingLabel = r.userRating != null ? ` (nota do usuário: ${r.userRating}/10)` : ""
        lines.push(`[${id}]${ratingLabel}\n${truncateReviewByWords(r.text)}`)
      })
    }

    if (external.length) {
      lines.push(
        `\nReviews de usuários externas (buscadas por similaridade de título — VERIFIQUE se descrevem a mesma obra antes de usar):`
      )
      external.forEach(({ r, id }) => {
        const matchPct = Math.round(r.matchScore * 100)
        const ratingLabel = r.userRating != null ? `, nota do usuário: ${r.userRating}/10` : ""
        lines.push(
          `[${id}] (fonte: ${r.source}, match com o título: ${matchPct}%${ratingLabel}, título-fonte: "${r.sourceTitle}")\n${truncateReviewByWords(r.text)}`
        )
      })
      lines.push(
        `\nLembrete: se uma review externa acima descrever uma obra DIFERENTE da sinopse fornecida, IGNORE-a completamente. Se não houver conflito claro, use a review como evidência auxiliar.`
      )
    }

    lines.push(
      `Instrução obrigatória: para cada nota, pese o CONSENSO dessas reviews (sinais recorrentes/convergentes) junto com sinopse/tags/gêneros — NÃO ancore nenhuma nota numa review isolada. Ao mencioná-las na justificativa, use linguagem genérica de consenso ("segundo os leitores…", "há consenso de que…"); NUNCA cite reviews individuais nem IDs.`
    )
  } else if (prepared.legacyReviews?.length) {
    lines.push(
      `\nReviews de usuários externas:\n${prepared.legacyReviews
        .map((review, index) => `[${prepared.ids[index]}] ${truncateReviewByWords(review)}`)
        .join("\n")}`
    )
    lines.push(
      `Instrução obrigatória: para cada nota, pese o CONSENSO dessas reviews (sinais recorrentes/convergentes) junto com sinopse/tags/gêneros — NÃO ancore nenhuma nota numa review isolada. Ao mencioná-las na justificativa, use linguagem genérica de consenso ("segundo os leitores…", "há consenso de que…"); NUNCA cite reviews individuais nem IDs.`
    )
  } else {
    lines.push(`\nReviews de usuários externas: nenhuma review externa compatível foi encontrada.`)
  }

  lines.push(
    `\nAvalie a obra "${req.title}" com base nas rubricas do sistema. Use todos os gêneros e todas as tags fornecidas. Use o CONSENSO das reviews externas compatíveis como evidência auxiliar, referindo-se a elas de forma genérica (nunca a uma review isolada ou ID). Use apenas evidências presentes nos dados fornecidos; não invente eventos de plot. Retorne todos os 9 critérios pela tool "submit_evaluation". No "summary", refira-se à obra apenas como "${req.title}".`
  )

  if (CONCISE_OUTPUT) {
    lines.push(
      `\nFORMATO DAS JUSTIFICATIVAS (conciso): no MÁXIMO 2 frases curtas por critério — vá direto à evidência decisiva, sem reexplicar a rubrica nem o que o critério mede. OBRIGATÓRIO manter a citação da faixa (ex.: "Faixa 7-8"). Ao usar reviews, refira-se ao consenso de forma genérica (nunca a uma review isolada ou ID). O "summary" também deve ficar em no máximo 2 frases.`
    )
  }

  return lines.join("\n")
}

// ============================================================================
// Response post-processing
// ============================================================================

function rawObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : { value }
}

function normalizeReviewId(value: unknown): string | null {
  const match = String(value).trim().toUpperCase().match(/R?\s*\[?(\d+)\]?/)
  if (!match) return null
  return `R${Number(match[1])}`
}

function extractUsedReviewIds(rawResponse: unknown): string[] {
  const raw = rawObject(rawResponse)
  const usage = raw.review_usage
  if (!Array.isArray(usage)) return []

  const ids = new Set<string>()
  for (const entry of usage) {
    if (typeof entry !== "object" || entry === null) continue
    const usedReviewIds = (entry as Record<string, unknown>).usedReviewIds
    if (!Array.isArray(usedReviewIds)) continue

    for (const id of usedReviewIds) {
      const normalized = normalizeReviewId(id)
      if (normalized) ids.add(normalized)
    }
  }

  return [...ids]
}

function buildResponseFromToolPayload(
  payload: EvaluationToolPayload,
  title: string,
  modelName: string,
  inputHash: string
): AiEvaluationResponse {
  const scoreMap: Record<string, { score: number; justification: string }> = {}
  for (const s of payload.scores) {
    scoreMap[s.criterion] = {
      score: Math.max(0, Math.min(10, s.score)),
      justification: s.justification ?? "",
    }
  }

  const scores = CRITERION_SLUGS.map((slug) => ({
    criterionSlug: slug,
    suggestedScore: scoreMap[slug]?.score ?? 5,
    justification: scoreMap[slug]?.justification ?? "Não avaliado.",
  }))

  return {
    modelName,
    promptVersion: PROMPT_VERSION,
    summary: payload.summary || `Avaliação de "${title}" concluída.`,
    confidence: Math.max(0, Math.min(1, payload.confidence)),
    reviewsUsed: 0,
    scores,
    rawResponse: payload,
    inputHash,
  }
}

function enforceR19AdultContentRule(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest
): AiEvaluationResponse {
  const level = detectR19(req)
  if (level === "none") return response

  const floor = level === "strong" ? 7 : 6

  return {
    ...response,
    scores: response.scores.map((score) => {
      if (score.criterionSlug !== "adult_content" || score.suggestedScore >= floor) {
        return score
      }
      const reason =
        level === "strong"
          ? `Marcador R19 corroborado por tag/gênero/termo adulto; pela regra obrigatória, adult_content não pode ficar abaixo de 7.0.`
          : `Marcador R19 detectado na sinopse/tags/reviews; presença do marcador é evidência positiva de conteúdo adulto, adult_content não pode ficar abaixo de 6.0.`
      return {
        ...score,
        suggestedScore: floor,
        justification: score.justification.includes("R19") ? score.justification : `${score.justification} ${reason}`,
      }
    }),
    rawResponse: {
      ...rawObject(response.rawResponse),
      r19AdultContentRuleApplied: true,
      r19AdultContentLevel: level,
    },
  }
}

/**
 * Obras "R15 but Based on a R19 Novel": a obra avaliada é R15 (o R19 é do novel
 * original). Aplica piso 4 a adult_content — em vez do piso 7 que a menção de R19
 * acionaria. Monotônica, então compõe com as demais regras pelo MAIOR piso (se
 * houver R19 real ou content rating adulto por outra evidência, esses prevalecem).
 */
function enforceR15FromR19AdultContentRule(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest
): AiEvaluationResponse {
  if (!detectR15FromR19(req)) return response
  const floor = R15_FROM_R19_FLOOR

  return {
    ...response,
    scores: response.scores.map((score) => {
      if (score.criterionSlug !== "adult_content" || score.suggestedScore >= floor) {
        return score
      }
      const reason = `Tag "R15 but Based on a R19 Novel": a obra é R15 (o R19 é do novel original); adult_content tem piso ${floor.toFixed(1)}, não o piso do R19.`
      return {
        ...score,
        suggestedScore: floor,
        justification: score.justification.includes("R15") ? score.justification : `${score.justification} ${reason}`,
      }
    }),
    rawResponse: {
      ...rawObject(response.rawResponse),
      r15FromR19RuleApplied: true,
      r15FromR19Floor: floor,
    },
  }
}

/**
 * Eleva o piso de adult_content conforme a classificação de conteúdo das fontes
 * externas aceitas (MangaDex/ComicK): suggestive→5, erotica→7, pornographic→8.
 * Monotônica (só sobe), então compõe com a regra do R19: encadeadas, o resultado
 * final é o MAIOR piso acionado entre as duas.
 */
function enforceExternalContentRatingRule(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest
): AiEvaluationResponse {
  const detected = detectContentRatingFloor(req)
  if (!detected) return response
  const { floor, rating } = detected

  return {
    ...response,
    scores: response.scores.map((score) => {
      if (score.criterionSlug !== "adult_content" || score.suggestedScore >= floor) {
        return score
      }
      const reason = `Fonte externa classifica o conteúdo como "${rating}"; pela regra obrigatória, adult_content não pode ficar abaixo de ${floor.toFixed(1)}.`
      return {
        ...score,
        suggestedScore: floor,
        justification: score.justification.includes("classifica o conteúdo")
          ? score.justification
          : `${score.justification} ${reason}`,
      }
    }),
    rawResponse: {
      ...rawObject(response.rawResponse),
      externalContentRatingRuleApplied: true,
      externalContentRatingFloor: floor,
      externalContentRating: rating,
    },
  }
}

/**
 * Quando romance é baixo (≤ 3), couple_dynamics é forçado a 5.0 — tanto pra
 * cima (modelo deu nota baixa por "ausência de casal") quanto pra baixo (modelo
 * alucinou dinâmica saudável sem evidência de casal). 5.0 sinaliza "não aplicável".
 */
function enforceNeutralCoupleDynamicsWhenNoRomance(
  response: AiEvaluationResponse
): AiEvaluationResponse {
  const romance = response.scores.find((score) => score.criterionSlug === "romance")
  const couple = response.scores.find((score) => score.criterionSlug === "couple_dynamics")

  if (!romance || !couple || romance.suggestedScore > 3 || couple.suggestedScore === 5) {
    return response
  }

  const direction = couple.suggestedScore < 5 ? "elevada" : "rebaixada"

  return {
    ...response,
    scores: response.scores.map((score) => {
      if (score.criterionSlug !== "couple_dynamics") return score
      return {
        ...score,
        suggestedScore: 5,
        justification: score.justification.includes("critério não é aplicável")
          ? score.justification
          : `${score.justification} Como a avaliação de romance indica ausência/irrelevância de casal, couple_dynamics foi ${direction} para 5.0 (não aplicável).`,
      }
    }),
    rawResponse: {
      ...rawObject(response.rawResponse),
      neutralCoupleDynamicsRuleApplied: true,
    },
  }
}

const SYNOPSIS_MIN_CHARS = 50
const LOW_EVIDENCE_CONFIDENCE_CAP = 0.55
// Reviews TAMBÉM são evidência: um punhado de reviews substantivas dá base pra o
// modelo pontuar com confiança acima do teto mesmo sem sinopse. Sem contar reviews,
// uma obra de sinopse fraca mas bem-comentada era rebaixada a 0.55 à toa.
const SUBSTANTIVE_REVIEW_MIN_CHARS = 80
const MIN_SUBSTANTIVE_REVIEWS = 3

function enforceConfidenceCapWhenLowEvidence(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest
): AiEvaluationResponse {
  const synopsisLength = (req.synopsis ?? "").trim().length
  const hasExternalContext = (req.externalContext?.length ?? 0) > 0
  const substantiveReviews = (req.sourcedReviews ?? []).filter(
    (r) => (r.text?.trim().length ?? 0) >= SUBSTANTIVE_REVIEW_MIN_CHARS,
  ).length
  const hasReviewEvidence = substantiveReviews >= MIN_SUBSTANTIVE_REVIEWS
  // "Baixa evidência" = sinopse curta E sem contexto externo E sem reviews
  // substantivas. Só então o teto de confiança se aplica.
  const lowEvidence =
    synopsisLength < SYNOPSIS_MIN_CHARS && !hasExternalContext && !hasReviewEvidence

  if (!lowEvidence) return response
  if (response.confidence <= LOW_EVIDENCE_CONFIDENCE_CAP) return response

  return {
    ...response,
    confidence: LOW_EVIDENCE_CONFIDENCE_CAP,
    rawResponse: {
      ...rawObject(response.rawResponse),
      confidenceCapWhenLowEvidenceApplied: true,
      confidenceBeforeCap: response.confidence,
    },
  }
}

function enforceAuditableReviewUsage(
  response: AiEvaluationResponse,
  prepared: PreparedReviews
): AiEvaluationResponse {
  if (prepared.ids.length === 0) {
    return {
      ...response,
      rawResponse: {
        ...rawObject(response.rawResponse),
        reviewAudit: {
          required: false,
          passed: true,
          reason: "Nenhuma review externa foi encontrada para incluir no prompt.",
        },
      },
    }
  }

  // Citação GENÉRICA de reviews é aceita (decisão de produto 2026-06-27): não
  // exigimos mais IDs específicos (R1, R2…) nem rejeitamos a avaliação por falta
  // deles / por inconsistência de citação. Apenas registramos, de forma
  // INFORMATIVA, quais IDs válidos o modelo por acaso citou — nunca joga.
  const expected = new Set(prepared.ids)
  const usedReviewIds = extractUsedReviewIds(response.rawResponse).filter((id) => expected.has(id))
  return {
    ...response,
    rawResponse: {
      ...rawObject(response.rawResponse),
      reviewAudit: {
        // required = "havia reviews no prompt" (a UI usa isto pra contar/exibir).
        // NÃO significa mais "exigir IDs" — a auditoria por ID foi desativada
        // (citação genérica aceita); só não jogamos mais.
        required: true,
        passed: true,
        expectedReviewIds: prepared.ids,
        usedReviewIds,
        reviewsDeclinedByModel: usedReviewIds.length === 0,
        reason: "Auditoria por ID desativada — citação genérica de reviews é aceita.",
      },
    },
  }
}

function attachEvaluationContext(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest,
  prepared: PreparedReviews
): AiEvaluationResponse {
  const normalizedTags = normalizeTags(req.tags)
  const expected = new Set(prepared.ids)
  const usedReviewIds = extractUsedReviewIds(response.rawResponse).filter((id) => expected.has(id))
  return {
    ...response,
    reviewsUsed: usedReviewIds.length,
    rawResponse: {
      ...rawObject(response.rawResponse),
      evaluationContext: {
        title: req.title,
        synopsis: req.synopsis ?? null,
        synopsisIsManual: req.synopsisIsManual ?? false,
        synopsisOmittedFromPrompt: false,
        genres: req.genres ?? [],
        tagsGrouped: groupTagsByGroup(normalizedTags),
        genresCount: req.genres?.length ?? 0,
        tagsCount: req.tags?.length ?? 0,
        sourcedReviewsCount: req.sourcedReviews?.length ?? 0,
        legacyReviewsCount: req.reviews?.length ?? 0,
        sourcedReviewsAfterDedup: prepared.sourcedReviews?.length ?? 0,
        legacyReviewsAfterDedup: prepared.legacyReviews?.length ?? 0,
        externalContextCount: req.externalContext?.length ?? 0,
        reviewsIncludedInPrompt: prepared.ids.length > 0,
        externalContext: req.externalContext ?? [],
        sourcedReviews:
          prepared.sourcedReviews?.map((review, index) => ({
            id: prepared.ids[index] ?? `R${index + 1}`,
            source: review.source,
            sourceTitle: review.sourceTitle,
            matchScore: review.matchScore,
            text: review.text,
            userRating: review.userRating,
          })) ?? [],
        legacyReviews:
          prepared.legacyReviews?.map((text, index) => ({
            id: prepared.ids[index] ?? `R${index + 1}`,
            text,
          })) ?? [],
        r19Detected: hasR19Marker(req),
        r19Level: detectR19(req),
        r15FromR19Detected: detectR15FromR19(req),
        contentRatingFloor: detectContentRatingFloor(req),
        coverUrlSentToModel: req.coverUrl ?? null,
      },
    },
  }
}

function postProcessEvaluation(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest,
  prepared: PreparedReviews
): AiEvaluationResponse {
  return attachEvaluationContext(
    enforceAuditableReviewUsage(
      enforceConfidenceCapWhenLowEvidence(
        enforceNeutralCoupleDynamicsWhenNoRomance(
          enforceExternalContentRatingRule(
            enforceR15FromR19AdultContentRule(enforceR19AdultContentRule(response, req), req),
            req
          )
        ),
        req
      ),
      prepared
    ),
    req,
    prepared
  )
}

// ============================================================================
// In-memory hash cache (Sprint 1; persistir em ai_evaluations fica para Sprint 2)
// ============================================================================

const CACHE_TTL_MS = 30 * 60 * 1000
const CACHE_MAX_ENTRIES = 200

interface CacheEntry {
  response: AiEvaluationResponse
  expiresAt: number
}

const evaluationCache = new Map<string, CacheEntry>()

function canonicalInputHash(req: AiEvaluationRequest): string {
  const normalizedTags = normalizeTags(req.tags)
    .map((t) => `${t.group ?? ""}::${t.name}`)
    .sort()
  const canonical = {
    model: req.model ?? MODEL,
    promptVersion: PROMPT_VERSION,
    title: req.title,
    synopsis: req.synopsis ?? "",
    synopsisIsManual: req.synopsisIsManual ?? false,
    genres: [...(req.genres ?? [])].sort(),
    tags: normalizedTags,
    externalContext: req.externalContext ?? [],
    sourcedReviews:
      req.sourcedReviews?.map((r) => ({
        source: r.source,
        sourceTitle: r.sourceTitle,
        matchScore: Math.round(r.matchScore * 1000) / 1000,
        userRating: r.userRating ?? null,
        text: r.text,
      })) ?? [],
    reviews: req.reviews ?? [],
    coverUrl: req.coverUrl ?? null,
    contentRatings: [...(req.contentRatings ?? [])].map((r) => r.toLowerCase().trim()).sort(),
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

/**
 * Chave canônica V2 (dual-read): mesma semântica do legado, porém pela chave
 * central de lib/ai-cache (chaves de objeto ordenadas, null/ausente/"" distintos)
 * e incluindo `output_schema_version` no hash. Escritas novas usam ESTA chave;
 * a leitura tenta V2 e cai pra `canonicalInputHash` (legado) — o L2 persistente
 * migra pra V2 conforme as obras são reacessadas, sem invalidação em massa.
 */
function canonicalInputHashV2(req: AiEvaluationRequest): string {
  const normalizedTags = normalizeTags(req.tags)
    .map((t) => `${t.group ?? ""}::${t.name}`)
    .sort()
  return buildCacheKey({
    operation: "ai_evaluation",
    model: req.model ?? MODEL,
    promptVersion: PROMPT_VERSION,
    outputSchemaVersion: EVAL_OUTPUT_SCHEMA_VERSION,
    input: {
      title: req.title,
      synopsis: req.synopsis ?? "",
      synopsisIsManual: req.synopsisIsManual ?? false,
      genres: [...(req.genres ?? [])].sort(),
      tags: normalizedTags,
      externalContext: req.externalContext ?? [],
      sourcedReviews:
        req.sourcedReviews?.map((r) => ({
          source: r.source,
          sourceTitle: r.sourceTitle,
          matchScore: Math.round(r.matchScore * 1000) / 1000,
          userRating: r.userRating ?? null,
          text: r.text,
        })) ?? [],
      reviews: req.reviews ?? [],
      coverUrl: req.coverUrl ?? null,
      contentRatings: [...(req.contentRatings ?? [])].map((r) => r.toLowerCase().trim()).sort(),
    },
  })
}

function readCache(hash: string): AiEvaluationResponse | null {
  const entry = evaluationCache.get(hash)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    evaluationCache.delete(hash)
    return null
  }
  evaluationCache.delete(hash)
  evaluationCache.set(hash, entry)
  return entry.response
}

function writeCache(hash: string, response: AiEvaluationResponse) {
  evaluationCache.set(hash, { response, expiresAt: Date.now() + CACHE_TTL_MS })
  while (evaluationCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = evaluationCache.keys().next().value
    if (oldestKey === undefined) break
    evaluationCache.delete(oldestKey)
  }
}

// ============================================================================
// DB cache lookup (L2) — usa ai_evaluations.input_hash da migration 032.
// Falhas de DB são silenciosas: cache é otimização, não fonte de verdade.
// ============================================================================

async function readDbCache(
  hash: string,
  modelName: string
): Promise<AiEvaluationResponse | null> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin")
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("ai_evaluations")
      .select("model_name, prompt_version, summary, confidence, raw_response, ai_evaluation_scores(criterion_slug, suggested_score, justification)")
      .eq("input_hash", hash)
      .eq("model_name", modelName)
      .eq("prompt_version", PROMPT_VERSION)
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null

    type ScoreRow = { criterion_slug: string; suggested_score: number | null; justification: string | null }
    const rows = (data.ai_evaluation_scores as ScoreRow[] | null) ?? []
    if (rows.length === 0) return null

    const byCriterion = new Map(rows.map((r) => [r.criterion_slug, r]))
    const scores = CRITERION_SLUGS.map((slug) => {
      const row = byCriterion.get(slug)
      return {
        criterionSlug: slug,
        suggestedScore: row?.suggested_score != null ? Number(row.suggested_score) : 5,
        justification: row?.justification ?? "Não avaliado.",
      }
    })

    const raw = data.raw_response as Record<string, unknown> | null
    const reviewAudit = raw?.reviewAudit as { usedReviewIds?: unknown[] } | undefined
    const evaluationContext = raw?.evaluationContext as { reviewsIncludedInPrompt?: boolean } | undefined
    const reviewsUsed = Array.isArray(reviewAudit?.usedReviewIds)
      ? reviewAudit.usedReviewIds.length
      : evaluationContext?.reviewsIncludedInPrompt ? 1 : 0

    return {
      modelName: data.model_name ?? modelName,
      promptVersion: data.prompt_version ?? PROMPT_VERSION,
      summary: data.summary ?? "",
      confidence: data.confidence != null ? Number(data.confidence) : 0.5,
      reviewsUsed,
      scores,
      rawResponse: raw ?? {},
      inputHash: hash,
    }
  } catch (err) {
    console.warn("[AI] readDbCache falhou — caindo pra API call:", err)
    return null
  }
}

// ============================================================================
// Provider call (chamada real + tentativas estruturadas). Extraída de
// requestAiEvaluation para rodar sob single-flight (dedup em processo). Persiste
// o resultado em `cacheKey` (V2). NÃO faz lookup de cache — quem chama já fez.
// ============================================================================

async function runEvaluationProvider(
  req: AiEvaluationRequest,
  cacheKey: string,
  logicalRequestId: string,
  workloadType: AiWorkloadType,
): Promise<AiEvaluationResponse> {
  const prepared = prepareReviews(req)
  // maxRetries: 8 absorve janelas longas de 529 "Overloaded" da Anthropic com
  // backoff exponencial automático (~90s no worst-case). Mais alto que os
  // outros callers porque a avaliação IA é a única que mostra o erro inline
  // pro usuário no meio de um batch — vale aguentar mais antes de falhar.
  const client = getAnthropicClient({ maxRetries: 8 })
  const userPrompt = buildUserPrompt(req, prepared)
  const modelToUse = req.model ?? MODEL
  let lastError: unknown = null

  // Opus 4.7 não aceita o parâmetro temperature.
  const supportsTemperature = !/opus-4-7/i.test(modelToUse)

  // Pré-busca a capa NO NOSSO servidor e envia em base64 (a Anthropic NÃO baixa a
  // URL). Elimina os 400 "Unable to download image" de hosts com Cloudflare/hotlink:
  // quando o fetch local falha, `coverImage` é null e avaliamos direto sem imagem,
  // sem desperdiçar uma primeira chamada com URL inacessível.
  const coverOutcome = req.coverUrl
    ? await fetchCoverForModelWithStatus(req.coverUrl)
    : { image: null, status: "not_requested" as AiImageStatus }
  const coverImage = coverOutcome.image

  // Rede de segurança: se o MODELO recusar a imagem (400 image/media_type/base64),
  // retentamos sem ela na mesma attempt.
  let imageFetchFailed = false

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const promptText =
      attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nA tentativa anterior retornou um payload inválido ou não usou a tool. Responda usando SEMPRE a tool "submit_evaluation", preenchendo todos os 9 critérios e os campos obrigatórios.`

    const includeImage = !!coverImage && !imageFetchFailed
    // Status da capa NESTA tentativa: enviada (fetch_success) / fallback após
    // recusa do modelo / motivo da falha de prefetch (ou not_requested).
    const imageStatusForAttempt: AiImageStatus = includeImage
      ? coverOutcome.status
      : imageFetchFailed
        ? "fallback_without_image"
        : coverOutcome.status
    const messageContent: Anthropic.Messages.ContentBlockParam[] = includeImage
      ? [
          {
            type: "image",
            source: { type: "base64", media_type: coverImage!.mediaType, data: coverImage!.data },
          },
          { type: "text", text: promptText },
        ]
      : [{ type: "text", text: promptText }]

    let message: Anthropic.Messages.Message
    try {
      const logged = await createLoggedMessage(
        client,
        {
          model: modelToUse,
          // 4500 nas duas tentativas: a saída estruturada das 9 notas +
          // justificativas + review_usage frequentemente passava de 3500 na
          // attempt 0, truncava (stop_reason="max_tokens") e forçava a 2ª
          // tentativa inteira (~2× o tempo). Subir o teto elimina esse retry
          // desperdiçado sem custo extra quando a resposta cabe.
          max_tokens: 4500,
          ...(supportsTemperature ? { temperature: attempt === 0 ? 0.2 : 0 } : {}),
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: [EVALUATION_TOOL],
          tool_choice: { type: "tool", name: EVALUATION_TOOL.name },
          messages: [{ role: "user", content: messageContent }],
        },
        {
          operation: "ai_evaluation",
          promptVersion: PROMPT_VERSION,
          workId: req.workId,
          attempt,
          logicalRequestId,
          workloadType,
          cacheStatus: "miss",
          imageStatus: imageStatusForAttempt,
          metadata: {
            hasImage: includeImage,
            hasReviews: prepared.ids.length > 0,
            isOverride: !!req.model,
          },
        },
      )
      message = logged.message
    } catch (err) {
      // Só retenta sem imagem quando o erro é COMPROVADAMENTE da imagem (400 +
      // image/media_type/base64). NÃO retenta para rate limit, auth, timeout geral,
      // indisponibilidade ou validação de resposta — esses propagam normalmente.
      if (includeImage && isImageRelatedModelError(err)) {
        console.warn(`[AI] Imagem recusada pelo modelo (400 image/media_type/base64). Retentando sem imagem.`)
        imageFetchFailed = true
        attempt -= 1
        continue
      }
      throw err
    }

    const toolUseBlock = message.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use"
    )

    if (!toolUseBlock) {
      lastError = new Error(
        message.stop_reason === "max_tokens"
          ? "Resposta da IA foi cortada por limite de tokens."
          : "Resposta da IA não usou a tool submit_evaluation."
      )
      continue
    }

    const parsed = evaluationToolPayloadSchema.safeParse(toolUseBlock.input)
    if (!parsed.success) {
      lastError = new Error(
        `Payload da tool não atende ao schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      )
      continue
    }

    try {
      const built = buildResponseFromToolPayload(parsed.data, req.title, modelToUse, cacheKey)
      const final = postProcessEvaluation(built, req, prepared)
      writeCache(cacheKey, final)
      return final
    } catch (err) {
      lastError = err
    }
  }

  console.error("[AI] Erro ao interpretar resposta:", lastError)
  // Expõe a causa REAL (schema / auditoria de reviews / max_tokens) em vez de
  // engolir num erro genérico — senão fica impossível diagnosticar pela UI.
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "desconhecida")
  throw new Error(`Erro ao interpretar resposta da IA: ${detail} Nenhuma avaliação foi salva.`)
}

// ============================================================================
// Public entry point
// ============================================================================

export async function requestAiEvaluation(
  req: AiEvaluationRequest
): Promise<AiEvaluationResponse> {
  // Observabilidade (Plano 1): 1 id por SOLICITAÇÃO lógica, compartilhado por
  // todas as tentativas físicas. workload = experiment quando há override de
  // modelo (botão "Reavaliar com…"/compare-models).
  // Nota: HITS de cache NÃO são logados (curto-circuitam antes do logger) — isso
  // evita distorcer custo/latência das linhas de provider. A taxa de hit fica
  // como item do Plano 2 (contador dedicado); aqui só marcamos as linhas que
  // foram ao provider como cache_status="miss".
  const logicalRequestId = randomUUID()
  const workloadType: AiWorkloadType = req.model ? "experiment" : "recurring"

  const cacheKey = canonicalInputHashV2(req)
  const legacyCacheKey = canonicalInputHash(req)
  // Telemetria de cache (Plano 2 §8): mede a CONSULTA (vai pra ai_cache_events),
  // não a chamada ao provider. Best-effort (fire-and-forget) — não soma latência
  // ao hit nem altera o retorno funcional. Hits aparecem SÓ aqui, nunca em
  // ai_api_calls (que segue representando tentativas do provider).
  const cacheEventBase = {
    operation: "ai_evaluation" as const,
    workloadType,
    inputHash: cacheKey,
    modelName: req.model ?? MODEL,
    promptVersion: PROMPT_VERSION,
    outputSchemaVersion: EVAL_OUTPUT_SCHEMA_VERSION,
    workId: req.workId ?? null,
    logicalRequestId,
  }

  // L1 (memória) — dual-read: chave V2, cai pro legado (migração suave do cache).
  const cached = readCache(cacheKey) ?? readCache(legacyCacheKey)
  if (cached) {
    console.info(`[AI] Cache hit (memory) para "${req.title}" (hash=${cacheKey.slice(0, 8)})`)
    recordCacheEventAsync({ ...cacheEventBase, cacheLayer: "resolution", cacheStatus: "hit_memory" })
    return { ...cached, fromCache: "memory" }
  }

  // L2 (banco) — dual-read: V2 → legado; promove o hit pra V2 na memória.
  const dbCached =
    (await readDbCache(cacheKey, req.model ?? MODEL)) ??
    (await readDbCache(legacyCacheKey, req.model ?? MODEL))
  if (dbCached) {
    console.info(`[AI] Cache hit (db) para "${req.title}" (hash=${cacheKey.slice(0, 8)})`)
    writeCache(cacheKey, dbCached)
    recordCacheEventAsync({ ...cacheEventBase, cacheLayer: "resolution", cacheStatus: "hit_persistent" })
    return { ...dbCached, fromCache: "db" }
  }

  // Miss → single-flight (plano §10): solicitações IDÊNTICAS concorrentes (mesma
  // cacheKey V2) compartilham UMA chamada ao provider em vez de pagar N vezes. O
  // double-check em memória fecha a corrida entre o lookup acima e a aquisição.
  return runSingleFlight(
    `ai_evaluation:${cacheKey}`,
    async () => {
      const recheck = readCache(cacheKey)
      if (recheck) {
        recordCacheEventAsync({ ...cacheEventBase, cacheLayer: "memory", cacheStatus: "hit_memory" })
        return { ...recheck, fromCache: "memory" as const }
      }
      recordCacheEventAsync({ ...cacheEventBase, cacheLayer: "resolution", cacheStatus: "miss_not_found" })
      return runEvaluationProvider(req, cacheKey, logicalRequestId, workloadType)
    },
    {
      // Waiter dedupado: evitou uma chamada paga ao aguardar a líder. Marcado com
      // cache_miss_reason p/ o painel separar dedup de hit de cache real.
      onWaiter: () =>
        recordCacheEventAsync({
          ...cacheEventBase,
          cacheLayer: "memory",
          cacheStatus: "hit_memory",
          cacheMissReason: "single_flight_dedup",
        }),
    },
  )
}
