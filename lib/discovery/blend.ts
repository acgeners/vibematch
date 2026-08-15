/**
 * A régua de "Mais como estas" (`/descobrir`): combina PARECENÇA com as obras-semente e
 * ALINHAMENTO com o perfil de quem olha, num número só.
 *
 * Puro de propósito (sem `server-only`, sem I/O): o mesmo cálculo roda no servidor, na
 * reordenação do cliente quando o slider se move, e nos testes.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════
 * 🔴 POR QUE A COMBINAÇÃO É ENTRE PERCENTIS, E NUNCA ENTRE OS VALORES CRUS
 *
 * Os dois eixos vivem em escalas incompatíveis. Medido no clone local em 2026-08-13:
 *
 *   similaridade centralizada  →  faixa útil 0,23 – 0,41
 *   personal_fit cru           →  satura perto de 0,55 mesmo nas melhores obras
 *
 * `0.5 * sim + 0.5 * fit` sobre esses números não significa "meio a meio" — significa
 * "o eixo de maior amplitude decide". Em percentil, o peso do slider é o peso de fato.
 *
 * É a mesma razão pela qual `calculated_scores` guarda `personal_fit_percentile` ao lado
 * do cru, e a UI mostra o percentil: o comentário da migration 071 registra que o cru tem
 * teto ~0,55 e por isso não serve para leitura direta.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════
 * 🔴 O QUE **NÃO** ENTRA NA CONTA, e por quê — medido, não estilo
 *
 * `expected_score` (Nota Prevista): corr(personal_fit, expected_score) = **0,72**. Somar os
 * dois é contar o mesmo eixo duas vezes e afogar a parecença, que é ortogonal aos dois
 * (corr ≈ −0,04 com ambos). Ele acompanha o resultado como COLUNA, para leitura.
 *
 * `alignment_score` (Veredito IA): existe em **510 das 988** obras. Entrar no score puniria
 * em silêncio metade do catálogo por ainda não ter passado pelo re-rank — o mesmo erro de
 * tratar ausência de medição como medição ruim. Também é só coluna.
 */

/** Uma obra candidata, já com os dois eixos brutos resolvidos. */
export interface BlendCandidate {
  workId: string
  /** Similaridade média às sementes, espaço centralizado (~−0,1 a 0,45). */
  simPos: number
  /**
   * A MESMA similaridade com todas as sementes valendo igual — o que `simPos` seria sem a
   * semente principal. Igual a `simPos` quando não há principal.
   *
   * Existe para responder "a estrela mudou alguma coisa?" sem uma 2ª varredura do catálogo
   * (140 KB crus, medidos). Ver `primaryEffectByStep`.
   */
  simPosFlat?: number
  /** Similaridade média às anti-sementes; 0 quando não há nenhuma. */
  simNeg: number
  /**
   * Percentil de Alinhamento (0–100) de QUEM OLHA — `personal_fit_percentile` do overlay.
   * `null` quando a pessoa não tem perfil/modelo: ver `NEUTRAL_FIT_PCT`.
   */
  fitPercentile: number | null
}

export interface BlendedWork extends BlendCandidate {
  /** Similaridade efetiva: `simPos − ANTI_WEIGHT × simNeg`. */
  simEffective: number
  /** Percentil de `simEffective` DENTRO do conjunto avaliado (0–100, midrank). */
  simPercentile: number
  /** O que ordena a lista (0–100). */
  score: number
}

/**
 * Peso da anti-semente na similaridade efetiva.
 *
 * ⚠️ 0,5 e não 1,0: "menos como esta" é uma RESSALVA, não uma negação simétrica. Com peso 1
 * uma anti-semente próxima do eixo das sementes zera obras que o usuário pediu — ele disse
 * "quero vilãs, mas menos harém", não "descarte tudo que lembre harém".
 */
export const ANTI_WEIGHT = 0.5

/**
 * Alinhamento atribuído a quem não tem percentil.
 *
 * 🔴 Neutro (50) e não 0. Sem perfil de gosto — o caso COMUM de conta nova, já que o perfil
 * exige ≥5 obras avaliadas — `personal_fit_percentile` é null para o catálogo inteiro. Com 0,
 * o eixo de alinhamento não ficaria "desligado": ficaria empatado em ZERO, e qualquer peso
 * `w < 1` achataria o score de todas as obras igualmente, fazendo a lista parecer quebrada.
 * Com 50 o eixo simplesmente não desempata, e a parecença decide — que é a degradação certa.
 *
 * ⚠️ Isto NÃO substitui avisar na tela: o slider continua sem efeito visível, e é obrigação
 * da UI dizer por quê (`DiscoveryResult.fitAvailable`).
 */
