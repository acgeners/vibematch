import { LABELS } from "@/lib/constants/ui-labels"
import {
  EXPECTED_BASELINE_FEATURES,
  EXPECTED_CATEGORICAL_FEATURES,
  MIN_TRAIN_EXPECTED,
} from "@/lib/calculations/expected"
import { CATALOG_RECALC_INPUTS, PERSONAL_RECALC_INPUTS } from "@/lib/calculations/recalc-inputs"
import type { RecalcInput } from "@/lib/calculations/recalc-inputs"
import { CRITERION_SLUGS } from "@/types/domain"
import { SCORE_NOTES, type ScoreNote } from "./glossary-notes"

/**
 * O dicionário dos números (`/guide/scores`): o que cada medida do app quer dizer, quem a
 * produz, o que a faz mudar e em quantas obras ela existe.
 *
 * O dicionário dos atributos responde "o que significa romance 7,5?". Este responde a
 * pergunta que ficou de fora: o que significam a Prioridade, o Alinhamento e o Veredito —
 * e o que NÃO entra em nenhum deles, que é metade das dúvidas sobre o cálculo.
 *
 * 🔴 As três fontes são as constantes que o cálculo usa de verdade, nunca uma cópia:
 *
 *   `LABELS`                      — o nome e a explicação de cada medida (tabela `ui_labels`)
 *   `EXPECTED_BASELINE_FEATURES`  — as entradas do Ridge da Nota Prevista
 *   `*_RECALC_INPUTS`             — o que faz uma nota ser recalculada
 *
 * A derivação das FEATURES é a que mais importa: feature nova no modelo sem verbete aqui
 * faz a página descrever um cálculo que não é o que roda, e nada acusaria — é o mesmo
 * modo de falha do `CRITERIA_SCALE_LEGEND` nos prompts. Por isso `buildScoreGlossary`
 * enumera `EXPECTED_BASELINE_FEATURES` e o teste reprova quem não tiver texto.
 *
 * ⚠️ Os verbetes das MEDIDAS são declarados, não derivados de `LABELS`: `ui_labels` também
 * carrega `title`, `fav` e `updated_at`, que não são números do cálculo. O que o TypeScript
 * garante é o outro lado — verbete apontando para um campo que saiu da tabela não compila.
 */

/** Em que parte da leitura o número vive. */
export type ScoreRole =
  /** aparece em lista ou card, dá para ordenar e filtrar por ele */
  | "medida"
  /** entra na Nota Prevista e nunca é exibido sozinho */
  | "feature"
  /** você configura, e mexer nele move as notas */
  | "controle"

/** Quem produziu o número — a cor da tabela sai daqui. */
export type ScoreProducer =
  /** aritmética determinística em TypeScript */
  | "calculo"
  /** regressão treinada nas suas notas */
  | "modelo"
  /** um LLM escreveu — custa dinheiro */
  | "ia"
  /** você informou */
  | "voce"
  /** veio de fora, é fato da obra */
  | "externo"

/**
 * Qual contagem ao vivo cabe a este verbete.
 *
 * 🔴 A separação não é organização, é a régua de vazamento do projeto. As de `catalogo`
 * são fato da obra e valem para qualquer visitante; as de `pessoa` saem de
 * `calculated_scores`, que **não tem `user_id`** e guarda os números do DONO. Contá-las
 * para quem não é ele publicaria o gosto de uma pessoa com cara de estatística —
 * exatamente o que `getScoresReader` existe para impedir. Ver `server/queries/score-coverage.ts`.
 */
export type CoverageKey =
  | "obras"
  | "nove_atributos"
  | "media_externa"
  | "ano"
  | "ano_fim"
  | "capitulos"
  | "tags"
  | "titulo_original"
  | "nota_prevista"
  | "alinhamento"
  | "veredito"
  | "sua_nota"
  | "seu_interesse"

/** As contagens que valem para qualquer um — o resto exige sessão. */
export const COVERAGE_CATALOGO = [
  "obras",
  "nove_atributos",
  "media_externa",
  "ano",
  "ano_fim",
  "capitulos",
  "tags",
  "titulo_original",
] as const satisfies readonly CoverageKey[]

