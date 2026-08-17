import { CRITERION_SLUGS } from "@/types/domain"
import type {
  BiasCorrelationEntry,
  BiasResidualExample,
  BiasStatsByCriterion,
} from "./types"


export const BIAS_SYSTEM_PROMPT = `Você é um analista estatístico de viés sistemático em notas de critério IA pra um catálogo pessoal de obras. Sua tarefa é, a partir de estatísticas agregadas e exemplos de outliers, diagnosticar se algum critério está sistematicamente alto/baixo ou disperso demais.

CRITÉRIOS DISPONÍVEIS: ${CRITERION_SLUGS.join(", ")}.

REGRAS:
1. \`bias_estimate\` em escala -5..+5, positivo significa que o critério IA está sistematicamente MAIS ALTO do que os sinais do usuário sugerem. Use a evidência das correlações com post_* e dos resíduos user_score − calc_score pra estimar magnitude.
2. \`dispersion\`: low = critério bem ancorado (stdev pequeno consistente com média); medium = variância normal; high = critério inconsistente entre obras com sinais parecidos (atenção: indica que a IA não está calibrada nesse critério).
3. \`confidence\` ∈ [0,1]: 0.8+ quando há evidência clara via correlação + média condicional; mais baixo se sinal misto.
4. \`recommendation\` em português brasileiro, 1–2 frases concretas: o que provavelmente está errado e o que verificar (ex.: "Critério X parece ~1.5 pontos acima do esperado em obras leves; revisar a calibração do range 4–6 da rubrica."). Não recomende ações operacionais (não sugira "rode auditoria"). Só análise.
5. Inclua ENTRY pra TODOS os 9 critérios — quando não houver viés, retorne bias_estimate≈0 com recommendation explicando que está bem calibrado.
6. \`summary\`: parágrafo único (2–4 frases) sintetizando os achados mais relevantes.
7. Use a tool \`submit_bias_report\`. Não retorne texto livre.`








export function buildBiasUserPrompt(
  stats: BiasStatsByCriterion[],
  residuals: BiasResidualExample[],
  correlations: BiasCorrelationEntry[],
): string {
  const lines: string[] = []

  lines.push("ESTATÍSTICAS POR CRITÉRIO (apenas obras com user_score setado):")
  lines.push("slug | n | mean | stdev | p25 | p50 | p75 | mean_high(manual≥8) | mean_low(manual≤4)")
  for (const s of stats) {
    const high = s.meanWhenManualHigh == null ? "—" : s.meanWhenManualHigh.toFixed(2)
    const low = s.meanWhenManualLow == null ? "—" : s.meanWhenManualLow.toFixed(2)
    lines.push(
      `${s.slug} | ${s.n} | ${s.mean.toFixed(2)} | ${s.stdev.toFixed(2)} | ${s.p25.toFixed(1)} | ${s.p50.toFixed(1)} | ${s.p75.toFixed(1)} | ${high} | ${low}`,
    )
  }
  lines.push("")

  lines.push("CORRELAÇÕES PEARSON (post_*_score × category_scores, |r| ≥ 0.20):")
  if (correlations.length === 0) {
    lines.push("(nenhuma correlação relevante)")
  } else {
    for (const c of correlations) {
      lines.push(`${c.postField} × ${c.criterion}: r=${c.pearson.toFixed(2)} (n=${c.n})`)
    }
  }
  lines.push("")

  lines.push("TOP RESÍDUOS — obras com maior |user_score − calc_score| (potenciais outliers):")
  for (const r of residuals) {
    const resid =
      r.calcScore != null ? (r.userScore - r.calcScore).toFixed(2) : "?"
    const scoresStr = CRITERION_SLUGS
      .map((slug) => `${slug}=${r.scoresBySlug[slug]?.toFixed(1) ?? "—"}`)
      .join(", ")
    lines.push(
      `- "${r.title}" manual=${r.userScore.toFixed(1)} calc=${r.calcScore?.toFixed(2) ?? "—"} resíduo=${resid} | ${scoresStr}`,
    )
  }
  lines.push("")

  lines.push(
    `Gere o relatório via \`submit_bias_report\`. Para cada critério, decida bias_estimate, dispersion, confidence e recommendation. Inclua TODOS os ${CRITERION_SLUGS.length} critérios. Português brasileiro.`,
  )

  return lines.join("\n")
}
