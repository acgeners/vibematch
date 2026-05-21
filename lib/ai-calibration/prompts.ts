import { CRITERIA_INFO, CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { POST_READING_WEIGHT_LABELS, type PostReadingScoreField } from "@/lib/constants/post-reading-criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import type {
  AuditWorkInput,
  BiasCorrelationEntry,
  BiasResidualExample,
  BiasStatsByCriterion,
} from "./types"

function rubricsBlock(): string {
  return CRITERION_SLUGS
    .map((slug) => {
      const info = CRITERIA_INFO[slug]
      const rubric = CRITERIA_RUBRICS[slug]
      const ranges = rubric?.ranges ? `\n${rubric.ranges.map((r) => `  ${r}`).join("\n")}` : ""
      return `- ${slug} (${info?.name ?? slug}): ${info?.description ?? ""}${ranges}`
    })
    .join("\n\n")
}

export const AUDIT_SYSTEM_PROMPT = `Você é um auditor das notas de critério (category_scores) de obras catalogadas (manhwa, anime, manga). Sua tarefa é detectar inconsistências entre os scores atuais e os outros sinais disponíveis (tags, sinopse, manual_score do usuário, critérios pós-leitura, observações), sugerindo ajustes pontuais.

REGRAS GERAIS:
1. NUNCA sugira ajuste pra critérios cujo source seja "manual" ou "ai_edited" — esses estão travados pelo usuário e são âncoras. Eles aparecem no input pra contexto, mas não em audits[].
2. Só emita uma sugestão quando o ajuste for ≥ 0.5 ponto em valor absoluto. Mudanças menores que isso são ruído.
3. \`confidence\` ∈ [0,1]: 0.9+ = certeza forte com evidência múltipla; 0.7–0.89 = boa evidência; 0.5–0.69 = palpite informado. Não retorne sugestões com confidence < 0.5.
4. \`justification\` em português brasileiro, 1–2 frases citando tags/sinopse/observação específicas que sustentam o ajuste. Cite o critério pelo nome quando útil.
5. Mantenha o \`manual_score\` como sinal forte: se ele é 9 mas vários critérios estão baixos sem motivo, provavelmente os critérios estão subestimados. Inverso também vale.
6. Os 8 \`post_*_score\` são sinais auxiliares do usuário pós-leitura, em escala diferente (2/4/6.5/8/10). Use-os como contexto, não como verdade absoluta. Mapeamentos esperados:
   - post_story ↔ qualidade geral da narrativa
   - post_pacing ↔ inversamente correlacionado com slow burn / fortemente com action_adventure
   - post_impact_immersion ↔ drama + protagonist + tragedy
   - post_fl / post_ml ↔ protagonist (e couple_dynamics quando há romance)
7. Saída SEMPRE via tool \`submit_audits\`. Não escreva texto livre.

ESCALAS DE REFERÊNCIA (0–10 nos 9 critérios IA):

${rubricsBlock()}`

export const BIAS_SYSTEM_PROMPT = `Você é um analista estatístico de viés sistemático em notas de critério IA pra um catálogo pessoal de obras. Sua tarefa é, a partir de estatísticas agregadas e exemplos de outliers, diagnosticar se algum critério está sistematicamente alto/baixo ou disperso demais.

CRITÉRIOS DISPONÍVEIS: ${CRITERION_SLUGS.join(", ")}.

REGRAS:
1. \`bias_estimate\` em escala -5..+5, positivo significa que o critério IA está sistematicamente MAIS ALTO do que os sinais do usuário sugerem. Use a evidência das correlações com post_* e dos resíduos manual_score − calc_score pra estimar magnitude.
2. \`dispersion\`: low = critério bem ancorado (stdev pequeno consistente com média); medium = variância normal; high = critério inconsistente entre obras com sinais parecidos (atenção: indica que a IA não está calibrada nesse critério).
3. \`confidence\` ∈ [0,1]: 0.8+ quando há evidência clara via correlação + média condicional; mais baixo se sinal misto.
4. \`recommendation\` em português brasileiro, 1–2 frases concretas: o que provavelmente está errado e o que verificar (ex.: "Critério X parece ~1.5 pontos acima do esperado em obras leves; revisar a calibração do range 4–6 da rubrica."). Não recomende ações operacionais (não sugira "rode auditoria"). Só análise.
5. Inclua ENTRY pra TODOS os 9 critérios — quando não houver viés, retorne bias_estimate≈0 com recommendation explicando que está bem calibrado.
6. \`summary\`: parágrafo único (2–4 frases) sintetizando os achados mais relevantes.
7. Use a tool \`submit_bias_report\`. Não retorne texto livre.`