export const COVERAGE_PESSOAL = [
  "nota_prevista",
  "alinhamento",
  "veredito",
  "sua_nota",
  "seu_interesse",
] as const satisfies readonly CoverageKey[]

export interface ScoreEntry {
  /** Âncora da URL e chave das notas. Estável — é o que um link de fora aponta. */
  key: string
  name: string
  /** O nome técnico: coluna, feature ou tabela. É o que se procura no código. */
  slug: string
  role: ScoreRole
  producer: ScoreProducer
  /** "0–10", "0–100", "♥ a ♥♥♥♥", "contagem"… cada medida tem a sua. */
  scale: string
  /** A frase que resolve. */
  summary: string
  /** Como entra na Nota Prevista — `null` quando não entra. */
  feedsExpected: string | null
  /** Onde a pessoa encontra isso na tela. */
  where: string
  /** As entradas do recálculo que movem este número. */
  movedBy: readonly RecalcInput[]
  coverage: CoverageKey | null
  /** Página que aprofunda, quando existe uma. */
  href: { url: string; label: string } | null
  note: ScoreNote | null
  /**
   * Quando preenchido, este número JÁ tem verbete em outra seção — a mesma grandeza
   * entrando no modelo. A página o desenha como referência, nunca como segundo verbete.
   */
  sameAs?: string
}

