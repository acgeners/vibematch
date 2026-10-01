/**
 * ARTE na MESMA chamada dos 11 atributos — contrato `art4`, canônico desde a v32 (2026-10-01).
 *
 * Histórico (`Auditoria/piloto-arte-abc/`): `art1` (piloto, XML) recusou 6/16 e nunca se absteve;
 * `art2` (reteste D, fronteira textual) recusou 0/13, acertou a direção 9/9 e se absteve 0/4 —
 * usou AVERAGE como "não sei" e contou review irrelevante para fechar o piso; `art3` reescreveu a
 * instrução como passos e nunca foi testado. O desenho canônico está em
 * `Auditoria/piloto-arte-abc/CONTRATO-ARTE-CANONICO-PROPOSTO.md`.
 *
 * O que o `art4` acrescenta é UMA coisa estrutural: `judging_reviews`, a lista de TODAS as reviews
 * que julgam a arte, com a posição de cada uma. Até o `art3` a abstenção dependia de o modelo
 * obedecer ao piso escrito na instrução — a saída só trazia EXEMPLOS, e nenhum código conseguia
 * conferir quantas reviews julgaram a arte. Agora o piso e a predominância são CONTAS sobre a lista.
 *
 * O que Arte mede: o consenso PERCEBIDO dos leitores sobre a execução visual, nas reviews que o
 * modelo recebeu — não beleza objetiva, não o julgamento visual da curadora, não a qualidade da
 * obra. Categórico: não existe 0–10, e `INCONCLUSIVE` nunca é nota neutra.
 *
 * Módulo PURO: sem IO, sem provider. `normalizarArte` nunca lança — Arte errada vira `invalid` ou
 * `abstained`, e os 11 atributos não ficam sabendo.
 */

export const ART_SIGNAL_VERSION = "art4"

export const ART_QUALITY_SIGNALS = ["ABOVE_AVERAGE", "AVERAGE", "BELOW_AVERAGE", "INCONCLUSIVE"] as const
export const ART_CHANGE_SIGNALS = ["NO_CLEAR_SIGNAL", "CHANGE_NOTED", "PROBLEMATIC_CHANGE"] as const
export const ART_CHANGE_DIRECTIONS = ["IMPROVED", "WORSENED", "MIXED_OR_UNCLEAR"] as const
export const ART_STANCES = ["positive", "negative", "competent", "mixed"] as const

export type ArtQualitySignal = (typeof ART_QUALITY_SIGNALS)[number]
export type ArtChangeSignal = (typeof ART_CHANGE_SIGNALS)[number]
export type ArtChangeDirection = (typeof ART_CHANGE_DIRECTIONS)[number]
export type ArtStance = (typeof ART_STANCES)[number]

/**
 * - `rated`: contrato válido e qualidade sustentada depois das regras determinísticas;
 * - `abstained`: contrato válido, qualidade INCONCLUSIVE (do modelo ou rebaixada);
 * - `invalid`: `art` ausente ou estruturalmente inválido.
 * O status descreve o eixo de QUALIDADE; a mudança é independente e vai no próprio campo.
 */
export type ArtStatus = "rated" | "abstained" | "invalid"

/** Piso de reviews DISTINTAS julgando a arte para um rótulo de qualidade. Decisão da curadora (27/09). */
export const ART_PISO_REVIEWS = 3
/** Fração mínima da posição que sustenta ABOVE/BELOW. Parâmetro de PRODUTO inicial, não medição. */
export const ART_PREDOMINANCIA_MINIMA = 0.6

/**
 * FORÇA da evidência — separada da DIREÇÃO, calculada por código, nunca escolhida pelo modelo.
 * Não muda `quality_signal` nem `change_signal`, não promove nem rebaixa, não entra em scoring:
 * só diz quão robusto é o texto que sustenta um rótulo que já passou pelas regras.
 *
 * Qualidade (n = reviews DISTINTAS válidas em judging_reviews; concordância = fração da posição que
 * sustenta o rótulo — positive p/ ABOVE, negative p/ BELOW, competent p/ AVERAGE):
 *   LOW 3–4 · MEDIUM 5–9 · HIGH ≥10 E concordância ≥70%. ≥10 sem 70% fica MEDIUM (muita evidência,
 *   direção menos unânime). INCONCLUSIVE ⇒ null: não há direção para medir a força.
 * Os cortes saem da distribuição medida (reviews que julgam a arte no prompt: p50 2 · p75 4 · p90 6;
 * com o pool visível: p50 3 · p75 6 · p90 12). Parâmetros iniciais de produto.
 *
 * Mudança (d = reviews DISTINTAS com trecho literal válido em change_evidence; SEM piso de 3 — fala
 * de mudança é rara: ≥3 reviews em só 7% do catálogo): LOW 1 · MEDIUM 2–3 · HIGH ≥4.
 * NO_CLEAR_SIGNAL ⇒ null.
 */
