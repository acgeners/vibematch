import { computeDecisionScore, decisionAlignWeight } from "@/lib/calculations/decision"
import type { VerdictScale } from "@/lib/calculations/decision"

/**
 * De onde vem a Prioridade de UMA obra — a explicação, não um segundo cálculo.
 *
 * Existe porque a pergunta "por que esta obra está na frente daquela?" não tinha
 * resposta em tela nenhuma, e a ausência produzia uma conclusão errada e razoável:
 * que a Prioridade ignora o Alinhamento, o Interesse, a nota externa e os votos.
 * Ela não ignora — **consome os quatro dentro da Nota Prevista**, com peso
 * APRENDIDO contra as notas reais do dono (`BASELINE_NUMERIC_FEATURES` em
 * lib/calculations/expected.ts). O que a `decision.ts` deixa de fora é a
 * RE-aplicação deles por cima, que seria double-counting.
 *
 * 🔴 Medido em 2026-08-15 (210 obras rotuladas, ridge 5-fold out-of-fold, contra o
 * `user_score` do dono): somar esses sinais de novo NÃO MELHORA a ordenação.
 *
 * | combinação (pesos aprendidos, OOF) | rho com a nota real |
 * |---|---|
 * | **Nota Prevista sozinha** | **0,643** |
 * | Prevista + Alinhamento | 0,649 |
 * | Prevista + Veredito | 0,634 |
 * | os 7 sinais juntos | **0,626** |
 *
 * ⚠️ **"Não melhora" é o que os dados sustentam — "piora" NÃO.** Os dois extremos da
 * tabela têm IC95% cruzando zero: os 7 juntos dão Δrho −0,017 [−0,050, +0,015] com
 * P(melhor) = 16,3%, e a melhor variante dá +0,007 [−0,010, +0,023]. Esta seção já
 * afirmou "ORDENA PIOR", e a UI repetia — inferência além da medição, na tela.
 *
 * O que decide, então, não é a diferença de rho: é que mesmo com os pesos ÓTIMOS não
 * há ganho, e com pesos escritos à mão o resultado só pode ser pior que esse ótimo.
 * (Os externos são os mais fracos contra o gosto do dono — média externa rho 0,271,
 * votos 0,225, contra 0,646 da Prevista.) Replica o gate Fit×Mérito de 07/2026.
 * ⇒ Este módulo EXPLICA a composição; não é o lugar de propor outra.
 *
 * ⚠️ Nada aqui recalcula: o total vem de `computeDecisionScore` e o peso do veredito
 * de `decisionAlignWeight`, os dois donos únicos. Se alguém mudar
 * `ALIGN_MAX_WEIGHT`, esta tela acompanha sozinha.
 */

/** Sinal que a pessoa vê na tela e quer saber onde entra. */
export interface DecisionSignal {
  key: string
  label: string
  /** Já formatado — cada sinal tem unidade própria (%, ♥, 0–10, contagem). */
  value: string | null
  /** O que dizer quando o valor não existe. */
  emptyHint: string
}

export interface DecisionBreakdown {
  /** O número exibido na linha "Prioridade". NULL = sem Nota Prevista. */
  total: number | null
  /** A âncora: Nota Prevista, intacta. */
  expected: number | null
  /** Veredito do LLM 0–100. NULL onde a obra nunca passou pelo re-rank. */
  alignment: number | null
  /** Peso EFETIVO do veredito nesta obra (0–1). 0 quando não há veredito. */
  alignWeight: number
  /** Sinais que já entram na Prevista com peso aprendido — não somados de novo. */
  insideExpected: DecisionSignal[]
  /**
   * Qual ênfase dos 9 atributos está EM VIGOR. Frase própria, e não sufixo da linha
   * de Atributos, porque é a mesma para todas as obras da comparação — pendurá-la no
   * valor gastaria a coluna por-obra repetindo o mesmo texto.
   */
  weightsNote: string
}

export interface DecisionBreakdownInput {
  expected: number | null
  alignment: number | null
  alignmentConfidence?: number | null
  /** Veredito desatualizado ⇒ metade do peso. O painel imprime o peso EFETIVO. */
  alignmentStale?: boolean | null
  /** Régua do catálogo. Sem ela o veredito não ajusta — e o painel diz isso. */
  verdictScale?: VerdictScale | null
  personalFitPercentile: number | null
  /** Interesse que a pessoa DEU (♥..♥♥♥♥). */
  interestManual: string | null
  /** Interesse que a IA PREVIU — usado só quando não há o manual. */
  interestPredicted: string | null
  platformAvg: number | null
  totalVotes: number | null
  /** Quantos dos 9 atributos de IA a obra tem nota. Eles são as features nº 1 do Ridge. */
  attributesScored: number
  /**
   * `formula_config.score_weights_auto`. Decide QUAL ênfase dos 9 atributos está em
   * vigor: os pesos INFERIDOS do histórico de notas (true) ou os que a pessoa
   * declarou em `/preferences` (false).
   *
   * 🔴 Está aqui porque a omissão gerou a pergunta certa — "vocês consideram a
   * ênfase que eu escolhi?". Medido em 2026-08-15: com o auto LIGADO os pesos
   * declarados são só FALLBACK (treino < 20), e os dois divergem em 7 dos 9 —
   * `tragedy` declarado −15 contra +11,4 inferido, sinal INVERTIDO. A tela não pode
   * deixar isso implícito: quem declarou um peso acredita que ele está valendo.
   */
  weightsAuto: boolean
  /** Quantos atributos existem ao todo (os 9 de hoje) — nunca escrito à mão na tela. */
  attributesTotal: number
}