/** O que a tela mostra — na ordem em que a leitura acontece. */
const MEDIDAS: ReadonlyArray<Omit<ScoreEntry, "role" | "note">> = [
  {
    key: "decision",
    name: LABELS.decision.full,
    slug: "decision",
    producer: "calculo",
    scale: "0–10",
    summary:
      "O número que ordena o /ranking. Parte da Nota Prevista e só se afasta dela quando a obra tem um Veredito IA — que entra como desvio da própria média, ajustando a previsão em vez de substituí-la.",
    feedsExpected: "é o resultado dela",
    where: "/ranking · comparador",
    movedBy: ["category_scores", "user_score", "tag_preferences"],
    coverage: "nota_prevista",
    href: null,
  },
  {
    key: "expected_score",
    name: LABELS.expected_score.full,
    slug: "expected_score",
    producer: "modelo",
    scale: "0–10",
    summary:
      "A nota que o modelo acha que VOCÊ daria. Não é a nota do público nem média de nada: é uma regressão treinada nas obras que você já avaliou, cruzando os nove atributos, a nota externa, o tamanho e a idade da obra, e o quanto as tags dela batem com o seu gosto.",
    feedsExpected: "é ela",
    where: "/ranking · /catalog · card da obra · recomendações",
    movedBy: ["user_score", "category_scores", "platform_ratings", "work_tags"],
    coverage: "nota_prevista",
    href: null,
  },
  {
    key: "alignment_score",
    name: LABELS.alignment_score.full,
    slug: "alignment_score",
    producer: "ia",
    scale: "0–100",
    summary:
      "O veredito de um consultor de IA que lê a obra inteira contra o seu perfil e responde o quanto ela combina com você. É gerado sob demanda, no botão Rankear.",
    feedsExpected: "não — ele ajusta a Prioridade, por fora",
    where: "coluna Ver. do /ranking · card do Veredito na obra",
    movedBy: [],
    coverage: "veredito",
    href: null,
  },
  {
    key: "personal_fit",
    name: LABELS.personal_fit.full,
    slug: "personal_fit_percentile",
    producer: "calculo",
    scale: "percentil 0–100",
    summary:
      "Quantas das tags que você ama esta obra tem, menos as que você evita (que pesam 1,5×), posicionado como percentil dentro do catálogo. É só isso: critério, gênero e nota externa não entram.",
    feedsExpected: "sim — como três das entradas dela",
    where: "coluna Alinh. · card da obra",
    movedBy: ["work_tags", "tag_preferences", "taste_profile"],
    coverage: "alinhamento",
    href: { url: "/preferences", label: "Declarar tags amadas e evitadas" },
  },
  {
    key: "synopsis_q",
    name: LABELS.synopsis_q.full,
    slug: "synopsis_quality",
    producer: "voce",
    scale: "♥ a ♥♥♥♥",
    summary:
      "O quanto a obra te chamou atenção, num toque, sem compromisso de ler. É o sinal mais barato que existe no app e o único que você dá antes de abrir a obra.",
    feedsExpected: "sim",
    where: "todo card de obra · triagem",
    movedBy: ["synopsis_quality"],
    coverage: "seu_interesse",
    href: null,
  },
  {
    key: "synopsis_pred",
    name: LABELS.synopsis_pred.full,
    slug: "synopsis_quality_predictions",
    producer: "ia",
    scale: "♥ a ♥♥♥♥",
    summary:
      "A previsão da IA de quanto a obra vai te interessar, lida da sinopse e do seu perfil. Vale para as obras em que você ainda não deu o seu — quando os dois existem, o seu manda.",
    feedsExpected: "não",
    where: "card da obra · /my-ai-scores",
    movedBy: ["taste_profile"],
    coverage: null,
    href: null,
  },
  {
    key: "art_signal",
    name: "Arte (estimada)",
    slug: "art_signal",
    producer: "modelo",
    scale: "percentil 0–100",
    summary:
      "Uma estimativa de o quanto você gostaria da arte, treinada nos seus próprios rótulos de arte. Aparece como percentil dentro do catálogo, nunca em pontos.",
    feedsExpected: "sim, quando existe estimativa",
    where: "coluna Arte do /ranking e do /favorites",
    movedBy: [],
    coverage: null,
    href: null,
  },
  {
    key: "platform_avg",
    name: LABELS.platform_avg.full,
    slug: "platform_avg",
    producer: "externo",
    scale: "0–10",
    summary:
      "A média das notas das plataformas externas, ponderada pelo número de votos de cada uma. É fato da obra: vale igual para todo mundo.",
    feedsExpected: "sim",
    where: "coluna N. Externa · card da obra · Bússola",
    movedBy: ["platform_ratings"],
    coverage: "media_externa",
    href: null,
  },
  {
    key: "total_votes",
    name: LABELS.total_votes.full,
    slug: "total_votes",
    producer: "externo",
    scale: "contagem",
    summary:
      "Quantas pessoas votaram nas plataformas externas, somado. Ele decide o quanto a média externa pesa — e entra no modelo em escala logarítmica, porque a diferença entre 100 e 1.000 votos importa muito mais que entre 100 mil e 101 mil.",
    feedsExpected: "sim, em log",
    where: "coluna Votos · card da obra",
    movedBy: ["platform_ratings"],
    coverage: "media_externa",
    href: null,
  },
  {
    key: "ia_eval_normalized",
    name: "Nota.IA",
    slug: "ia_eval_normalized",
    producer: "calculo",
    scale: "0–10",
    summary:
      "Os nove atributos somados pela sua ênfase — o quanto a obra tem daquilo que você persegue, menos o que você foge. Atributo de peso negativo só desconta acima de um limiar; abaixo dele, não penaliza nada.",
    feedsExpected: "sim",
    where: "não aparece sozinha — vive dentro da Nota Prevista",
    movedBy: ["category_scores"],
    coverage: "nove_atributos",
    href: { url: "/guide/attributes", label: "O que cada atributo quer dizer" },
  },
  {
    key: "calc_score",
    name: LABELS.calc_score.full,
    slug: "calc_score",
    producer: "calculo",
    scale: "0–10",
    summary:
      "A Nota.IA misturada com a nota externa, dando mais peso à externa quanto mais votos ela tiver. Foi a nota principal do app até 06/2026; hoje é âncora interna da Nota Prevista.",
    feedsExpected: "sim, como âncora",
    where: "não aparece — é interna",
    movedBy: ["category_scores", "platform_ratings", "total_chapters"],
    coverage: null,
    href: null,
  },
]

/**
 * O texto de cada entrada do Ridge.
 *
 * 🔴 As chaves são os nomes que `expected.ts` usa no vetor de features, e é isso que faz
 * a checagem valer: `buildScoreGlossary` percorre `EXPECTED_BASELINE_FEATURES` e o teste
 * reprova feature sem entrada aqui. Renomear uma feature lá sem passar aqui derruba a
 * suíte em vez de deixar a página descrevendo um modelo que não roda mais.
 *
 * ⚠️ Os nove atributos não estão nesta tabela: eles entram por `CRITERION_SLUGS` e o
 * verbete deles é o `/guide/attributes`, que já existe. Duplicar a explicação aqui seria
 * a segunda cópia de uma rubrica que mora no banco.
 */