export const NEUTRAL_FIT_PCT = 50

/** Peso padrão do slider: meio a meio. */
export const DEFAULT_SIM_WEIGHT = 0.5

/**
 * Percentil midrank (0–100) de cada valor dentro do próprio conjunto.
 *
 * ⚠️ Midrank, não posição: valores EMPATADOS têm que receber o mesmo percentil, senão a
 * ordem de chegada vira desempate invisível. É a mesma regra do `personal_fit_percentile`
 * (migration 071) — e vale mais aqui, porque a distribuição de similaridade é densa.
 */
export function midrankPercentiles(values: number[]): number[] {
  const n = values.length
  if (n === 0) return []
  if (n === 1) return [NEUTRAL_FIT_PCT]

  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(n)

  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && order[j + 1].v === order[i].v) j++
    // Média das posições do bloco empatado, normalizada em [0, 100].
    const rank = (i + j) / 2
    const pct = (rank / (n - 1)) * 100
    for (let k = i; k <= j; k++) out[order[k].i] = pct
    i = j + 1
  }

  return out
}

/** Como interpretar o `simPos` que chega. */
export interface BlendOptions {
  /**
   * `true` quando `simPos` JÁ É o percentil (0–100) medido sobre o conjunto completo.
   *
   * 🔴 Sem isto o cliente repercentilava o que já era percentil, e o resultado NÃO era
   * inofensivo. Medido no app: uma obra com as duas barras em 100 exibia combinação **97**,
   * e outra com 99/97 exibia **92** — porque a barra mostra o percentil sobre as 737
   * candidatas e o score usava o percentil recalculado sobre o pool de ~50, enquanto
   * `fitPercentile` passava sem recalcular. Um eixo renormalizado num conjunto já
   * selecionado (e portanto comprimido) contra outro que não é: exatamente a mistura de
   * escalas que o cabeçalho deste arquivo existe para impedir — e ela muda a ORDEM.
   *
   * ⚠️ O comentário no cliente afirmava que reusar o percentil "mantém a régua idêntica à do
   * servidor em vez de recalcular sobre um subconjunto". A intenção estava certa; faltava o
   * código honrá-la.
   */
  percentileInputs?: boolean
}

/**
 * Combina os dois eixos e devolve a lista ORDENADA (melhor primeiro).
 *
 * @param weight 0 = só alinhamento, 1 = só similaridade. Fora de [0,1] é clampado.
 *
 * ⚠️ O percentil de similaridade é calculado sobre TODOS os candidatos recebidos. Filtre
 * (não lidas, adulto, etc.) ANTES de chamar: filtrar depois compara cada obra contra um
 * universo que não é o exibido, e o slider passa a mentir sobre "quão parecida".
 */