function truncate(text: string | null | undefined, maxChars: number): string {
  if (!text) return ""
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`
}

function formatTagsByGroup(tags: AuditWorkInput["tags"]): string {
  if (!tags.length) return "(sem tags)"
  const grouped = new Map<string, string[]>()
  const ungrouped: string[] = []
  for (const tag of tags) {
    if (!tag.group) {
      ungrouped.push(tag.name)
      continue
    }
    const list = grouped.get(tag.group)
    if (list) list.push(tag.name)
    else grouped.set(tag.group, [tag.name])
  }
  const parts = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, names]) => `${group}(${names.slice(0, 8).join(", ")})`)
  if (ungrouped.length) parts.push(`(sem-grupo: ${ungrouped.slice(0, 8).join(", ")})`)
  return parts.join("; ")
}

function formatCategoryScores(work: AuditWorkInput): { lockedLines: string[]; openLines: string[] } {
  const lockedLines: string[] = []
  const openLines: string[] = []
  for (const slug of CRITERION_SLUGS) {
    const entry = work.categoryScores[slug]
    if (!entry) {
      openLines.push(`${slug}: ausente`)
      continue
    }
    const tag = `${slug}=${entry.score.toFixed(1)} (source=${entry.source})`
    if (entry.source === "manual" || entry.source === "ai_edited") {
      lockedLines.push(tag)
    } else {
      openLines.push(tag)
    }
  }
  return { lockedLines, openLines }
}

function formatPostScores(scores: Partial<Record<string, number>>): string {
  const fields = Object.keys(POST_READING_WEIGHT_LABELS) as PostReadingScoreField[]
  const entries = fields
    .map((field) => {
      const v = scores[field]
      if (v == null) return null
      const short = field.replace(/^post_/, "").replace(/_score$/, "")
      return `${short}=${v}`
    })
    .filter((s): s is string => s !== null)
  return entries.length ? entries.join(", ") : "(sem critérios pós-leitura)"
}

export function buildAuditUserPrompt(works: AuditWorkInput[]): string {
  const lines: string[] = [
    `Lote de ${works.length} obra(s) pra auditoria. Cada bloco tem todos os sinais: tags, sinopse, observações do usuário, manual_score (anchor principal), post_*_score (sinal auxiliar) e os 9 category_scores com seu source atual.`,
    "",
    `Para cada obra, avalie os critérios cujo source ∉ {manual, ai_edited} (os com source manual/ai_edited são âncoras travadas — não sugira ajuste). Emita uma entrada em \`audits\` apenas quando achar inconsistência ≥ 0.5 ponto E confidence ≥ 0.5.`,
    "",
  ]

  works.forEach((w, i) => {
    const tag = `[W${i + 1}] work_id=${w.workId}`
    lines.push(tag)
    lines.push(`"${w.title}"`)
    lines.push(`manual_score: ${w.manualScore.toFixed(1)}/10${w.isFavorite ? "  ★favorito" : ""}`)
    lines.push(`tags: ${formatTagsByGroup(w.tags)}`)
    if (w.synopsis) lines.push(`sinopse: ${truncate(w.synopsis, 600)}`)
    if (w.observation) lines.push(`observação do usuário: ${truncate(w.observation, 400)}`)
    lines.push(`post_*: ${formatPostScores(w.postScores)}`)
    const { lockedLines, openLines } = formatCategoryScores(w)
    if (lockedLines.length) {
      lines.push(`category_scores ÂNCORAS (não sugerir mudança): ${lockedLines.join(", ")}`)
    }
    lines.push(`category_scores ABERTOS PRA AUDITORIA: ${openLines.join(", ")}`)
    lines.push("")
  })

  lines.push(
    `Use a tool \`submit_audits\`. Cada entry referencia work_id exato + criterion_slug. Limite cada justificativa a 1–2 frases concretas em português brasileiro.`,
  )

  return lines.join("\n")
}

export function buildBiasUserPrompt(
  stats: BiasStatsByCriterion[],
  residuals: BiasResidualExample[],
  correlations: BiasCorrelationEntry[],
): string {
  const lines: string[] = []

  lines.push("ESTATÍSTICAS POR CRITÉRIO (apenas obras com manual_score setado):")
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

  lines.push("TOP RESÍDUOS — obras com maior |manual_score − calc_score| (potenciais outliers):")
  for (const r of residuals) {
    const resid =
      r.calcScore != null ? (r.manualScore - r.calcScore).toFixed(2) : "?"
    const scoresStr = CRITERION_SLUGS
      .map((slug) => `${slug}=${r.scoresBySlug[slug]?.toFixed(1) ?? "—"}`)
      .join(", ")
    lines.push(
      `- "${r.title}" manual=${r.manualScore.toFixed(1)} calc=${r.calcScore?.toFixed(2) ?? "—"} resíduo=${resid} | ${scoresStr}`,
    )
  }
  lines.push("")

  lines.push(
    `Gere o relatório via \`submit_bias_report\`. Para cada critério, decida bias_estimate, dispersion, confidence e recommendation. Inclua TODOS os ${CRITERION_SLUGS.length} critérios. Português brasileiro.`,
  )

  return lines.join("\n")
}