const FEATURE_INFO: Record<
  string,
  {
    name: string
    scale: string
    summary: string
    producer: ScoreProducer
    coverage: CoverageKey | null
    /**
     * A `key` da medida que já explica este número, quando é a MESMA grandeza entrando no
     * modelo (`Nota.M` é a Média externa; `IA(n)` é a Nota.IA).
     *
     * 🔴 Sem isto a página desenhava dois verbetes chamados "Média externa", com dois
     * textos que podem divergir na primeira edição — a família "dois critérios pro mesmo
     * fato" dentro da própria página que existe para explicar os números. Quem tem
     * `sameAs` vira uma linha de referência, não um segundo verbete.
     */
    sameAs?: string
  }
> = {
  "IA(n)": {
    sameAs: "ia_eval_normalized",
    name: "Nota.IA amplificada",
    scale: "0–10",
    producer: "calculo",
    coverage: "nove_atributos",
    summary:
      "A soma dos nove atributos pela sua ênfase, esticada em torno de 5 para separar melhor as obras.",
  },
  "Nota.M": {
    sameAs: "platform_avg",
    name: "Média externa",
    scale: "0–10",
    producer: "externo",
    coverage: "media_externa",
    summary:
      "A nota das plataformas externas, ponderada por votos — a mesma medida da coluna N. Externa, entrando no modelo como uma entrada entre outras.",
  },
  LogVotos: {
    sameAs: "total_votes",
    name: "Volume de votos",
    scale: "log",
    producer: "externo",
    coverage: "media_externa",
    summary:
      "Quantas pessoas votaram lá fora, em escala logarítmica — funciona como medida de alcance e de confiança na média externa.",
  },
  "Cps.N": {
    name: "Tamanho da obra",
    scale: "normalizado",
    producer: "externo",
    coverage: "capitulos",
    summary: "Quantos capítulos a obra tem, normalizado — obra muito curta e muito longa se comportam diferente.",
  },
  SinopseScore: {
    sameAs: "synopsis_q",
    name: "Seu Interesse",
    scale: "♥ a ♥♥♥♥",
    producer: "voce",
    coverage: "seu_interesse",
    summary:
      "O interesse que você marcou (♥ a ♥♥♥♥), convertido em número. É o único sinal seu que existe antes da leitura, então ele cobre obras em que o modelo não teria nada mais seu para olhar.",
  },
  LovedTagOverlap: {
    name: "Tags amadas presentes",
    scale: "soma",
    producer: "calculo",
    coverage: "tags",
    summary:
      "Quanto das tags que você ama esta obra tem. É metade do que o Alinhamento mede, entrando aqui com peso aprendido em vez do peso fixo de lá.",
  },
  AvoidedTagOverlap: {
    name: "Tags evitadas presentes",
    scale: "soma",
    producer: "calculo",
    coverage: "tags",
    summary:
      "Quanto das tags que você evita esta obra tem. Entra separada das amadas de propósito: o modelo aprende sozinho o quanto uma tag evitada pesa contra, em vez de herdar o 1,5× fixo do Alinhamento.",
  },
  CriterionFitScore: {
    name: "Aderência às suas faixas",
    scale: "0–1",
    producer: "calculo",
    coverage: "nove_atributos",
    summary:
      "O quanto os nove atributos da obra caem dentro das faixas ideais que o seu perfil de gosto declara para cada critério.",
  },
  ReleaseAge: {
    name: "Idade da obra",
    scale: "anos",
    producer: "externo",
    coverage: "ano",
    summary:
      "Quantos anos desde o início da publicação. Captura o efeito de era — o que se publicava em 2010 é diferente do que se publica hoje, e o gosto acompanha.",
  },
  RunLength: {
    name: "Duração da obra",
    scale: "anos",
    producer: "externo",
    coverage: "ano_fim",
    summary:
      "Quantos anos a obra durou (ano de fim menos ano de início). Explica parte da diferença entre duas obras de atributos parecidos.",
  },
  ArtEstimate: {
    sameAs: "art_signal",
    name: "Arte estimada",
    scale: "percentil",
    producer: "modelo",
    coverage: null,
    summary: "A estimativa de arte, quando o seu modelo de arte já tem rótulos suficientes.",
  },
  Status: {
    name: "Status de publicação",
    scale: "categoria",
    producer: "externo",
    coverage: "obras",
    summary:
      "Se a obra está em andamento, concluída, em hiato ou cancelada — entra como categoria, não como número.",
  },
  Origin: {
    name: "País de origem",
    scale: "categoria",
    producer: "externo",
    coverage: "titulo_original",
    summary:
      "Coreano, japonês, chinês ou outro, inferido do título original. Captura preferência por manhwa, mangá ou manhua.",
  },
}

