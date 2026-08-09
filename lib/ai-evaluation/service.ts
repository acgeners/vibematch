import "server-only"
import { createHash, randomUUID } from "node:crypto"
import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { CRITERION_SLUGS } from "@/types/domain"
import { CRITERIA_INFO, CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { normalizeTagGroupSlug } from "@/lib/constants/tag-groups-utils"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { SONNET_MODEL } from "@/lib/ai/models"
import { coerceToolPayload } from "@/lib/ai/tool-payload"
import { fetchCoverForModelWithStatus, isImageRelatedModelError } from "@/lib/server/covers/fetch-cover-for-model"
import { recordCacheEventAsync } from "@/server/queries/ai-cache"
import { buildCacheKey } from "@/lib/ai-cache"
import {
  clampAdultContentScore,
  computeAdultContentBounds,
} from "@/lib/ai-evaluation/adult-content-rules"
import { runSingleFlight } from "@/lib/ai-cache/single-flight"
import type { AiImageStatus, AiWorkloadType } from "@/lib/ai-observability/types"
import type { SourcedReview, PlatformRating, SimilarWork } from "@/lib/external/types"

export interface AiEvaluationTag {
  name: string
  /** Slug do tag_group (ex: "content_indicator", "romance"). null/undefined quando a tag não tem grupo. */
  group?: string | null
  /** `tags.adult_score_tier` (migração 174) — piso de adult_content implicado pela
   *  tag, quando já revisado. Ver lib/ai-evaluation/adult-content-rules.ts. */
  adultScoreTier?: "label" | "explicit" | null
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
  /**
   * Sinopses adicionais PERSISTIDAS na obra (todas além da principal), já
   * deduplicadas por significado. Entram no prompt como blocos [S1]…[Sn];
   * as com `isManual` são rotuladas como escritas/editadas pelo usuário
   * (autoridade alta). Só o Caminho A (obra salva) preenche.
   */
  additionalSynopses?: Array<{ text: string; source?: string | null; isManual?: boolean }>
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
  scoreTier?: "label" | "explicit" | null
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
      return { name, group, scoreTier: tag.adultScoreTier }
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

// ── Flag de CONCISÃO — não é um rollback ────────────────────────────────────
// Output enxuto do Sonnet: justificativas curtas (≤2 frases). Corta ~30% dos
// tokens de SAÍDA (≈ -15~20s de latência) mantendo o MESMO modelo e as mesmas
// notas. Medido: a mediana da justificativa caiu de 527 pra 237 caracteres quando
// esta instrução entrou (v18 → v19), no MESMO modelo.
//
// ⚠️ Virar para `false` NÃO reverte o prompt. Sai apenas o bloco de concisão do
// prompt do USUÁRIO (ver `CONCISE_OUTPUT` mais abaixo); o SYSTEM_PROMPT inteiro
// continua o atual, então as avaliações sairiam rotuladas "v18" com a semântica
// de hoje. E os caches v18 originais (mai/2026) não voltam a ser aproveitados:
// `EVAL_OUTPUT_SCHEMA_VERSION` entra na chave de cache e mudou para "eval-2" em
// jul/2026. Para reverter de verdade é preciso restaurar o texto do prompt.
export const CONCISE_OUTPUT: boolean = true
// v25 (2026-08-09): descompressão da escala. Quatro critérios tinham colapsado numa
// faixa só — medido em 2.393 avaliações: action_adventure 73,5% em 4-6 e ZERO em 9-10;
// protagonist 77,4% em 7-8 (σ 0,87, o menos informativo dos 9); romance 73,7% em 7-8;
// fantasy_nobility 89% ≥7. Feature quase-constante não contribui nada pro Ridge da Nota
// Prevista nem discrimina no /ranking. Quatro mecanismos distintos, todos medidos:
//   · o PISO de 5 se sobrepunha à rubrica: das 1.027 justificativas de action_adventure
//     que afirmam ausência ("slice of life", "uneventful", "nada acontece"), 316 (30,8%)
//     ficaram ≥5 — a prosa citava a definição da faixa 0-3 e a nota não ia pra lá;
//   · a POSIÇÃO dentro da faixa era surda à intensidade declarada: entre notas 4–6,9, a
//     prosa com "pontual/esporádico/não domina" distribuía 31/32/35% (em 4–4,9 / 5 / >5)
//     contra 33/35/31% da prosa neutra — a palavra "pontual" não mudava o número;
//   · a REGRA OBRIGATÓRIA de fantasy_nobility virou piso: justificativa citando o gatilho
//     (reencarnação/regressão/isekai) → 97,9% ≥7 e média 8,11, contra 81,1% e 7,14 sem
//     citar. Como 48% das avaliações citam o gatilho num catálogo majoritariamente isekai,
//     a regra deixou de distinguir. Agora esses tropos são DISPOSITIVO, não estrutura;
//   · protagonist perdeu a AGÊNCIA do gate: a rubrica 0-3 abre com "sem agência", mas o
//     prompt só autorizava faixa baixa pra "esquecível/genérico/sem personalidade". Das
//     151 justificativas que chamam o protagonista de passivo, 51% ficaram ≥7 ("agência
//     clara, decisões movem a trama") e só 9 abaixo de 5.
// ⚠️ Pulou o v24 de propósito: `ai_api_calls` tem 65 chamadas de `ai_evaluation` já
// rotuladas "v24" (2026-07-29), de uma rodada cujas avaliações foram gravadas como v22.
// Reusar o número misturaria latência/custo do v24 novo com as fantasmas — erro que
// produz resultado. `ai_evaluations` nunca teve v23-v25.
//
// v23 (2026-08-09): couple_dynamics deixou de ser tratado como critério de
// PRESENÇA. Ele é o único dos 9 com escala de VALÊNCIA (0-3 = a relação faz mal,
// 9-10 = faz bem), e as meta-regras de presença — piso de 5, "ausência de
// evidência", coerência justificativa×faixa — estavam sendo aplicadas a ele.
// Além disso a seção C mapeava `"possessive but I love it" → 0-3`, ou seja, a
// PREFERÊNCIA da leitora virava a valência da relação, contradizendo a regra
// dedicada logo abaixo. Agora: opinião de leitor não define valência, a REAÇÃO
// do outro personagem é o sinal decisivo, tag de posse sem indício de reação
// PERDE peso, e comportamento tóxico anterior a regressão/reencarnação/
// transmigração é contexto estabelecido (item (d)) — não conta.
// Medido antes da mudança: couple_dynamics era o critério mais instável dos 9
// (amplitude média 1,52 pt entre reavaliações da mesma obra, 36,7% variando ≥2 pt),
// e justificativa que citava posse/ciúme/yandere caía em 0-3 em 19,1% dos casos
// contra 5,4% quando não citava.
// (v22 2026-07-24): adult_content passou a ter piso E TETO por PROCEDÊNCIA do
// sinal (ver lib/ai-evaluation/adult-content-rules.ts). Marcador de EDIÇÃO
// ("[R19 disponível]" vindo de boilerplate da fonte) deixou de gerar piso — era a
// origem de 48% dos pisos aplicados, e produzia notas que contradiziam a própria
// justificativa. Cena explícita, em qualquer quantidade, agora exige 9-10; a tag
// "R15 but Based on a R19 Novel" virou TETO.
// (v21 2026-07-07: consenso das reviews, proibido citar review individual ou ID.)
// (v20 2026-06-27: citação genérica de reviews, sem exigir IDs nem auditoria.)
export const PROMPT_VERSION = CONCISE_OUTPUT ? "v25" : "v18"
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

/** Exportado só para teste: as invariantes da rubrica são verificadas contra o
 *  texto FINAL (já com `buildCriteriaPromptSection()` interpolada), e a versão do
 *  prompt é fixada ao hash dele — ver `tests/unit/ai-evaluation/couple-dynamics-valencia.test.ts`. */
export const SYSTEM_PROMPT = `Você é um especialista em mangá, manhwa e manhua. Sua tarefa é avaliar UMA obra específica com base em rubricas rigorosas.

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
- couple_dynamics: grupo "relationship_dynamics" (médio — qualquer vínculo central, não só o casal: família, irmãos, mestre/discípulo, equipe, rivalidade), grupo "characters" (baixo — apenas quando a tag descreve como o personagem TRATA quem é próximo dele).
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

DUAS NATUREZAS DE ESCALA (leia ANTES das regras abaixo — elas não valem igual pros 9 critérios):
- OITO critérios são de PRESENÇA/INTENSIDADE: 0 = o critério não está lá, 10 = domina a obra. São romance, fantasy_nobility, action_adventure, adult_content, protagonist, humor, drama e tragedy.
- couple_dynamics é de VALÊNCIA: 0-3 = o vínculo faz MAL aos envolvidos, 9-10 = faz BEM. Nota baixa ali NÃO significa "não tem vínculo" — significa "o vínculo destrói quem está nele". Quando a obra não tem nenhum vínculo central avaliável, a nota é 5 (não aplicável), NUNCA 0-3.
- Consequência: as três seções seguintes — "COERÊNCIA JUSTIFICATIVA × FAIXA", "INTERPRETAÇÃO DA ESCALA" e "AUSÊNCIA DE EVIDÊNCIA NÃO É EVIDÊNCIA DE AUSÊNCIA" — valem SOMENTE para os oito critérios de presença. Para couple_dynamics vale a seção "REGRA PARA COUPLE_DYNAMICS", e só ela.

COERÊNCIA JUSTIFICATIVA × FAIXA (obrigatória — critérios de PRESENÇA; não vale pra couple_dynamics):
- A justificativa deve ser semanticamente consistente com a faixa escolhida. Se a justificativa contém expressões como "presença constante", "frequente", "recorrente", "um dos pilares", "elemento central", "abundante", a nota NÃO pode terminar em faixa 4-6 (pontual/subplot) — deve ser 7-8 ou 9-10. Se diz "pontual", "esporádico", "leve", "sutil", "subliminar", NÃO pode terminar em 7-8.
- Em couple_dynamics essas palavras descrevem a FREQUÊNCIA do conflito, não a qualidade da relação ("atrito recorrente" é uma relação PIOR, não melhor) — por isso a regra não se aplica lá.
- A regra de incerteza entre faixas adjacentes (acima) NÃO autoriza ancorar a nota em 5 quando a própria justificativa lista evidências claras de presença. Ela só vale pra borderline real — quando duas faixas adjacentes são ambas plausíveis a partir do mesmo conjunto de evidências. Não use essa regra como "atalho" pro neutro.

INTERPRETAÇÃO DA ESCALA (critérios de PRESENÇA; não vale pra couple_dynamics — regra crítica para evitar viés sistemático):
- 5 é o ponto NEUTRO: significa "o critério está presente de forma reconhecível, mas não define a obra".
- Notas 0-4 são RESERVADAS pra casos onde o critério é claramente ausente, irrelevante ou atua negativamente.
- O piso de 5 existe pra impedir DOIS erros específicos: baixar a nota por EXECUÇÃO FRACA e baixar por SILÊNCIO das fontes. Ele não faz mais do que isso.
- 🔴 O piso NÃO se sobrepõe à rubrica. Se a evidência casa com o que a faixa 0-3 daquele critério DESCREVE, a resposta é 0-3 — mesmo havendo menções isoladas do critério. Ex.: a faixa 0-3 de action_adventure é "cotidiano, sem conflito externo relevante (slice of life)"; se o consenso diz que a obra é slice of life e nada acontece, duas cenas de perigo citadas de passagem não a tiram de 0-3. Evidência positiva de ausência VENCE o piso; o piso só vale contra ausência de evidência.
- Críticas, tropos clichês ou execução fraca NÃO justificam baixar abaixo de 5 quando o critério genuinamente existe. Use ressalvas pra escolher entre 5 e 6 (ou 7 e 8), NUNCA pra ancorar no piso da faixa.
- POSIÇÃO DENTRO DA FAIXA — escolha pela INTENSIDADE que a SUA PRÓPRIA justificativa descreve, não pelo meio da faixa:
  · texto diz "pontual", "esporádico", "raro", "de fundo", "não domina o tom", "secundário" → valor MAIS BAIXO da faixa (numa faixa 4-6, isso é 4);
  · texto diz "frequente", "constante", "recorrente", "central", "permeia" → valor MAIS ALTO;
  · texto não puxa pra nenhum lado → valor central.
  ⚠️ Esta regra tem PRECEDÊNCIA sobre "prefira o valor central" e sobre "use o valor mais alto da faixa inferior". Aquelas duas valem só pra empate REAL — quando o texto não declara intensidade nenhuma. Escrever "eventos pontuais, sem dominar o tom geral" e pontuar 6 (o topo da faixa) é contradizer a própria justificativa.

PRINCÍPIO "AUSÊNCIA DE EVIDÊNCIA NÃO É EVIDÊNCIA DE AUSÊNCIA" (critérios de PRESENÇA; não vale pra couple_dynamics):
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

EXCEÇÃO PRA CRITÉRIOS NEGATIVOS (drama, tragedy — couple_dynamics já está fora por ser escala de valência):
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
- PROTAGONISTA MARCANTE mede presença e agência, NÃO qualidade percebida. Reviews chamando a FL/ML de "Mary Sue", "OP", "broken", "insensível", "inconsistente", "plana", "irritante", "fria", "blasé" ou descrevendo poderes excessivos/cabeça-dura/atitudes polêmicas CONFIRMAM presença forte (sobe protagonist), mesmo que o reviewer critique a execução. Tags como "Confident Female Lead", "Strong-Willed Female Lead", "Determined Female Lead", "Smart Female Lead", "Delusional Female Lead", "Yandere ML" são evidência DIRETA de protagonista marcante. 🔴 PRESENÇA e AGÊNCIA são as DUAS metades deste critério, e personalidade forte NÃO compensa agência ausente. A faixa 7-8 exige "agência clara, decisões movem a trama": se o consenso diz que o protagonista é PASSIVO, REATIVO, conduzido pelos eventos ou por outros personagens, ou que suas decisões não mudam o rumo, ele NÃO chega em 7-8 por mais marcante que seja — fica em 4-6 ("conduz a história e tem personalidade reconhecível, mas não domina") ou em 0-3 quando não há agência nenhuma. Regra prática: as ressalvas da lista acima ("Mary Sue", "irritante", "fria") são sobre COMO ele é, e não rebaixam; "passivo" e "sem agência" são sobre O QUE ELE FAZ, e rebaixam.
Vá para 0-3 quando reviews ou sinopse descrevem o protagonista como ESQUECÍVEL, GENÉRICO, SEM PERSONALIDADE RECONHECÍVEL, SUBSTITUÍVEL por outro qualquer — ou SEM AGÊNCIA, com decisões irrelevantes pra trama. "Personagem desagradável de acompanhar" continua sendo 7-8.

C) Sinais INDIRETOS de presença — especialmente romance e couple_dynamics:
Reviewers raramente dizem "esta obra tem romance forte". Sinalizam de forma indireta. Trate como evidência POSITIVA de presença (sobe o critério, mesmo que sem comentar qualidade):

Romance presente:
- Termos de fandom: "OTP", "ship them", "endgame", "I'm shipping", "second lead syndrome", "love triangle"
- Tropes nomeados: "ice prince x sunshine girl", "enemies to lovers", "fated mates", "marriage of convenience", "fake dating", "slow burn", "arranged marriage"
- Tensão romântica: "chemistry off the charts", "dancing around each other", "the tension!!!", "kiss scene was everything"
- Emoção em torno do casal: "I cried when they finally got together", "ML is everything", "FL deserves better than ML"
- Críticas a QUALIDADE do romance ("rushed romance", "forced romance", "cringe romance") ainda confirmam que romance é elemento central — só com execução fraca.

Couple dynamics (= vínculos centrais, não só o casal) — atenção: os itens abaixo dizem O QUE o vínculo tem, e usam vocabulário de casal só porque é o mais comum nas reviews; leia-os valendo para irmãos, família, mestre/discípulo, equipe ou rivais. A FAIXA sai da seção "REGRA PARA COUPLE_DYNAMICS" (valência), nunca do rótulo do trope:
- "Banter is great" / "way they tease each other" → dinâmica leve/divertida
- "Toxic ship", "yandere", "obsessive ML/FL", "possessive ML" → comportamento intenso de UM dos lados. NÃO conclua 0-3 daqui: vá checar a REAÇÃO do outro personagem e a LINHA DO TEMPO, itens (a)–(d) da regra própria.
- "Possessive but I love it", "toxic but I'm here for it", "eu não aguentaria isso", "sufocante demais pra mim" → o leitor está declarando PREFERÊNCIA dele. Vale como sinal de que o trope EXISTE; vale ZERO na escolha da faixa.
- "He scares her", "she's trying to escape him", "she's miserable with him", "ela perde a autonomia" → dano RETRATADO no personagem (0-3)
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

REGRA PARA FANTASY_NOBILITY:
Obras ambientadas majoritariamente em corte, aristocracia, realeza, império, ducado, nobreza ou famílias nobres devem receber nota alta quando esse ambiente ORGANIZA a premissa e os conflitos — quando política de corte, herança, hierarquia, magia ou regras do mundo DECIDEM o que acontece. Não deixe em 4-6 quando a ambientação de nobreza/realeza for central.
🔴 Reencarnação, transmigração, isekai, regressão, segunda chance e viagem no tempo são DISPOSITIVOS NARRATIVOS, não estrutura de fantasia/nobreza. Sozinhos, NÃO elevam a nota: uma regressão para um escritório contemporâneo não é fantasy_nobility 7-8. Eles contam apenas quando o mundo PARA O QUAL se regride/transmigra é o que organiza os conflitos — e nesse caso quem sustenta a nota é o mundo, não o dispositivo. Avalie o mundo; ignore o mecanismo de chegada.
⚠️ Este catálogo é majoritariamente isekai/vilã/regressão. Uma regra que dispare em quase toda obra não distingue nada: se a sua justificativa poderia ser copiada para metade das obras do catálogo, ela não é evidência de 7-8.

REGRA PARA ADULT_CONTENT (leia com atenção — a natureza do conteúdo manda, não a frequência):
- Pontue adult_content com base em sinopse, tags (especialmente do grupo "content_indicator"), gêneros e reviews compatíveis.
- QUALQUER quantidade de cena de sexo explícito coloca a obra em 9-10. Uma única cena explícita basta. NÃO rebaixe porque "aparece pouco", "é escasso", "não é recorrente" ou "não é o foco": frequência muda o FOCO da obra, não a natureza do conteúdo. "Tem uma cena explícita mas o foco é o romance" continua sendo 9-10.
- A faixa 7-8 é pra sexo MOSTRADO PARCIALMENTE (nudez, contexto sexual relevante) sem cena explícita. A faixa 4-6 é pra insinuação e fade to black — nada mostrado.
- Marcadores de EDIÇÃO ("[R19 disponível]", "Original Webtoon: R19", "Official Translations (R19)") dizem apenas que EXISTE uma edição R19 desta história em algum lugar. Isso NÃO é evidência de que a obra avaliada mostre conteúdo explícito — com frequência a obra avaliada é justamente a versão sem ele. Trate como dica fraca, nunca como piso.
- A marcação "R15 but Based on a R19 Novel" diz o contrário de conteúdo explícito: a obra avaliada é R15, o R19 é do novel de origem. Nesse caso adult_content tem TETO, não piso.
- Quando houver piso ou teto obrigatório para esta obra, ele vem informado no prompt do usuário. Sem essa informação, não invente piso a partir de marcador.

REGRA PARA COUPLE_DYNAMICS (escala de VALÊNCIA — leia inteira antes de pontuar):

⚠️ O NOME DO SLUG ENGANA: apesar de "couple", este critério é "Dinâmica entre Protagonistas" e avalia o VÍNCULO MAIS CENTRAL da obra, seja ele qual for. Obra SEM romance tem vínculo central e é pontuável normalmente aqui; não devolva 5 só porque não há casal.

QUAL VÍNCULO AVALIAR (ordem de prioridade — pegue o PRIMEIRO que a obra tiver, não some os outros):
1. o CASAL principal, quando há um par romântico central;
2. a FAMÍLIA do protagonista (pais, irmãos, filhos) quando não há casal central, ou quando a obra é declaradamente um drama familiar;
3. o restante dos vínculos recorrentes: mestre e discípulo, party/equipe, rivalidade, amizade central.
Então: obra de romance → o casal; drama familiar → protagonista e família; shounen de equipe → o grupo; obra de vingança sem par nem família → a relação recorrente com o alvo ou com o aliado.
Diga na justificativa QUAL vínculo você avaliou. Use 5 (não aplicável) apenas quando a obra não tem nenhum vínculo central recorrente — protagonista isolado.

O QUE A NOTA MEDE: o resultado emocional do vínculo PARA OS PERSONAGENS NELE, no desenvolvimento da obra. NÃO mede a forma da dinâmica, nem se um leitor gostaria de viver aquilo. Tags como BDSM, Femdom, Dom/Sub, Master-Pet, posse, ciúme intenso, "Yandere ML/FL", "Obsessive Male Lead", "Masochistic ML", "Submissive ML/FL", "Crazy ML/FL" NÃO determinam automaticamente 0-3.

OPINIÃO DE LEITOR NÃO DEFINE A VALÊNCIA (regra crítica). Reviews são evidência sobre O QUE ACONTECE no vínculo — nunca sobre se aquilo é bom ou ruim para quem está nele. Gostar ou não de um trope é PREFERÊNCIA de quem leu. Da mesma review, extraia o FATO ("o ML vigia as conversas dela") e DESCARTE o julgamento ("o que é sufocante", "eu não aguentaria", "possessive but I love it"). Consenso de leitores desgostando de um comportamento NÃO é evidência de dano ao personagem, e consenso adorando não é evidência de saúde.

Antes de pontuar, responda estas quatro:
(a) CONSENSO — a dinâmica é retratada como mútua/aceita pelos envolvidos, ou imposta contra a vontade de um deles?
(b) SATISFAÇÃO — os envolvidos demonstram conforto/prazer conforme o vínculo se desenvolve, ou algum deles sofre?
(c) TOM — sinopse/tags/reviews indicam tom romântico, cômico, fluffy — ou angustiante, sofrido, abusivo?
(d) LINHA DO TEMPO — em obras com reencarnação, regressão, transmigração, volta no tempo ou segunda chance: o comportamento tóxico acontece ANTES desse evento? Se sim, ele é CONTEXTO ESTABELECIDO — é a vida anterior que a obra existe pra reescrever — e NÃO conta pra nota. Pontue a relação da linha do tempo ATUAL; só o que se repete DEPOIS do evento conta. Não cite a vida anterior como argumento da nota.

A REAÇÃO DO OUTRO LADO DO VÍNCULO É O SINAL DECISIVO, e procurá-la é obrigatório. Tag de posse, ciúme, vigilância, obsessão ou crueldade descreve o COMPORTAMENTO de um personagem — não o efeito em quem o recebe. Busque na sinopse, nas tags e nas reviews como o outro personagem REAGE:
- medo, fuga, tentativa de escapar, sofrimento, perda de autonomia → dano real: faixa 0-3
- irritação, atrito, brigas, negociação → conflito: faixa 4-6
- aceitação, reciprocidade, divertimento, indiferença — ou a obra trata o comportamento como carinho/comédia → NÃO é dano: faixa 7-8 (9-10 se há parceria e crescimento)
Quando NÃO houver nenhum indício da reação do outro personagem, a tag de posse/ciúme PERDE PESO: ela não sustenta sozinha uma nota baixa. Nesse caso pontue pelo TOM geral da obra e baixe a "confidence". Nunca deduza dano a partir da intensidade do comportamento.

ARCO DE REDENÇÃO E PERDÃO: se a obra ENCENA o agressor mudando e o outro personagem aceitando/perdoando, o estado predominante do desenvolvimento é a relação reconciliada — faixa 7-8, ou 9-10 se vira parceria. Leitores dizendo que ELES não perdoariam é preferência, não evidência. Reserve 0-3 para devoção a um abusador NÃO-arrependido.

Reserve 0-3 para abuso real NO DESENVOLVIMENTO, DENTRO dos vínculos centrais: manipulação contra a vontade do outro, sofrimento ativo de quem é próximo, controle não-consensual, violência. Crueldade dirigida a ANTAGONISTAS que a merecem não rebaixa a nota — o critério olha para dentro dos vínculos, não para o mundo. Dinâmica não-tradicional + consensual + tom romântico/cômico/fluffy → 7-8 ou 9-10 (relação saudável dentro da dinâmica que ambos escolheram). Tropes "dark romance" com consenso retratado e comédia BDSM ficam em 7-8/9-10, NÃO em 0-3.

REGRA OBRIGATÓRIA PARA TRAGEDY (leia com atenção):
Considere tragédia apenas o que ocorre NO DESENVOLVIMENTO (meio da obra), não o cenário inicial nem o background.
EVITE citar na justificativa: infância, traumas passados, abandono/traição pré-história, premissa de revenge, regressão/segunda chance, transmigração ou qualquer fato anterior ao início da narrativa. Esses fatos podem indicar tom da obra, mas não devem ser usados como argumento direto para a nota de tragedy nem aparecer listados na justificativa.
Se não houver eventos trágicos ativos no desenvolvimento, atribua nota baixa (0-3) e justifique com algo como "sem eventos trágicos ativos no desenvolvimento principal" — sem detalhar o background.
Nota alta (7-10) só quando há perdas, separações, mortes, conflitos prolongados ou sofrimento que acontecem no meio da obra e impactam os personagens principais.
Não infira tragédia ativa a partir de premissas tristes ou tropes de revenge/segunda chance.

AVALIE O DESENVOLVIMENTO, NÃO O PONTO DE PARTIDA (generaliza pra couple_dynamics e romance):
- COUPLE_DYNAMICS: se a premissa coloca FL e ML como inimigos, rivais, contratantes hostis, transmigrada/regressora com ressentimento, casamento arranjado tenso — ou qualquer dinâmica negativa INICIAL que evolui ao longo da obra para parceria/romance — avalie pelo ESTADO PREDOMINANTE do desenvolvimento, não pela cena inicial. "Enemies to lovers" não é couple_dynamics 0-3; é 7-8/9-10 quando o arco é eles se entendendo e amadurecendo a relação. O caso da vida ANTERIOR (regressão/reencarnação/transmigração) é o item (d) da regra própria: aquilo é contexto estabelecido e não conta.
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

// `coerceToolPayload` foi extraído pra `@/lib/ai/tool-payload` (util puro,
// parametrizável por campo) pra ser reusado também pelo fluxo de recomendação.
// Reexportado aqui pra preservar o import path histórico (testes + call-site).
export { coerceToolPayload }

/** Prévia curta e segura de um valor recusado pelo schema — sem isto, a próxima
 *  ocorrência volta a ser um mistério (o payload cru não é persistido em lugar nenhum). */
function previewRejectedValue(input: unknown): string {
  const scores = (input as { scores?: unknown } | null)?.scores
  if (typeof scores !== "string") return ""
  const flat = scores.replace(/\s+/g, " ").trim()
  return ` · scores recebido como string: "${flat.slice(0, 120)}${flat.length > 120 ? "…" : ""}"`
}

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
// User prompt
// ============================================================================

function buildUserPrompt(req: AiEvaluationRequest, prepared: PreparedReviews): string {
  const adultBounds = computeAdultContentBounds({
    tags: normalizeTags(req.tags),
    genres: req.genres,
    contentRatings: req.contentRatings,
    synopsis: req.synopsis,
  })
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

  const additionalSynopses = (req.additionalSynopses ?? []).filter((s) => s.text?.trim())
  if (additionalSynopses.length) {
    lines.push(
      `\nSinopses adicionais salvas na obra (complementam a sinopse acima; as marcadas como MANUAL foram escritas/editadas pelo usuário e têm autoridade alta — em conflito com fontes externas, prevalecem):`
    )
    additionalSynopses.forEach((s, index) => {
      const label = s.isManual
        ? "MANUAL — escrita/editada pelo usuário"
        : `fonte: ${s.source ?? "desconhecida"}`
      lines.push(`[S${index + 1}] (${label}) ${s.text.trim()}`)
    })
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

  // Limites de adult_content vindos de sinal ESTRUTURADO (tag/gênero/classificação
  // da fonte). Só isto entra como regra; keyword em sinopse ou review NÃO — a
  // review que motivou a mudança dizia "smut are lacking", e casar "smut" em texto
  // livre acionaria o piso justamente no caso oposto.
  if (adultBounds.floor != null || adultBounds.ceiling != null) {
    lines.push(`\nREGRA OBRIGATÓRIA para adult_content nesta obra: ${adultBounds.reasons.join(" ")}`)
    if (adultBounds.floor != null) {
      lines.push(
        `Portanto adult_content NÃO pode ficar abaixo de ${adultBounds.floor.toFixed(1)}. Não rebaixe por a cena ser pouco frequente: frequência muda o FOCO, não a natureza do conteúdo.`
      )
    }
    if (adultBounds.ceiling != null) {
      lines.push(`Portanto adult_content NÃO pode passar de ${adultBounds.ceiling.toFixed(1)}.`)
    }
  } else if (adultBounds.hasEditionMarkerOnly) {
    lines.push(
      `\nA sinopse traz um marcador do tipo "[R19 disponível]". Ele vem do boilerplate da fonte ("Original Webtoon: R19", "Official Translations (R19)") e significa apenas que EXISTE uma edição R19 desta história em algum lugar — NÃO que a obra avaliada mostre conteúdo explícito. Trate como dica fraca: NÃO há piso obrigatório. Pontue adult_content pela evidência de fato (tags, gêneros, o que as reviews descrevem).`
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

/**
 * Piso e teto de `adult_content` por PROCEDÊNCIA do sinal — ver
 * `lib/ai-evaluation/adult-content-rules.ts` para o raciocínio e as medições.
 *
 * Substituiu três regras que eram encadeadas e só sabiam SUBIR (R19 weak/strong,
 * R15-derivado-de-R19, content rating externo). O problema não era o encadeamento:
 * era a premissa. A antiga procurava o token "R19" em qualquer texto — incluindo o
 * marcador que o próprio pipeline reinjeta na sinopse a partir de boilerplate como
 * "Original Webtoon: R19" — e 48% dos pisos aplicados vinham daí. Marcador de
 * EDIÇÃO deixou de virar limite; virou dica no prompt.
 */
/** Os mesmos limites, para registrar no `evaluationContext`. Fica separado porque
 *  `attachEvaluationContext` roda depois e não recebe o resultado do enforce. */
function adultBoundsForContext(req: AiEvaluationRequest) {
  const b = computeAdultContentBounds({
    tags: normalizeTags(req.tags),
    genres: req.genres,
    contentRatings: req.contentRatings,
    synopsis: req.synopsis,
  })
  return {
    floor: b.floor,
    ceiling: b.ceiling,
    explicitSignals: b.explicitSignals,
    hasEditionMarkerOnly: b.hasEditionMarkerOnly,
    conflict: b.conflict,
  }
}

function enforceAdultContentBounds(
  response: AiEvaluationResponse,
  req: AiEvaluationRequest
): AiEvaluationResponse {
  const bounds = computeAdultContentBounds({
    tags: normalizeTags(req.tags),
    genres: req.genres,
    contentRatings: req.contentRatings,
    synopsis: req.synopsis,
  })
  if (bounds.floor == null && bounds.ceiling == null) {
    return {
      ...response,
      rawResponse: {
        ...rawObject(response.rawResponse),
        adultContentBounds: { floor: null, ceiling: null, hasEditionMarkerOnly: bounds.hasEditionMarkerOnly },
      },
    }
  }

  let applied = false
  const scores = response.scores.map((score) => {
    if (score.criterionSlug !== "adult_content") return score
    const clamped = clampAdultContentScore(score.suggestedScore, bounds)
    if (clamped === score.suggestedScore) return score
    applied = true
    const reason = bounds.reasons.join(" ")
    return {
      ...score,
      suggestedScore: clamped,
      // Não duplica o texto quando o modelo já explicou o mesmo limite.
      justification: score.justification.includes(reason)
        ? score.justification
        : `${score.justification} ${reason}`,
    }
  })

  return {
    ...response,
    scores,
    rawResponse: {
      ...rawObject(response.rawResponse),
      adultContentBounds: {
        floor: bounds.floor,
        ceiling: bounds.ceiling,
        applied,
        conflict: bounds.conflict,
        explicitSignals: bounds.explicitSignals,
        hasEditionMarkerOnly: bounds.hasEditionMarkerOnly,
        reasons: bounds.reasons,
      },
    },
  }
}

/**
 * `enforceNeutralCoupleDynamicsWhenNoRomance` foi REMOVIDO em 2026-08-09 (v23).
 *
 * Ele forçava `couple_dynamics = 5.0` sempre que `romance ≤ 3`, com a justificativa
 * "critério não é aplicável". A premissa — "sem romance, não há dinâmica a avaliar" —
 * morreu quando o critério foi renomeado "Dinâmica do Casal" → "Dinâmica entre
 * Protagonistas" (95226f7, 2026-07-27) e a rubrica passou a falar de VÍNCULOS
 * CENTRAIS: numa obra sem romance os vínculos continuam existindo (família, irmãos,
 * mestre/discípulo, equipe, rivais) e a rubrica sabe pontuá-los.
 *
 * Medido antes da remoção: das 18 obras com `romance ≤ 3`, **17 (94,4%)** estavam
 * travadas em 5,0 — o clamp apagava o critério justamente no público que a ampliação
 * queria atender.
 *
 * ⚠️ O guard-rail não sumiu, MUDOU DE LUGAR: quem decide "não aplicável" agora é o
 * prompt (`REGRA PARA COUPLE_DYNAMICS`), que reserva o 5 pra ausência de VÍNCULO
 * CENTRAL avaliável — não pra ausência de romance. Se o modelo voltar a devolver
 * 0-3 alegando "não há casal", o conserto é a instrução, não um clamp derivado de
 * outro critério.
 */

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
  const hasAdditionalSynopsisEvidence = (req.additionalSynopses ?? []).some(
    (s) => (s.text?.trim().length ?? 0) >= SYNOPSIS_MIN_CHARS,
  )
  const substantiveReviews = (req.sourcedReviews ?? []).filter(
    (r) => (r.text?.trim().length ?? 0) >= SUBSTANTIVE_REVIEW_MIN_CHARS,
  ).length
  const hasReviewEvidence = substantiveReviews >= MIN_SUBSTANTIVE_REVIEWS
  // "Baixa evidência" = sinopse curta E sem contexto externo E sem reviews
  // substantivas. Sinopse adicional persistida também é evidência.
  const lowEvidence =
    synopsisLength < SYNOPSIS_MIN_CHARS &&
    !hasExternalContext &&
    !hasReviewEvidence &&
    !hasAdditionalSynopsisEvidence

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
        additionalSynopses: (req.additionalSynopses ?? []).map((s) => ({
          text: s.text,
          source: s.source ?? null,
          isManual: s.isManual ?? false,
        })),
        additionalSynopsesCount: req.additionalSynopses?.length ?? 0,
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
        // `r19Detected` continua existindo pro painel "Dados usados na avaliação"
        // (é o único leitor), mas agora significa "há sinal ESTRUTURADO de conteúdo
        // adulto", não "a string R19 apareceu em algum lugar".
        r19Detected: adultBoundsForContext(req).floor != null,
        adultContentBounds: adultBoundsForContext(req),
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
        enforceAdultContentBounds(response, req),
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

function canonicalAdditionalSynopses(req: AiEvaluationRequest) {
  return (req.additionalSynopses ?? []).map((s) => ({
    text: s.text,
    source: s.source ?? null,
    isManual: s.isManual ?? false,
  }))
}

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
    // Só entra no hash quando existe: obra de sinopse única mantém o hash antigo
    // (mesma garantia de byte-identidade da união fresco+persistido das reviews).
    ...(req.additionalSynopses?.length
      ? { additionalSynopses: canonicalAdditionalSynopses(req) }
      : {}),
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
      ...(req.additionalSynopses?.length
        ? { additionalSynopses: canonicalAdditionalSynopses(req) }
        : {}),
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

// Expostos para testes (mesmo padrão de coerceToolPayload).
export { buildUserPrompt, canonicalInputHash, canonicalInputHashV2 }

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

    // Duplo-encode (campo estruturado vindo como string de JSON) é recuperável —
    // ver `coerceToolPayload`. O warn NÃO é decorativo: sem ele a recuperação vira
    // silenciosa e a gente perde o sinal de que o modelo/prompt regrediu.
    const { value: toolInput, coerced } = coerceToolPayload(toolUseBlock.input)
    if (coerced.length > 0) {
      console.warn(
        `[AI] Payload da tool veio com JSON duplo-encodado em ${coerced.join(", ")} — recuperado (modelo=${modelToUse}, prompt=${PROMPT_VERSION}, work=${req.workId ?? "?"}).`
      )
    }

    const parsed = evaluationToolPayloadSchema.safeParse(toolInput)
    if (!parsed.success) {
      lastError = new Error(
        `Payload da tool não atende ao schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}${previewRejectedValue(toolInput)}`
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