export function blendCandidates(
  candidates: BlendCandidate[],
  weight: number = DEFAULT_SIM_WEIGHT,
  opts: BlendOptions = {},
): BlendedWork[] {
  const w = Math.min(1, Math.max(0, weight))
  if (candidates.length === 0) return []

  const effective = candidates.map((c) => c.simPos - ANTI_WEIGHT * c.simNeg)
  // A subtração da anti-semente já entrou no percentil que o servidor mediu, então repetir
  // o percentilamento aqui seria a 2ª transformação sobre o mesmo número.
  const simPcts = opts.percentileInputs ? effective : midrankPercentiles(effective)

  return candidates
    .map((c, i) => {
      const fitPct = c.fitPercentile ?? NEUTRAL_FIT_PCT
      return {
        ...c,
        simEffective: effective[i],
        simPercentile: simPcts[i],
        score: w * simPcts[i] + (1 - w) * fitPct,
      }
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Desempate estável: parecença, depois o id. Sem a 2ª chave, dois scores iguais
        // saem em ordem de chegada do banco e a lista "pula" entre recargas.
        b.simPercentile - a.simPercentile ||
        a.workId.localeCompare(b.workId),
    )
}

/**
 * Quanto o score manda contra a variedade, na hora de montar a lista final.
 *
 * 1 = só score (a lista antes desta régua existir); abaixo disso, entrar na lista fica mais
 * caro para quem já se parece com quem entrou.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════
 * 🔴 0,8 saiu de MEDIÇÃO, e a medição contradisse a média.
 *
 * Pelo agregado não havia problema: a redundância do top-24 era **0,106** contra **0,092**
 * do próprio pool de candidatos — 15% acima, ou seja a lista já era quase tão diversa
 * quanto o conjunto de onde saía. Por OBRA o quadro inverte: **2,4 de 10** obras do top-10
 * tinham ao menos uma quase-duplicata (similaridade > 0,35), com posição mediana **4** —
 * no topo, onde se lê. Medido em 12 conjuntos-semente coerentes, 9.360 pares, 2026-08-13.
 *
 * O trade-off medido:
 *
 *   λ=1,0 (antes)  score 88,1 · redundância 0,106 · 10,2 pares quase-duplicados
 *   λ=0,8          score 87,7 · redundância 0,086 ·  3,9
 *   λ=0,7          score 87,3 · redundância 0,078 ·  1,2
 *
 * ⚠️ **0,8 e não 0,7, de propósito.** λ=0,7 dá números melhores — mas quem escolheu cinco
 * obras de vilã QUER vilã, e diversificar demais trai o pedido. Conferido à mão: os pares
 * acima de 0,6 são obras DISTINTAS de premissa quase idêntica (cinco "The Villainess X"
 * diferentes), não sequências. O que se espaça é a repetição dentro do tema, nunca o tema.
 *
 * ⚠️ Mexer neste número exige remedir. Não é um botão de gosto: é o ponto de equilíbrio
 * entre "a lista que o modelo/percentil ordenou" e "a lista que não repete a mesma obra
 * cinco vezes".
 */
export const DIVERSITY_LAMBDA = 0.8

/**
 * Acima de quantos pares repetidos a lista merece um aviso na tela.
 *
 * 🔴 Derivado da distribuição REAL depois da diversificação, não escolhido a olho. Medido
 * em 12 listas (top-24, λ=0,8): `[0,1,1,2,2,2,2,3,3,4,4,23]` — mediana **2**, p90 **4**, e
 * um único caso de 23 (nicho onde quase tudo se parece e o MMR não tem de onde tirar
 * variedade).
 *
 * ⚠️ A 1ª versão usava `> 3` e teria acendido em **25%** das listas — o alarme que sempre
 * toca, que é justamente o que este projeto evita em `db:health` e no painel "Estado da
 * obra". Com `> 5` dispara em **1 de 12**: só quando a diversificação de fato não deu conta,
 * que é a única hora em que o aviso informa alguma coisa.
 */
export const NEAR_DUPLICATE_WARN_AT = 5

/**
 * A partir de quanta similaridade duas obras contam como "a mesma coisa" para a variedade.
 *
 * 0,35 não é chute: entre os candidatos de uma busca, o p90 dos pares é **0,249** e o
 * vizinho mais próximo médio de uma obra é ~0,43. 0,35 fica acima do p90 — pega o que
 * destoa, não o normal.
 */
export const NEAR_DUPLICATE_SIM = 0.35

/**
 * Os pesos que o slider pode assumir. Discreto de propósito — 11 paradas de 10 em 10.
 *
 * 🔴 É isto que permite o slider reordenar SEM ida ao servidor. A página traz metadados da
 * UNIÃO dos top-N destes pesos (`unionOfTops`), então qualquer parada que o usuário escolha
 * já tem os dados na mão. Com peso contínuo não haveria conjunto finito a pré-carregar: ou
 * o slider viraria um round-trip por pixel arrastado, ou apareceria obra sem título na lista.
 *
 * 10 pontos percentuais é mais fino que a diferença que os dois eixos produzem — medido no
 * catálogo, a lista costuma mudar a cada ~20 pontos de peso.
 */
export const WEIGHT_STEPS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const

/** Arredonda um peso arbitrário para a parada mais próxima do slider. */
export function snapWeight(weight: number): number {
  const w = Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : DEFAULT_SIM_WEIGHT))
  return WEIGHT_STEPS.reduce((best, s) => (Math.abs(s - w) < Math.abs(best - w) ? s : best), 0.5)
}

