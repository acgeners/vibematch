/**
 * Nota de Decisão — número único 0–10 ("quão provável é que o user goste desta
 * obra") usado pra escolher a próxima leitura sem olhar 9 critérios.
 *
 * IMPORTANTE: NÃO é a nota que o user daria — é um score de PRIORIDADE. A âncora
 * é a Nota Prevista (expected_score), que JÁ é personalizada (Ridge treinado nas
 * notas reais do user; o alinhamento é a feature nº 1 do modelo).
 *
 * Design (ver plano "Nota Final sem double-counting"):
 *  - A âncora é a Prevista, intacta. O fit NÃO entra aqui: ele já está embutido
 *    na Prevista com peso aprendido (CriterionFitScore, LovedTagOverlap...).
 *    Re-aplicá-lo seria double-counting (versão pior do mesmo sinal). O fit
 *    serve só de DESEMPATE dentro das bandas, na camada de exibição.
 *  - A IA Rk. (alignment_score 0–100) é o ÚNICO ajuste: é um veredito do LLM
 *    INDEPENDENTE, que não está na Prevista. Entra só quando existe (NULL em 29%
 *    das obras) como DESVIO PADRONIZADO — quantos σ ele destoa da própria
 *    distribuição —, ponderado pela confiança e capado em ALIGN_MAX_WEIGHT pra
 *    ajustar, nunca substituir, a previsão calibrada.
 *
 * ⚠️ Até 2026-08-16 este ajuste era `expected×(1−w) + (alignment/10)×w`, e a prosa
 * daqui o chamava de "ajuste" — mas ele DESLOCAVA: o veredito vive numa escala
 * cujo centro fica 2,27 pontos abaixo do da Prevista, então 625 das 695 obras com
 * veredito desciam. Ver `VerdictScale` logo abaixo para os números. A troca de
 * fórmula é a correção; este parágrafo fica como registro de que a descrição
 * antiga estava certa sobre a INTENÇÃO e errada sobre o efeito.
 */

// Peso máximo do veredito do LLM (quando confiança = 1). Capado pra que a IA Rk.
// AJUSTE, mas não substitua, a previsão calibrada.
export const ALIGN_MAX_WEIGHT = 0.35
// Confiança assumida quando o payload não traz `confidence` (runs do prompt v1).
export const DEFAULT_CONFIDENCE = 0.6

/**
 * Quanto o veredito DESATUALIZADO pesa em relação a um fresco.
 *
 * `alignment_stale` diz que os inputs mudaram desde o re-rank — o número existe,
 * mas descreve uma obra que já não é essa. Zerar seria jogar fora evidência real
 * (a obra costuma ter mudado pouco); manter o peso cheio seria afirmar que um
 * veredito de antes vale tanto quanto um de agora. Meio-termo declarado: ele
 * continua opinando, com metade da força.
 */
export const STALE_CONFIDENCE_FACTOR = 0.5

/**
 * A régua do veredito no CATÁLOGO — o que torna o ajuste comparável com a Nota
 * Prevista.
 *
 * 🔴 Existe porque `alignment/10` era uma conversão de UNIDADE, não de ESCALA, e
 * as duas distribuições não se sobrepõem. Medido em 2026-08-16 no clone local
 * (981 obras, 695 com veredito):
 *
 * |  | média (0–100) | dispersão |
 * |---|---|---|
 * | Veredito IA | **54,2** | usa a faixa inteira (p10 25 · p90 79) |
 * | Nota Prevista ×10 | **76,9** | concentrada em 60–90 |
 *
 * Resultado da fórmula antiga: o termo `alignment/10` entrava 2,27 pontos ABAIXO
 * da âncora, então o "ajuste" era um deslocamento para baixo aplicado só a quem
 * tinha veredito — **625 das 695 obras desciam** (média −0,49). Como 29% do
 * catálogo NÃO tem veredito, isso virava ordenação: 37.148 pares invertiam a
 * favor de quem simplesmente não passou pelo re-rank, contra 82 no sentido
 * oposto. A maior alavanca da Prioridade não era o gosto — era ter sido
 * processada.
 *
 * ⚠️ Estes números descrevem o CATÁLOGO, então precisam ser medidos sobre ele e
 * persistidos (`formula_config`), nunca derivados das linhas visíveis numa tela:
 * filtrar mudaria a régua e a mesma obra teria Prioridades diferentes em duas
 * páginas. É o mesmo motivo pelo qual `gpt_mean` mora lá.
 */
export interface VerdictScale {
  /** Média do `alignment_score` (0–100) no catálogo. */
  mean: number
  /** Desvio-padrão do `alignment_score` no catálogo. */
  sd: number
  /** Desvio-padrão da Nota Prevista (0–10) — a escala de destino. */
  expectedSd: number
}