export type ArtStrength = "LOW" | "MEDIUM" | "HIGH"

/**
 * 🧪 O eixo de MUDANÇA/CONSISTÊNCIA é EXPERIMENTAL (decisão de produto, 2026-10-01): é coletado e
 * persistido para acumular dado real, e NÃO entra em scoring, Nota Prevista, ranking, filtro,
 * recomendação nem penalização. Nos gates ele oscilou entre rodadas iguais (mudanças reais
 * encontradas: 5/5 → 2/5 → 3/5) — por isso a marca viaja junto do dado, não só neste comentário.
 * A QUALIDADE não é experimental: é o sinal principal candidato quando `status = "rated"`.
 */
export const ART_CHANGE_EXPERIMENTAL = true as const
export const ART_FORCA_QUALIDADE = { mediaDesde: 5, altaDesde: 10, altaConcordancia: 0.7 } as const
export const ART_FORCA_MUDANCA = { mediaDesde: 2, altaDesde: 4 } as const

export interface ArtEvidenceStrength {
  quality: ArtStrength | null
  /** Fração de judging_reviews na posição que sustenta o rótulo; null sem rótulo direcional. */
  quality_agreement: number | null
  change: ArtStrength | null
  /** Reviews distintas que sustentam a mudança. */
  change_reviews: number
}

export function forcaDaQualidade(
  quality: ArtQualitySignal,
  c: ArtContagens,
): { quality: ArtStrength | null; quality_agreement: number | null } {
  if (quality === "INCONCLUSIVE" || c.total === 0) return { quality: null, quality_agreement: null }
  const suporte = quality === "ABOVE_AVERAGE" ? c.positive : quality === "BELOW_AVERAGE" ? c.negative : c.competent
  const agreement = suporte / c.total
  const k = ART_FORCA_QUALIDADE
  const forca: ArtStrength =
    c.total >= k.altaDesde && agreement >= k.altaConcordancia ? "HIGH" : c.total >= k.mediaDesde ? "MEDIUM" : "LOW"
  return { quality: forca, quality_agreement: agreement }
}

export function forcaDaMudanca(change: ArtChangeSignal, evidencias: readonly ArtEvidence[]): { change: ArtStrength | null; change_reviews: number } {
  const d = new Set(evidencias.map((e) => e.review_id)).size
  if (change === "NO_CLEAR_SIGNAL" || d === 0) return { change: null, change_reviews: change === "NO_CLEAR_SIGNAL" ? 0 : d }
  const k = ART_FORCA_MUDANCA
  return { change: d >= k.altaDesde ? "HIGH" : d >= k.mediaDesde ? "MEDIUM" : "LOW", change_reviews: d }
}

export interface ArtEvidence {
  review_id: string
  excerpt: string
}

export interface ArtJudgingReview {
  review_id: string
  stance: ArtStance
}

export type ArtContagens = Record<ArtStance, number> & { total: number }

export interface ArtAvaliacao {
  version: typeof ART_SIGNAL_VERSION
  status: ArtStatus
  quality_signal: ArtQualitySignal
  change_signal: ArtChangeSignal
  /** Só existe quando `change_signal !== "NO_CLEAR_SIGNAL"`. */
  change_direction: ArtChangeDirection | null
  judging_reviews: ArtJudgingReview[]
  contagens: ArtContagens
  /** Força da evidência, calculada por código — ver `forcaDaQualidade` / `forcaDaMudanca`. */
  evidence_strength: ArtEvidenceStrength
  /** 🧪 O eixo de mudança é experimental — ver `ART_CHANGE_EXPERIMENTAL`. Sempre `true`. */
  change_experimental: typeof ART_CHANGE_EXPERIMENTAL
  quality_evidence: ArtEvidence[]
  change_evidence: ArtEvidence[]
  justification: string
  /** Auditoria: cada regra que mudou o que o modelo devolveu, em texto. */
  rebaixamentos: string[]
  /** Citações descartadas: id inexistente, trecho que não está na review, ou (qualidade) id fora de `judging_reviews`. */
  citacoesDescartadas: number
  /** Itens de `judging_reviews` descartados: id inexistente, posição inválida ou review repetida. */
  julgamentosDescartados: number
}

const evidenciaSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      review_id: { type: "string", description: "Identificador da review citada, ex.: R7." },
      excerpt: { type: "string", description: "Trecho LITERAL, curto e contínuo dessa review, copiado palavra por palavra." },
    },
    required: ["review_id", "excerpt"],
  },
} as const

/** A propriedade `art` da tool `submit_evaluation` — na variante com Arte (produção, v32). */
export const ART_TOOL_PROPERTY = {
  type: "object",
  description:
    "Sinal AUXILIAR sobre a arte, inferido só do que as reviews dizem. Não altera nenhuma nota dos critérios.",
  properties: {
    judging_reviews: {
      type: "array",
      description: "TODAS as reviews que julgam a qualidade da arte (passo 1), uma vez cada, sem trecho.",
      items: {
        type: "object",
        properties: {
          review_id: { type: "string", description: "Identificador da review, ex.: R7." },
          stance: { type: "string", enum: [...ART_STANCES] },
        },
        required: ["review_id", "stance"],
      },
    },
    quality_signal: { type: "string", enum: [...ART_QUALITY_SIGNALS] },
    quality_evidence: { ...evidenciaSchema, description: "Até 3 reviews DIFERENTES de judging_reviews que sustentam quality_signal." },
    change_signal: { type: "string", enum: [...ART_CHANGE_SIGNALS] },
    change_direction: {
      type: "string",
      enum: [...ART_CHANGE_DIRECTIONS],
      description: "Só quando change_signal ≠ NO_CLEAR_SIGNAL.",
    },
    change_evidence: { ...evidenciaSchema, description: "Trechos que sustentam change_signal." },
    justification: { type: "string", description: "No máximo 2 frases, só sobre a arte." },
  },
  required: ["judging_reviews", "quality_signal", "quality_evidence", "change_signal", "change_evidence", "justification"],
} as const

/**
 * A instrução de Arte — anexada ao FIM do user prompt da variante com Arte (v32). Não toca o
 * SYSTEM_PROMPT nem as regras dos 11: a citação de reviews é uma exceção declarada SÓ para `art`.
 * É a do `art3` (passos que param no 1º que decide; mudança restrita à execução visual) com o
 * passo 1 materializado em `judging_reviews`.
 */