/**
 * Todas as obras que aparecem no top-N de ALGUM peso do slider, sem repetir.
 *
 * A ordem devolvida é a do peso corrente (primeiro os que o usuário vê agora); o resto vem
 * atrás para que a página possa carregar metadados de tudo numa query só.
 */
export function unionOfTops(
  candidates: BlendCandidate[],
  topN: number,
  currentWeight: number,
): BlendedWork[] {
  if (candidates.length === 0) return []

  const seen = new Set<string>()
  const out: BlendedWork[] = []

  // O peso corrente primeiro: é a lista que a tela mostra antes de qualquer interação.
  for (const b of blendCandidates(candidates, currentWeight).slice(0, topN)) {
    seen.add(b.workId)
    out.push(b)
  }
  for (const step of WEIGHT_STEPS) {
    for (const b of blendCandidates(candidates, step).slice(0, topN)) {
      if (seen.has(b.workId)) continue
      seen.add(b.workId)
      out.push(b)
    }
  }

  return out
}

/**
 * Similaridade entre pares de candidatos: `sim[i][j]`, indexado pela posição no array de
 * entrada. Simétrica, diagonal ignorada.
 */
export type SimMatrix = number[][]

/**
 * Monta a lista final espaçando quem se repete — MMR (maximal marginal relevance).
 *
 * A cada posição escolhe quem maximiza `λ·score − (1−λ)·100·maiorSemelhançaComOsJáEscolhidos`.
 * Com `λ = 1` é exatamente a ordem por score; ver `DIVERSITY_LAMBDA` para de onde vem o 0,8.
 *
 * ⚠️ O termo de penalidade é multiplicado por 100 porque `score` está em 0–100 e a
 * similaridade em 0–1. Sem isso a penalidade seria centésimos de ponto — o λ pareceria
 * aplicado e não mudaria nada, que é a pior forma de "ligado sem efeito".
 *
 * ⚠️ `sim` pode vir incompleto (obra sem embedding, matriz não carregada): o que falta conta
 * como 0, ou seja "não se parece com nada" — a obra concorre só pelo score. Errar para o
 * lado de NÃO penalizar mantém a lista igual à de antes em vez de esconder obra por engano.
 */
export function diversify(
  ranked: BlendedWork[],
  sim: SimMatrix,
  k: number,
  lambda: number = DIVERSITY_LAMBDA,
): BlendedWork[] {
  const lam = Math.min(1, Math.max(0, lambda))
  if (ranked.length === 0 || k <= 0) return []
  // λ = 1 é a identidade; sair cedo evita percorrer a matriz à toa.
  if (lam >= 1) return ranked.slice(0, k)

  const restantes = ranked.map((_, i) => i)
  const escolhidos: number[] = []
  const out: BlendedWork[] = []

  while (out.length < k && restantes.length > 0) {
    let melhor = 0
    let melhorValor = -Infinity

    for (let p = 0; p < restantes.length; p++) {
      const i = restantes[p]
      let maxSim = 0
      for (const j of escolhidos) {
        const s = sim[i]?.[j] ?? 0
        if (s > maxSim) maxSim = s
      }
      const valor = lam * ranked[i].score - (1 - lam) * 100 * maxSim
      if (valor > melhorValor) {
        melhorValor = valor
        melhor = p
      }
    }

    const idx = restantes.splice(melhor, 1)[0]
    escolhidos.push(idx)
    out.push(ranked[idx])
  }

  return out
}

/**
 * Quantos pares da lista são quase-duplicatas — o número que a diversificação existe para
 * baixar, e o único jeito honesto de dizer se ela está funcionando.
 */
export function countNearDuplicates(
  works: Array<{ index: number }>,
  sim: SimMatrix,
  threshold: number = NEAR_DUPLICATE_SIM,
): number {
  let n = 0
  for (let a = 0; a < works.length; a++) {
    for (let b = a + 1; b < works.length; b++) {
      if ((sim[works[a].index]?.[works[b].index] ?? 0) > threshold) n++
    }
  }
  return n
}