/** O que você configura — mexer aqui move as notas de todas as obras. */
const CONTROLES: ReadonlyArray<Omit<ScoreEntry, "role" | "note">> = [
  {
    key: "score_weights",
    name: "Ênfase dos atributos",
    slug: "score_weights",
    producer: "voce",
    scale: "−100 a +100",
    summary:
      "O quanto cada um dos nove atributos pesa na Nota.IA. Peso negativo só penaliza acima de um limiar — abaixo dele, a obra não perde nada.",
    feedsExpected: "sim, através da Nota.IA",
    where: "/preferences · Pesos",
    movedBy: ["category_scores"],
    coverage: null,
    href: { url: "/preferences", label: "Ajustar a ênfase" },
  },
  {
    key: "tag_preferences",
    name: "Tags que você ama e evita",
    slug: "user_tag_preferences",
    producer: "voce",
    scale: "1× ou 2×",
    summary:
      "As tags que você persegue e as que abandona, com ênfase simples ou dobrada. Dá para declarar numa tag, num subgrupo inteiro ou num grupo — o mais específico vence.",
    feedsExpected: "sim — move o Alinhamento e três entradas do modelo",
    where: "/preferences · Ranking & gostos",
    movedBy: ["tag_preferences"],
    coverage: null,
    href: { url: "/preferences", label: "Ver e declarar tags" },
  },
  {
    key: "user_score",
    name: "Suas notas",
    slug: "user_score",
    producer: "voce",
    scale: "0–10",
    summary:
      "A nota que você dá ao terminar uma obra. É o rótulo que treina a Nota Prevista — sem um mínimo delas, o modelo não existe.",
    feedsExpected: "é o que a treina",
    where: "página da obra · pós-leitura",
    movedBy: ["user_score"],
    coverage: "sua_nota",
    href: null,
  },
  {
    key: "attribute_bias",
    name: "Viés de atributo",
    slug: "attribute_bias",
    producer: "calculo",
    scale: "deslocamento",
    summary:
      "A diferença sistemática entre a sua percepção e a da IA, medida nas obras que você terminou e avaliou por atributo. Ela desloca as notas de origem IA nas SUAS contas, sem tocar no que os outros veem.",
    feedsExpected: "sim, deslocando os nove atributos",
    where: "formulário de pós-leitura",
    movedBy: ["attribute_bias"],
    coverage: null,
    href: null,
  },
  {
    key: "observation_adjustment",
    name: "Ajuste por observação",
    slug: "observation_adjustment",
    producer: "voce",
    scale: "±0,30",
    summary:
      "Um empurrão manual na Nota Prevista de uma obra específica, para quando você sabe de algo que o modelo não tem como saber.",
    feedsExpected: "somado depois dela, não aprendido",
    where: "página da obra",
    movedBy: ["observation_adjustment"],
    coverage: null,
    href: null,
  },
  {
    key: "taste_profile",
    name: "Perfil de gosto",
    slug: "taste_profile",
    producer: "ia",
    scale: "texto + listas",
    summary:
      "O retrato que a IA escreve do seu gosto a partir das obras que você avaliou: tags amadas e evitadas, temas e faixas ideais por critério. Ele completa o que você declarou à mão.",
    feedsExpected: "sim — as tags dele entram junto com as suas",
    where: "/account/taste-profile",
    movedBy: ["taste_profile"],
    coverage: null,
    href: { url: "/account/taste-profile", label: "Ver o seu perfil" },
  },
]