export const INSTRUCAO_ARTE = [
  'ARTE — preencha também o objeto "art" da tool. É um sinal AUXILIAR: não altera nenhuma nota dos critérios acima. Use só o que as REVIEWS dizem da arte.',
  "",
  "quality_signal — siga os passos EM ORDEM e pare no primeiro que decidir:",
  '1. Liste em judging_reviews TODAS as reviews que JULGAM a qualidade da arte ("the art is gorgeous", "the anatomy is bad", "the drawings are decent"), cada uma uma vez, com a posição: positive (elogia), negative (critica), competent (descreve como competente, adequada ou mediana), mixed (elogia e critica em medida parecida). NÃO entram: menção solta à arte; capa, Full Color, tags; tradução, scans, edição ou upload; história, personagens ou ritmo; gosto pessoal isolado ("not my cup of tea"); frase que só diz que a arte mudou, melhorou ou piorou, sem julgar o nível dela.',
  "2. Menos de 3 reviews em judging_reviews ⇒ INCONCLUSIVE. Pare.",
  "3. Opiniões divididas, sem direção predominante clara ⇒ INCONCLUSIVE. Pare.",
  "4. Só agora escolha a direção, pesando TODAS as reviews de judging_reviews (não só as que vai citar):",
  "- ABOVE_AVERAGE: predominância clara de positive; ressalvas leves não mudam a direção.",
  "- BELOW_AVERAGE: predominância clara de negative; críticas isoladas não bastam.",
  "- AVERAGE: competent é a posição mais frequente. Exige esse julgamento de mediania nas reviews.",
  'AVERAGE NUNCA é saída para dúvida: se a sua conclusão é "evidência insuficiente", "menos de 3 reviews", "sem predominância clara" ou "conflito sem direção", o rótulo é INCONCLUSIVE — nunca AVERAGE "por cautela".',
  "Exemplos de princípio: 3 julgam, todas claramente positivas ⇒ pode ser ABOVE_AVERAGE · 15 julgam, 3 positivas e 12 negativas ⇒ não é ABOVE_AVERAGE · 8 julgam, 4 fortes a favor e 4 fortes contra ⇒ INCONCLUSIVE · 2 julgam, ambas muito positivas ⇒ INCONCLUSIVE.",
  "Uma fase melhor ou pior só muda quality_signal se, no conjunto, ela domina a percepção da obra inteira; a trajetória em si vai para change_signal.",
  "",
  "change_signal — só há mudança se uma review disser que a ARTE (desenho, traço, estilo visual, cores, anatomia, execução visual) mudou AO LONGO da obra (capítulos, temporadas, troca de artista):",
  "- NO_CLEAR_SIGNAL: sem essa evidência. Na dúvida, é este.",
  "- CHANGE_NOTED: a arte mudou, sem evidência de que isso prejudicou a experiência.",
  "- PROBLEMATIC_CHANGE: leitores dizem que a mudança da arte prejudicou a qualidade ou a experiência.",
  'NÃO é mudança de arte: troca de tradução, de grupo, de scans, de edição ou de upload (inclusive "another group/team took over" sem dizer que é o artista); mudança no ritmo ou na história, mesmo "depois do capítulo X"; inconsistência ocasional entre painéis ("sometimes", "at times", "in some panels").',
  "change_direction só quando há mudança: IMPROVED, WORSENED ou MIXED_OR_UNCLEAR. Mudança NÃO implica piora.",
  "",
  'EVIDÊNCIA — só trechos de REVIEWS. Nunca: a imagem da capa; notas e votos de plataforma; popularidade; a história; as notas dos critérios; o título; obras similares; tags de formato ("Full Color", webtoon, "Elaborate Art Style"). A tag "Art Style Change" é só alerta para procurar mudança nas reviews.',
  'CITAÇÃO — EXCEÇÃO SÓ DENTRO DE "art": cite o id da review (R1, R2…) e um trecho LITERAL, curto e CONTÍNUO dela. A regra de não citar reviews nem IDs continua valendo para o summary e para as justificativas dos critérios.',
  'As citações são EXEMPLOS da conclusão, não a lista das reviews consideradas. quality_evidence: até 3 reviews DIFERENTES de judging_reviews que sustentam o rótulo. Não use reticências para pular texto nem corte antes de "but", "though", "mas", "porém". Eixo sem trecho citável ⇒ INCONCLUSIVE ou NO_CLEAR_SIGNAL.',
  'justification: no máximo 2 frases, com o balanço do conjunto (ex.: "a maioria das ~10 reviews que julgam a arte elogia; 2 criticam o traço").',
].join("\n")

/**
 * Normaliza para comparar trecho × review: caixa, espaços, aspas tipográficas, entidades e
 * marcação HTML/Markdown — aplicada aos DOIS lados, então só remove diferença de GRAFIA, nunca
 * cria no texto da review uma palavra que o leitor não escreveu.
 *
 * Medido no piloto de 2026-09-27: 3 de 7 citações descartadas eram literais e caíam só por
 * grafia (`it’s` × `it's`; `<b>…</b>` citado sem as tags). Paráfrase, id trocado e trecho unido
 * por reticências CONTINUAM descartados.
 */
export function paraComparar(texto: string): string {
  return texto
    .replace(/＜/g, "<")
    .replace(/＝/g, "=")
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\*\*|__|~~/g, " ")
    .replace(/(^|[\s\p{P}])[*_]+|[*_]+(?=[\s\p{P}]|$)/gu, "$1 ")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/ ([:;,.!?])/g, "$1")
    .trim()
    .toLowerCase()
}

const TRECHO_MINIMO = 8
const ID_REVIEW = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : "")

