/**
 * A confiança da IA NÃO é comparável entre modelos — cada um tem uma RÉGUA.
 *
 * Medido em 2026-07-24 sobre 2.178 avaliações concluídas com confiança
 * (`scripts/diag-confidence-evidence.ts`): as medianas são praticamente IGUAIS
 * (0,75–0,82) mas o TETO difere muito — o Sonnet 5 nunca emitiu ≥ 0,90 (zero em
 * 371 avaliações, máximo 0,88), enquanto o Sonnet 4-6 chegava a 0,95. As
 * distribuições não estão deslocadas, estão TRUNCADAS no alto.
 *
 * Consequência prática: em 680 das 901 obras com nota de IA (75%) a avaliação que
 * respalda as notas atuais veio de uma config diferente da ativa. Pôr as duas
 * confianças lado a lado, no mesmo tamanho e na mesma escala de cor, faz o leitor
 * concluir "adicionei dados e piorou" quando o que mudou foi a régua. Em 50 obras
 * (6%) a confiança atual está ACIMA do teto do modelo de hoje: reavaliar essas
 * "piora" o número por construção, sem que nada tenha piorado.
 *
 * Este módulo NÃO normaliza nada de propósito. Normalizar por quantil/z-score
 * dentro da config foi avaliado e rejeitado: (1) só 21 valores distintos em 2.178
 * avaliações, com 38% da config ativa empatada em 0,75 — o percentil de um valor é
 * um intervalo de 38 pontos, não um ponto; (2) σ varia 3,5× entre configs (0,029 a
 * 0,103), então dividir por σ AMPLIFICA a config comprimida; (3) toda normalização
 * por config exige a distribuição daquela config, que tem n = 0 exatamente no dia
 * em que se troca de modelo — o único dia em que o problema existe.
 *
 * E, sobretudo: a confiança mede VOLUME DE EVIDÊNCIA (rho 0,44 com nº de reviews
 * substantivas, 0,41 com nº de fontes e nº de tags), NÃO acerto da nota. Qualquer
 * transformação monotônica dela continua medindo volume de evidência — só troca a
 * unidade. Ver `REGISTRO-2026-07-24-CONFIANCA-IA.md`.
 */

/** Identidade da régua de uma avaliação: modelo + versão do prompt. */
export interface EvaluationRuler {
  modelName: string | null
  promptVersion: string | null
}

/**
 * Teto de confiança OBSERVADO por família de modelo. NÃO é limite do schema (a
 * tool aceita 0–1) — é o máximo que cada modelo de fato emitiu no nosso corpus.
 *
 * Constante medida, não derivada em runtime: calcular isto por render custaria
 * uma varredura das 2.178 linhas de `ai_evaluations` a cada abertura da tela, com
 * o banco remoto (~300ms/round-trip). Re-medir ao trocar de modelo, com
 * `scripts/diag-confidence-evidence.ts`.
 */
export const OBSERVED_CONFIDENCE_MAX: Record<string, { max: number; n: number }> = {
  "claude-sonnet-5": { max: 0.88, n: 371 },
  "claude-sonnet-4-6": { max: 0.95, n: 1500 },
  "claude-haiku-4-5-20251001": { max: 0.92, n: 297 },
  "claude-opus-4-7": { max: 0.6, n: 4 },
}

/** Amostra mínima pra citar o teto observado como se fosse característica do
 *  modelo. Abaixo disto o "máximo" é só o maior de meia dúzia de sorteios —
 *  o Opus 4.7 tem n=4, e dizer "o Opus nunca passa de 60%" seria inventar. */
const MIN_N_FOR_CEILING_CLAIM = 30

/** Chave canônica da régua — usada só pra comparar, nunca pra exibir. */
export function rulerKey(ruler: EvaluationRuler | null | undefined): string | null {
  if (!ruler?.modelName && !ruler?.promptVersion) return null
  return `${ruler?.modelName ?? "?"}/${ruler?.promptVersion ?? "?"}`
}

/**
 * Rótulo curto pra UI: "claude-sonnet-4-6" + "v19" → "sonnet-4-6/v19". Corta o
 * prefixo "claude-" (redundante em todas as linhas) e o sufixo de data dos ids
 * longos ("claude-haiku-4-5-20251001" → "haiku-4-5").
 */
export function formatRuler(ruler: EvaluationRuler | null | undefined): string | null {
  if (!ruler) return null
  const { modelName, promptVersion } = ruler
  if (!modelName && !promptVersion) return null
  const model = (modelName ?? "?")
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
  return promptVersion ? `${model}/${promptVersion}` : model
}