/**
 * ⚠️ Guarda de honestidade: a tela AFIRMA que estes quatro sinais entram na Nota
 * Prevista, e a afirmação só vale enquanto as features existirem no Ridge. Se uma
 * for renomeada ou removida, a frase passa a mentir sem nada acusar — então
 * `tests/unit/calculations/decision-breakdown.test.ts` compara esta lista com
 * `EXPECTED_BASELINE_FEATURES`.
 *
 * 🔴 A comparação mora no TESTE, não aqui, por peso de BUNDLE: quem consome este
 * módulo é `"use client"`, e importar `lib/calculations/expected` levaria
 * `lib/ml/{ridge,preprocessing}` junto pro navegador. Mesmo motivo pelo qual os
 * cortes de arte saíram de `lib/art/model.ts` para `lib/art/bands.ts`.
 */
export const RIDGE_FEATURE_BY_SIGNAL = {
  attributes: "IA(n)",
  alignment: "LovedTagOverlap",
  interest: "SinopseScore",
  platform: "Nota.M",
  votes: "LogVotos",
} as const

const fmt1 = (v: number) => v.toFixed(1).replace(".", ",")

export function buildDecisionBreakdown(input: DecisionBreakdownInput): DecisionBreakdown {
  const total = computeDecisionScore({
    expected: input.expected,
    alignment: input.alignment,
    confidence: input.alignmentConfidence,
    stale: input.alignmentStale,
    verdictScale: input.verdictScale,
  })

  // Interesse: o manual manda; a previsão só preenche a ausência. É a mesma régua do
  // "interesse efetivo" do recalc (server/actions/calculations.ts) — inverter a ordem
  // faria a tela dizer que a IA opinou onde a pessoa já tinha opinado.
  const interesse = input.interestManual
    ? { texto: input.interestManual, origem: " (seu)" }
    : input.interestPredicted
      ? { texto: input.interestPredicted, origem: " (previsto)" }
      : null

  return {
    total,
    expected: input.expected,
    alignment: input.alignment,
    // Sem veredito o peso é ZERO — e não o 0,21 do "padrão". A linha da tela
    // afirmaria um ajuste que não houve.
    // Peso ZERO quando não há veredito OU não há régua — nos dois casos o ajuste
    // não aconteceu, e o painel não pode afirmar um que não houve.
    alignWeight:
      input.alignment == null || input.verdictScale == null
        ? 0
        : decisionAlignWeight(input.alignmentConfidence, input.alignmentStale),
    // 🔴 Nomeia o DONO da ênfase, não só o estado do toggle: "automática" sozinho não
    // diz que a sua declaração está fora de uso, que é justamente o que surpreende.
    weightsNote: input.weightsAuto
      ? "Ênfase dos atributos: automática — aprendida do seu histórico, não a de /preferences."
      : "Ênfase dos atributos: a sua, declarada em /preferences.",
    insideExpected: [
      {
        // Primeiro da lista porque é o insumo mais pesado: as 9 notas entram como
        // features diretas E somadas em `IA(n)` (a Nota.IA, ponderada pela ênfase).
        // ⚠️ A ênfase NÃO vem pendurada aqui: ela é a mesma para todas as obras da
        // comparação, então repeti-la em cada linha gasta a coluna do valor (que é
        // por obra) para dizer sempre a mesma coisa. Sai em `weightsNote`.
        key: "attributes",
        label: "Atributos de IA",
        value: input.attributesScored > 0 ? `${input.attributesScored} de ${input.attributesTotal}` : null,
        emptyHint: "obra ainda não avaliada pela IA",
      },
      {
        key: "alignment",
        label: "Alinhamento",
        value: input.personalFitPercentile == null ? null : `${Math.round(input.personalFitPercentile)}%`,
        emptyHint: "sem perfil de gosto",
      },
      {
        key: "interest",
        label: "Interesse",
        value: interesse ? `${interesse.texto}${interesse.origem}` : null,
        emptyHint: "você ainda não avaliou a sinopse",
      },
      {
        key: "platform",
        label: "Média externa",
        value: input.platformAvg == null ? null : fmt1(input.platformAvg),
        emptyHint: "sem nota nas fontes",
      },
      {
        key: "votes",
        label: "Votos",
        value: input.totalVotes && input.totalVotes > 0 ? input.totalVotes.toLocaleString("pt-BR") : null,
        emptyHint: "sem votos nas fontes",
      },
    ],
  }
}