function withRole(
  entries: ReadonlyArray<Omit<ScoreEntry, "role" | "note">>,
  role: ScoreRole,
): ScoreEntry[] {
  return entries.map((e) => ({ ...e, role, note: SCORE_NOTES[e.key] ?? null }))
}

/**
 * As entradas do Ridge, DERIVADAS de `EXPECTED_BASELINE_FEATURES` + as categóricas.
 *
 * Os nove atributos aparecem como uma entrada só, apontando para o dicionário deles: no
 * vetor de features eles são nove colunas, mas na tela nove verbetes idênticos dizendo
 * "veja o outro dicionário" seriam nove vezes a mesma linha.
 *
 * ⚠️ `ArtEstimate` só entra no modelo quando há rótulos de arte suficientes, e por isso é
 * a única condicional — ela aparece na página marcada como tal.
 */
export function buildFeatureEntries(): ScoreEntry[] {
  const criterios = new Set<string>(CRITERION_SLUGS)
  const nomes = [...EXPECTED_BASELINE_FEATURES, "ArtEstimate", ...EXPECTED_CATEGORICAL_FEATURES]

  const out: ScoreEntry[] = [
    {
      key: "os_nove_atributos",
      name: "Os 9 atributos",
      slug: CRITERION_SLUGS.join(" · "),
      role: "feature",
      producer: "ia",
      scale: "0–10 cada",
      summary:
        "As nove notas que a IA atribui lendo o consenso das reviews. São as entradas mais pesadas do modelo, e cada uma tem uma rubrica própria.",
      feedsExpected: "sim — nove das entradas",
      where: "aba Análise da IA, na página da obra",
      movedBy: ["category_scores"],
      coverage: "nove_atributos",
      href: { url: "/guide/attributes", label: "O dicionário dos atributos" },
      note: null,
    },
  ]

  for (const nome of nomes) {
    if (criterios.has(nome)) continue // já cobertos pela entrada acima
    const info = FEATURE_INFO[nome]
    if (!info) continue // o teste reprova isto; a página não desenha verbete vazio
    out.push({
      key: featureKey(nome),
      name: info.name,
      slug: nome,
      role: "feature",
      producer: info.producer,
      scale: info.scale,
      summary: info.summary,
      feedsExpected: "sim",
      where: "não aparece sozinha — vive dentro da Nota Prevista",
      movedBy: [],
      coverage: info.coverage,
      href: null,
      note: SCORE_NOTES[featureKey(nome)] ?? null,
      sameAs: info.sameAs,
    })
  }
  return out
}

/** `RunLength` → `run_length`. A âncora da URL não pode ter parêntese nem ponto. */
export function featureKey(nome: string): string {
  return nome
    .replace(/\(n\)/g, "_n")
    .replace(/[.\s]/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
}

export function buildScoreGlossary(): {
  medidas: ScoreEntry[]
  features: ScoreEntry[]
  controles: ScoreEntry[]
} {
  return {
    medidas: withRole(MEDIDAS, "medida"),
    features: buildFeatureEntries(),
    controles: withRole(CONTROLES, "controle"),
  }
}

/** Toda entrada do recálculo, com o rótulo humano — usado na seção "o que move uma nota". */
export const RECALC_INPUT_LABELS: Record<RecalcInput, string> = {
  category_scores: "as notas dos 9 atributos",
  platform_ratings: "as notas e votos das plataformas externas",
  total_chapters: "o número de capítulos",
  year: "o ano de publicação",
  publication_status: "o status de publicação",
  original_title: "o título original (de onde sai o país)",
  work_tags: "as tags da obra",
  catalog_membership: "a obra entrar ou sair do catálogo",
  user_score: "uma nota sua",
  observation_adjustment: "o seu ajuste por observação",
  synopsis_quality: "o seu Interesse",
  attribute_bias: "o seu viés de atributo",
  tag_preferences: "as tags que você ama e evita",
  taste_profile: "o seu perfil de gosto",
}

export const RECALC_CATALOGO = CATALOG_RECALC_INPUTS
export const RECALC_PESSOAL = PERSONAL_RECALC_INPUTS
export const MIN_TRAIN = MIN_TRAIN_EXPECTED