/**
 * Calcula a régua a partir do catálogo inteiro. Devolve `null` quando não há
 * dispersão pra medir (menos de 2 vereditos, ou todos idênticos): sem régua, o
 * ajuste não se aplica — e não aplicar é o lado seguro, porque a Prevista sozinha
 * é a melhor ordenação medida (rho 0,6456).
 */
export function computeVerdictScale(
  rows: Array<{ expected: number | null; alignment: number | null }>,
): VerdictScale | null {
  const alignments = rows.map((r) => r.alignment).filter((a): a is number => a != null)
  const expecteds = rows.map((r) => r.expected).filter((e): e is number => e != null)
  if (alignments.length < 2 || expecteds.length < 2) return null

  const sd = desvio(alignments)
  const expectedSd = desvio(expecteds)
  if (sd === 0 || expectedSd === 0) return null

  return { mean: media(alignments), sd, expectedSd }
}

function media(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

function desvio(xs: number[]): number {
  const m = media(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x))
}

/**
 * Peso EFETIVO do veredito do LLM nesta obra (0–ALIGN_MAX_WEIGHT).
 *
 * 🔴 Exportada porque a UI que EXPLICA a Prioridade tem que mostrar o mesmo peso
 * que o cálculo aplicou. Reescrever `0.35 × confiança` no componente seria a
 * família "dois critérios pro mesmo fato" com um dos lados na tela — e o lado da
 * tela é o que a pessoa acredita. Quem explica deriva daqui; nunca o contrário.
 */
export function decisionAlignWeight(confidence?: number | null, stale?: boolean | null): number {
  const base = ALIGN_MAX_WEIGHT * clamp(confidence ?? DEFAULT_CONFIDENCE, 0, 1)
  return stale ? base * STALE_CONFIDENCE_FACTOR : base
}

export interface DecisionScoreInputs {
  /** Nota Prevista (expected_score) 0–10. Âncora — sem ela não há decisão. */
  expected: number | null
  /** alignment_score do LLM 0–100. NULL = obra ainda não passou pelo re-rank. */
  alignment: number | null
  /** Confiança do modelo 0–1 (alignment_payload.confidence). */
  confidence?: number | null
  /** `alignment_stale`: os inputs mudaram desde o re-rank ⇒ metade do peso. */
  stale?: boolean | null
  /**
   * A régua do veredito no catálogo. **Sem ela o veredito não ajusta nada** e a
   * Prioridade é a Nota Prevista.
   *
   * 🔴 Isso é escolha, não descuido: sem saber onde o veredito desta obra cai em
   * relação aos outros, qualquer conversão de escala é chute — e o chute anterior
   * (`alignment/10`) cobrava um imposto de meio ponto de quem tinha veredito. Não
   * aplicar é o lado seguro e o mais bem medido (Prevista sozinha rho 0,6456
   * contra 0,5828 da fórmula antiga).
   */
  verdictScale?: VerdictScale | null
}

/**
 * Calcula a Prioridade (0–10). Retorna `null` quando não há Nota Prevista (sem
 * âncora calibrada não dá pra decidir). Sem veredito — ou sem régua — é igual à
 * Prevista.
 *
 * A âncora é a Prevista e o veredito entra como DESVIO PADRONIZADO: quantos σ
 * acima ou abaixo da média ele está, convertidos para a escala da Prevista.
 *
 *     z     = (alignment − scale.mean) / scale.sd
 *     score = expected + peso × scale.expectedSd × z
 *
 * Duas propriedades que a fórmula antiga não tinha, e que são a razão da troca:
 *
 *  - **é centrado**: veredito na média do catálogo ⇒ ajuste ZERO. Ninguém sobe ou
 *    desce por ter sido processado, só por destoar da própria distribuição;
 *  - **é comensurável**: um σ de veredito vale um σ de Prevista, então o ajuste
 *    tem o tamanho da variação que já existe no número que ele ajusta.
 *
 * Medido em 2026-08-16 (981 obras do clone local, rho com o `user_score` das 210
 * rotuladas — in-sample, então serve pra comparar as variantes entre si):
 *
 * | variante | shift médio | sobem/descem | inversões pró-sem-veredito | rho |
 * |---|---|---|---|---|
 * | Prevista pura | 0 | — | — | 0,6456 |
 * | `alignment/10` (antiga) | −0,485 | 70/625 | 37.148 | 0,5828 |
 * | centrada na mediana | −0,014 | 336/328 | 14.564 | 0,6226 |
 * | **z-pareado (esta)** | **+0,001** | **367/328** | **2.460** | **0,6433** |
 */
export function computeDecisionScore({
  expected,
  alignment,
  confidence,
  stale,
  verdictScale,
}: DecisionScoreInputs): number | null {
  if (expected == null) return null
  if (alignment == null || verdictScale == null) return clamp(expected, 0, 10)

  const w = decisionAlignWeight(confidence, stale)
  const z = (alignment - verdictScale.mean) / verdictScale.sd
  return clamp(expected + w * verdictScale.expectedSd * z, 0, 10)
}