const noEnum = <T extends string>(lista: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (lista as readonly string[]).includes(v)

function validarEvidencias(
  raw: unknown,
  textoPorId: ReadonlyMap<string, string>,
  permitidos: ReadonlySet<string> | null,
): { validas: ArtEvidence[]; descartadas: number } {
  const lista = Array.isArray(raw) ? raw : []
  const validas: ArtEvidence[] = []
  let descartadas = 0
  for (const item of lista) {
    const id = ID_REVIEW((item as { review_id?: unknown } | null)?.review_id)
    const bruto = (item as { excerpt?: unknown } | null)?.excerpt
    const excerpt = typeof bruto === "string" ? bruto.trim() : ""
    const texto = textoPorId.get(id)
    const ok =
      texto != null &&
      (permitidos == null || permitidos.has(id)) &&
      excerpt.length >= TRECHO_MINIMO &&
      paraComparar(texto).includes(paraComparar(excerpt))
    if (ok) validas.push({ review_id: id, excerpt })
    else descartadas++
  }
  return { validas, descartadas }
}

function contar(julgamentos: readonly ArtJudgingReview[]): ArtContagens {
  const c: ArtContagens = { positive: 0, negative: 0, competent: 0, mixed: 0, total: julgamentos.length }
  for (const j of julgamentos) c[j.stance]++
  return c
}

/** Arte que não dá para ler: os dois eixos em abstenção, com o motivo registrado. */
function invalida(motivo: string): ArtAvaliacao {
  return {
    version: ART_SIGNAL_VERSION,
    status: "invalid",
    quality_signal: "INCONCLUSIVE",
    change_signal: "NO_CLEAR_SIGNAL",
    change_direction: null,
    judging_reviews: [],
    contagens: contar([]),
    evidence_strength: { quality: null, quality_agreement: null, change: null, change_reviews: 0 },
    change_experimental: ART_CHANGE_EXPERIMENTAL,
    quality_evidence: [],
    change_evidence: [],
    justification: "",
    rebaixamentos: [motivo],
    citacoesDescartadas: 0,
    julgamentosDescartados: 0,
  }
}

/**
 * Valida e normaliza o `art` devolvido pelo modelo. Só REBAIXA — nenhuma regra promove um rótulo.
 *
 * @param reviews o que o modelo RECEBEU: id (R1…Rn) e o texto como foi enviado.
 *
 * Estrutura (falha ⇒ `invalid`): `art` objeto; `quality_signal` e `change_signal` no enum;
 * `judging_reviews` lista.
 *
 * Qualidade, nesta ordem (cada aplicação vai para `rebaixamentos`):
 *   A. menos de 3 reviews distintas, existentes e com posição válida ⇒ INCONCLUSIVE
 *   B. ABOVE_AVERAGE com positive < 60% ⇒ INCONCLUSIVE
 *   C. BELOW_AVERAGE com negative < 60% ⇒ INCONCLUSIVE
 *   D. AVERAGE sem competent como MAIOR grupo (empate não é maior) ⇒ INCONCLUSIVE
 *   E. rótulo direcional sem nenhuma citação literal válida de review em judging_reviews ⇒ INCONCLUSIVE
 *
 * Mudança (regras do `art3`): sem citação literal válida ⇒ NO_CLEAR_SIGNAL; direção sem mudança é
 * descartada; mudança sem direção válida ⇒ MIXED_OR_UNCLEAR. A citação de mudança NÃO precisa estar
 * em `judging_reviews` — frase só sobre trajetória não julga o nível (passo 1).
 */
export function normalizarArte(
  raw: unknown,
  reviews: ReadonlyArray<{ id: string; text: string }>,
): ArtAvaliacao {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalida("art ausente ou não é objeto")
    const r = raw as Record<string, unknown>
    if (!noEnum(ART_QUALITY_SIGNALS, r.quality_signal)) {
      return invalida(`quality_signal fora do contrato (${JSON.stringify(r.quality_signal)})`)
    }
    if (!noEnum(ART_CHANGE_SIGNALS, r.change_signal)) {
      return invalida(`change_signal fora do contrato (${JSON.stringify(r.change_signal)})`)
    }
    if (!Array.isArray(r.judging_reviews)) return invalida("judging_reviews ausente ou não é lista")

    const rebaixamentos: string[] = []
    const textoPorId = new Map(reviews.map((x) => [x.id.trim().toUpperCase(), x.text]))

    // judging_reviews: só id existente, posição válida e review ainda não vista
    const judging: ArtJudgingReview[] = []
    const vistos = new Set<string>()
    let julgamentosDescartados = 0
    for (const item of r.judging_reviews) {
      const id = ID_REVIEW((item as { review_id?: unknown } | null)?.review_id)
      const stance = (item as { stance?: unknown } | null)?.stance
      if (!textoPorId.has(id) || !noEnum(ART_STANCES, stance) || vistos.has(id)) {
        julgamentosDescartados++
        continue
      }
      vistos.add(id)
      judging.push({ review_id: id, stance })
    }
    if (julgamentosDescartados > 0) {
      rebaixamentos.push(`${julgamentosDescartados} item(ns) de judging_reviews descartado(s) (id inexistente, posição inválida ou repetido)`)
    }
    const contagens = contar(judging)

    let quality: ArtQualitySignal = r.quality_signal
    const rebaixar = (motivo: string) => {
      rebaixamentos.push(`quality_signal ${quality} ⇒ INCONCLUSIVE: ${motivo}`)
      quality = "INCONCLUSIVE"
    }
    const q = validarEvidencias(r.quality_evidence, textoPorId, vistos)
    const c = validarEvidencias(r.change_evidence, textoPorId, null)

    if (quality !== "INCONCLUSIVE") {
      const fr = (n: number) => (contagens.total === 0 ? 0 : n / contagens.total)
      if (contagens.total < ART_PISO_REVIEWS) rebaixar(`${contagens.total} review(s) julgando a arte (piso ${ART_PISO_REVIEWS})`)
      else if (quality === "ABOVE_AVERAGE" && fr(contagens.positive) < ART_PREDOMINANCIA_MINIMA)
        rebaixar(`positive ${contagens.positive}/${contagens.total} abaixo de ${ART_PREDOMINANCIA_MINIMA * 100}%`)
      else if (quality === "BELOW_AVERAGE" && fr(contagens.negative) < ART_PREDOMINANCIA_MINIMA)
        rebaixar(`negative ${contagens.negative}/${contagens.total} abaixo de ${ART_PREDOMINANCIA_MINIMA * 100}%`)
      else if (
        quality === "AVERAGE" &&
        !(contagens.competent > Math.max(contagens.positive, contagens.negative, contagens.mixed))
      )
        rebaixar(`competent (${contagens.competent}) não é o maior grupo`)
      else if (q.validas.length === 0) rebaixar("nenhuma citação literal válida de review em judging_reviews")
    }

    let change: ArtChangeSignal = r.change_signal
    if (change !== "NO_CLEAR_SIGNAL" && c.validas.length === 0) {
      rebaixamentos.push(`change_signal ${change} sem trecho válido ⇒ NO_CLEAR_SIGNAL`)
      change = "NO_CLEAR_SIGNAL"
    }
    let direction: ArtChangeDirection | null = null
    if (change === "NO_CLEAR_SIGNAL") {
      if (r.change_direction != null) rebaixamentos.push("change_direction sem mudança ⇒ descartada")
    } else if (noEnum(ART_CHANGE_DIRECTIONS, r.change_direction)) {
      direction = r.change_direction
    } else {
      rebaixamentos.push("mudança sem change_direction válida ⇒ MIXED_OR_UNCLEAR")
      direction = "MIXED_OR_UNCLEAR"
    }

    const changeEvidence = change === "NO_CLEAR_SIGNAL" ? [] : c.validas
    return {
      version: ART_SIGNAL_VERSION,
      status: quality === "INCONCLUSIVE" ? "abstained" : "rated",
      quality_signal: quality,
      change_signal: change,
      change_direction: direction,
      judging_reviews: judging,
      contagens,
      evidence_strength: { ...forcaDaQualidade(quality, contagens), ...forcaDaMudanca(change, changeEvidence) },
      change_experimental: ART_CHANGE_EXPERIMENTAL,
      quality_evidence: quality === "INCONCLUSIVE" ? [] : q.validas,
      change_evidence: changeEvidence,
      justification: typeof r.justification === "string" ? r.justification.trim() : "",
      rebaixamentos,
      citacoesDescartadas: q.descartadas + c.descartadas,
      julgamentosDescartados,
    }
  } catch (err) {
    // Nunca deixar Arte derrubar os 11: qualquer surpresa vira `invalid`, com o motivo.
    return invalida(`erro ao normalizar art: ${err instanceof Error ? err.message : String(err)}`)
  }
}