/**
 * Quantas obras do top-N mudam entre as duas pontas do slider.
 *
 * Não é enfeite: é o que responde "esse controle faz alguma coisa?". Quando o número é
 * baixo, as sementes e o perfil concordam e o slider é decorativo naquela busca — vale
 * dizer isso em vez de deixar a pessoa arrastar à toa.
 */
export function extremesDivergence(candidates: BlendCandidate[], topN: number): number {
  if (candidates.length === 0) return 0
  const onlySim = blendCandidates(candidates, 1).slice(0, topN).map((c) => c.workId)
  const onlyFit = new Set(blendCandidates(candidates, 0).slice(0, topN).map((c) => c.workId))
  return onlySim.filter((id) => !onlyFit.has(id)).length
}

/**
 * Faixas de coesão das sementes — a média dos pares que `seed_pair_similarity` devolve
 * (migration 192).
 *
 * Os cortes vêm de medição, não de gosto (2026-08-13): sementes vizinhas entre si dão
 * coesão ~0,33 e um top-10 com similaridade 0,266; sementes aleatórias dão ~0,00 e 0,169 —
 * **36% mais fraco**. No espaço centralizado o acaso é exatamente 0, então "perto de zero"
 * é literalmente "estas obras não têm nada em comum".
 */
export const COHESION_WEAK = 0.15
export const COHESION_STRONG = 0.28

export type CohesionLevel = "unknown" | "weak" | "fair" | "strong"

export function classifyCohesion(cohesion: number | null): CohesionLevel {
  if (cohesion == null) return "unknown"
  if (cohesion < COHESION_WEAK) return "weak"
  if (cohesion < COHESION_STRONG) return "fair"
  return "strong"
}

/**
 * Um par de sementes e a similaridade entre elas — o que `seed_pair_similarity` devolve
 * (migration 192). Triângulo superior: cada par aparece UMA vez.
 *
 * 🔴 Tudo o que a tela diz sobre "eixo em comum" sai DAQUI, e é de propósito. Antes o SQL
 * devolvia a média pronta, e a média sozinha acende o alarme sem conseguir apagá-lo: ela
 * não sabe qual semente está fora. Com os pares, as três leituras (coesão, coesão ancorada
 * e leave-one-out) são o MESMO dado visto de três ângulos, em vez de três contas que podem
 * discordar.
 */
export interface SeedPair {
  a: string
  b: string
  sim: number
}

function pairsWithin(pairs: SeedPair[], ids: string[]): SeedPair[] {
  const set = new Set(ids)
  return pairs.filter((p) => set.has(p.a) && set.has(p.b))
}

/**
 * Coesão de um conjunto: a média dos pares internos a ele.
 *
 * `null` com menos de 2 sementes — não existe "coesão" de um ponto só, e devolver 0 ali
 * seria indistinguível de "sem eixo em comum", que é justamente o alarme.
 */
export function cohesionOf(pairs: SeedPair[], ids: string[]): number | null {
  if (ids.length < 2) return null
  const relevantes = pairsWithin(pairs, ids)
  if (relevantes.length === 0) return null
  return relevantes.reduce((acc, p) => acc + p.sim, 0) / relevantes.length
}

/**
 * Coesão ANCORADA numa semente principal: só os pares que a tocam.
 *
 * 🔴 A pergunta muda junto com a busca, e é por isso que este número existe. Sem principal,
 * "as N obras apontam para o mesmo lugar?" — todos os pares pesam igual. Com uma âncora, a
 * pergunta é "as outras reforçam ESTA?", e o par entre duas coadjuvantes deixa de decidir:
 * nenhuma das duas está dirigindo a busca.
 *
 * ⚠️ Isto NÃO é refinamento — é o que impede o card contradizer a própria busca. Medido no
 * mockup com números reais: um trio pode dar 0,09 ("sem eixo em comum") por todos os pares
 * e 0,17 ("eixo fraco") ancorado, porque as duas coadjuvantes estão ABAIXO do acaso entre
 * si. Sem esta leitura, o alarme condena uma busca bem dirigida.
 */
export function anchoredCohesionOf(
  pairs: SeedPair[],
  ids: string[],
  primaryId: string | null,
): number | null {
  if (!primaryId || !ids.includes(primaryId) || ids.length < 2) return null
  const tocam = pairsWithin(pairs, ids).filter((p) => p.a === primaryId || p.b === primaryId)
  if (tocam.length === 0) return null
  return tocam.reduce((acc, p) => acc + p.sim, 0) / tocam.length
}