/**
 * Mesma régua? Só true quando modelo E versão do prompt batem e ambos são
 * conhecidos. Dado faltando conta como régua DIFERENTE: na dúvida a tela avisa,
 * porque o custo de avisar à toa é uma linha de texto e o custo de não avisar é a
 * conclusão errada que motivou este módulo.
 */
export function isSameRuler(
  a: EvaluationRuler | null | undefined,
  b: EvaluationRuler | null | undefined,
): boolean {
  const ka = rulerKey(a)
  const kb = rulerKey(b)
  if (!ka || !kb) return false
  if (ka.includes("?") || kb.includes("?")) return false
  return ka === kb
}

export interface CrossRulerWarning {
  /** Rótulo da régua que produziu a confiança ATUAL (ex.: "sonnet-4-6/v19"). */
  currentLabel: string | null
  /** Rótulo da régua da avaliação NOVA. */
  suggestedLabel: string | null
  /** Só o MODELO da avaliação nova, sem a versão do prompt. O teto observado é
   *  medido por família de modelo (o `n` agrega todas as versões de prompt dele),
   *  então a frase que cita o teto tem que nomear o modelo — dizer "o sonnet-5/v21
   *  nunca passou de 88% em 371 avaliações" atribuiria ao v21 uma amostra que é do
   *  v20 + v21 juntos. */
  suggestedModelLabel: string | null
  /** Teto observado do modelo novo, quando há amostra pra afirmar isso. */
  suggestedCeiling: { max: number; n: number } | null
  /** True quando a confiança atual está ACIMA do teto do modelo novo — aí a queda
   *  é aritmeticamente inevitável, não um sinal de piora. */
  currentAboveCeiling: boolean
}

/**
 * Descreve a incomparabilidade entre a confiança que respalda as notas atuais e a
 * da avaliação nova. Retorna null quando a comparação é LEGÍTIMA (mesma régua) —
 * a tela não deve avisar nesse caso, senão o aviso vira ruído permanente à medida
 * que o catálogo migra pra config ativa.
 */
export function describeCrossRuler(
  current: (EvaluationRuler & { confidence: number | null }) | null | undefined,
  suggested: EvaluationRuler | null | undefined,
): CrossRulerWarning | null {
  if (!current) return null
  if (isSameRuler(current, suggested)) return null
  // Sem procedência do lado "Atual" não há régua pra comparar: as notas em vigor
  // não vieram de IA (manuais/importadas), e o próprio botão já diz "sem avaliação
  // IA". Avisar "réguas diferentes" aí seria ruído — e o `currentEvaluation` chega
  // NÃO-nulo nesse caso, porque ele também carrega as justificativas.
  if (!rulerKey(current)) return null

  const ceilingRaw = suggested?.modelName ? OBSERVED_CONFIDENCE_MAX[suggested.modelName] : undefined
  const suggestedCeiling = ceilingRaw && ceilingRaw.n >= MIN_N_FOR_CEILING_CLAIM ? ceilingRaw : null

  return {
    currentLabel: formatRuler(current),
    suggestedLabel: formatRuler(suggested),
    suggestedModelLabel: formatRuler({
      modelName: suggested?.modelName ?? null,
      promptVersion: null,
    }),
    suggestedCeiling,
    currentAboveCeiling:
      suggestedCeiling != null &&
      current.confidence != null &&
      current.confidence > suggestedCeiling.max,
  }
}

/**
 * Os DOIS cortes que separam confiança alta / média / baixa na tela.
 *
 * 🔴 Dono único, e não estilo: até 2026-08-14 os mesmos `0.75` e `0.5` estavam
 * escritos à mão em `ai-evaluation-review-form.tsx` e em `ai-evaluation-compare.tsx`,
 * e o card do `/ai-evaluation` ia virar a terceira cópia. É a família de erro que o
 * CLAUDE.md chama de "dois critérios pro mesmo fato": duas telas passam a discordar
 * sobre a mesma avaliação ser verde ou âmbar, e nada acusa — o resultado é plausível
 * dos dois lados.
 *
 * ⚠️ Isto colore, NÃO julga acerto. A confiança mede volume de evidência (rho 0,44
 * com nº de reviews) e não é comparável entre modelos — é o assunto do resto deste
 * arquivo. Verde aqui quer dizer "a IA tinha material", nunca "a nota está certa".
 */
export const CONFIDENCE_CUTOFFS = { alta: 0.75, media: 0.5 } as const

export type ConfidenceBand = "alta" | "media" | "baixa"

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_CUTOFFS.alta) return "alta"
  if (confidence >= CONFIDENCE_CUTOFFS.media) return "media"
  return "baixa"
}