/** Qual semente puxa a coesão para baixo, e para quanto ela iria sem essa semente. */
export interface WeakestSeed {
  id: string
  before: number
  after: number
}

/**
 * Leave-one-out: tira cada semente, recalcula, e devolve aquela cuja remoção mais SOBE a
 * coesão. É o que transforma "estas obras não têm um eixo em comum" em algo acionável.
 *
 * 🔴 `null` com menos de 3 sementes, e não é limitação a contornar: com 2, remover uma deixa
 * zero pares e cai abaixo do mínimo da busca. A tela precisa de um ramo próprio ali — dizer
 * "tire esta" quando não sobra busca nenhuma seria um conselho que não se pode seguir.
 *
 * 🔴 Com PRINCIPAL, mede na régua ANCORADA — e isso não é refinamento. O card decide o
 * veredito pela leitura ancorada quando há estrela; medir a culpada pela geral punha, a dois
 * centímetros um do outro, um "sem ela: −0,05 → 0,28" que não se refere ao número que o
 * veredito usa. Visto na tela em 2026-08-15, antes de existir este parâmetro. E a principal
 * NÃO entra como candidata a remoção: tirá-la não melhora a ancoragem, acaba com ela.
 *
 * ⚠️ Esta função NÃO decide se vale nomear a culpada; ela só mede. Quem decide é a tela, pela
 * troca de FAIXA (`classifyCohesion(after) !== classifyCohesion(before)`) — critério que não
 * precisa de um limiar inventado. Um limiar numérico aqui seria escolhido a olho, e este
 * projeto já pagou por isso; medir a distribuição de ganhos reais e cortá-la seria melhor,
 * e não foi feito.
 */
export function weakestSeed(
  pairs: SeedPair[],
  ids: string[],
  primaryId: string | null = null,
): WeakestSeed | null {
  if (ids.length < 3) return null

  const ancorada = primaryId != null && ids.includes(primaryId)
  const medir = (conjunto: string[]) =>
    ancorada ? anchoredCohesionOf(pairs, conjunto, primaryId) : cohesionOf(pairs, conjunto)

  const before = medir(ids)
  if (before == null) return null

  let melhor: WeakestSeed | null = null
  for (const id of ids) {
    if (ancorada && id === primaryId) continue
    const resto = ids.filter((x) => x !== id)
    const after = medir(resto)
    if (after == null) continue
    if (melhor === null || after > melhor.after) melhor = { id, before, after }
  }
  return melhor != null && melhor.after > melhor.before ? melhor : null
}

/** Quanto a semente principal mexeu no topo, num peso do slider. */
export interface PrimaryEffect {
  /** Quantas obras do top-N entram ou saem por causa dela. */
  enters: number
  /** Quantas apenas mudam de posição. */
  moves: number
}

/**
 * O efeito da principal em CADA parada do slider.
 *
 * 🔴 Um array de 11, e não um número, pela mesma razão que `unionOfTops` existe: o slider
 * reordena no cliente, sem ir ao servidor. Um único número ficaria correto no peso em que
 * foi calculado e passaria a mentir no primeiro arraste — e mentiria em silêncio, que é o
 * pior formato. O efeito depende MESMO do peso: medido, a mesma estrela reordena 4 posições
 * em 50% e 7 em 100%.
 *
 * ⚠️ Comparar contra o pool exibível não serviria: obra que sai do top-10 pode nem estar no
 * pool. Chame com o conjunto INTEIRO de candidatos.
 */
export function primaryEffectByStep(candidates: BlendCandidate[], topN: number): PrimaryEffect[] {
  const semPrincipal = candidates.map((c) => ({ ...c, simPos: c.simPosFlat ?? c.simPos }))

  return WEIGHT_STEPS.map((w) => {
    const com = blendCandidates(candidates, w).slice(0, topN).map((b) => b.workId)
    const sem = blendCandidates(semPrincipal, w).slice(0, topN).map((b) => b.workId)

    const base = new Set(sem)
    const enters = com.filter((id) => !base.has(id)).length
    let moves = 0
    com.forEach((id, i) => {
      if (sem[i] !== id) moves++
    })
    return { enters, moves }
  })
}
