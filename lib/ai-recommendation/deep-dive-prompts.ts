import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import { POST_READING_WEIGHT_LABELS, type PostReadingScoreField } from "@/lib/constants/post-reading-criteria"
import type {
  CandidateReview,
  DeepDiveAlternativeCandidate,
  DeepDiveContext,
  DeepDiveSimilarsBundle,
  DeepDiveWorkBundle,
  TasteProfilePayload,
} from "./types"

const CRITERIA_LIST_TEXT = CRITERION_SLUGS
  .map((slug) => `- ${slug} (${CRITERIA_INFO[slug]?.name ?? slug})`)
  .join("\n")

const POST_CRITERIA_LIST_TEXT = (Object.keys(POST_READING_WEIGHT_LABELS) as PostReadingScoreField[])
  .map((field) => `- ${field} (${POST_READING_WEIGHT_LABELS[field]})`)
  .join("\n")

// ============================================================
// DEEP_DIVE_SYSTEM_PROMPT
// ============================================================
// Consultor IA Deep Dive: análise profunda de UMA obra. Diferente
// do Smart Shortlist (re-rank de N candidatos), aqui o objetivo é
// responder "essa obra vale meu tempo agora?" — com extended
// thinking habilitado, output estruturado rico e recomendação
// acionável (agora/guardar/evitar).
// ============================================================
export const DEEP_DIVE_SYSTEM_PROMPT = `Você é um Consultor de Leitura que faz uma ANÁLISE PROFUNDA de UMA obra contra o perfil de gosto do usuário e a biblioteca dele. Diferente de um ranking de candidatos, aqui o foco é DECISÃO INFORMADA: "essa obra vale meu tempo agora?".

Você recebe:
- PERFIL DE GOSTO consolidado (loved/avoided tags, criterion_preferences, narrative_patterns, summary).
- HISTÓRICO RECENTE: últimas obras que o user re-avaliou (sinal de mood/foco atual).
- OBRA ALVO: sinopse + tags agrupadas + 9 category_scores IA + plataforma + até 10 reviews citáveis (rotuladas R1..R10).
- OBRAS SIMILARES NA BIBLIOTECA: amadas (user_score ≥ 7) e evitadas (≤ 5), com similaridade semântica via embeddings.
- POOL DE ALTERNATIVAS: top-N do último Smart Shortlist (apenas IDs+títulos+alignment), pode ser vazio.
- CONTEXTO/MOOD do user (opcional): "quero algo curto", "tô no mood de drama denso", etc.

PRINCÍPIOS:

1. **Profundidade > Brevidade.** Você tem extended thinking — use pra cruzar evidências. Não cabe a um Deep Dive entregar 2 frases vagas. Mas evite encheção: cada campo deve ter substância concreta.
   - Quando presente, a **Nota Esperada (L1)** é a predição offline do sistema (qual nota o user provavelmente daria). Use-a como âncora: seu \`match_score\` deve ser coerente com ela ou explicar o porquê da divergência. Se vier marcada como stub/baixa confiança, pese-a menos.

2. **Cite evidência o tempo todo.** Reviews vêm rotuladas R1..R10. Quando uma decisão depende de review, cite o ID na justificativa (ex.: "pacing irregular [R3, R7]"). NÃO INVENTE reviews. Se a obra não tem reviews fornecidas, declare isso em \`review_synthesis.consensus\` ("Sem reviews externas") e mantenha o resto da análise via tags/scores/perfil.

3. **\`match_score\` (0–100) é um VEREDITO ABSOLUTO**, não um percentil. Escala:
   - 90+ : match excepcional, várias evidências convergentes
   - 70–89 : forte, vale priorizar
   - 50–69 : moderado, depende de mood
   - 30–49 : fraco, só com mood muito específico
   - <30 : pouco alinhado, mesmo bons elementos isolados não compensam
   Não comprima tudo no meio. Se você estaria 95% confiante de que o user vai amar, dê 90+. Se há sinais conflitantes, abaixe.

4. **\`confidence\` (0–1) é META-AVALIAÇÃO**: quanto VOCÊ confia no seu próprio match_score. Use 0.9+ apenas quando há múltiplas evidências convergentes (tags loved + criterion fit + reviews positivas + similar amadas). Use 0.5–0.7 quando há sinais mistos ou poucas reviews. <0.5 quando informação é escassa.

5. **\`one_liner\` (≤ 200 chars)**: 1 frase em PT-BR resumindo o vereditto. Direta, sem adjetivos vazios. Ex.: "Slow-burn político com FL de agência forte — encaixa no que você ama, mas drama denso de 350+ capítulos."

ALIGNMENT BREAKDOWN — coração da análise:

6. **\`tags_pros\` / \`tags_cons\`**: tags da obra que reforçam ou contradizem o perfil. \`impact\` (0–1) é o peso dessa tag pra ESTE user (cruze com loved_tags.strength e avoided_tags.strength). \`why\` em 1 frase específica. Não liste tags genéricas (ex.: "manhwa") — só o que mexe o ponteiro.

7. **\`criteria_pros\` / \`criteria_cons\`**: os 9 critérios IA ou os 8 post_*_score onde a obra brilha/falha pelo perfil do user. \`criterion\` deve ser um slug exato dos listados abaixo. \`ideal_range\` vem de criterion_preferences[slug] (ideal_min, ideal_max). \`score\` é o valor real da obra. \`why\` explica o gap/match em 1 frase.

8. **\`narrative_match\`**: pra cada padrão do perfil que esta obra encarna (ou viola), traga \`pattern\` (citação literal do narrative_patterns do perfil) + \`evidence\` (1 frase com base em sinopse/tags/reviews). Mínimo 1, máx 4 itens. Se nenhum pattern encaixa, retorne array vazio.

SIMILAR IN LIBRARY:

9. **\`similar_in_library\`**: para cada obra fornecida em "Obras similares" (não invente IDs):
   - Se user_score ≥ 7: \`alignment_signal: "positive"\` (sinal de match — "se você amou X, vai gostar")
   - Se user_score ≤ 5: \`alignment_signal: "negative"\` (sinal de risco — "lembra X que você não curtiu")
   - Caso intermediário ou sem score: \`alignment_signal: "neutral"\`
   \`similarity_reason\` em 1 frase comparando narrativa/tone, NÃO genérica. \`user_score\` deve ser o user_score fornecido (use 0 se ausente).
   Inclua TODAS as similares fornecidas (até 8). Não invente novas. O drawer mostra cards baseados nessas entradas.

REVIEW SYNTHESIS:

10. **\`review_synthesis\`**: três campos sobre as reviews fornecidas:
    - \`consensus\`: 1–3 frases com o que TODAS as reviews concordam (ex.: pacing, arte, FL).
    - \`divergence\`: 1–3 frases com pontos onde reviews discordam (ex.: alguns acham ending fraco, outros amam).
    - \`flags\`: 0–3 alertas pontuais (frases ≤ 80 chars, ex.: "ending precipitado", "violência gráfica recorrente").
    Se não houver reviews, ponha "Sem reviews externas." em consensus e divergence; flags vazio.

MOOD MATCH:

11. **\`mood_match\`**: SOMENTE quando o user enviou \`userContext\`. Avalie quão a obra se encaixa NO CONTEXTO específico, independente do match_score geral.
    - \`fit\` (0–1): 0.9+ se a obra é perfeita pro mood; 0.3 se contradiz mood; 0.5 neutro.
    - \`why\`: 1 frase ligando obra ↔ mood explicitamente.
    Se \`userContext\` não foi enviado, retorne \`mood_match: null\`. NÃO INVENTE mood.

READ RECOMMENDATION (decisão acionável):

12. **\`read_recommendation.when\`**: classe da decisão:
    - \`"agora"\`: alignment forte + mood favorável + sem flags graves. Vale parar tudo e começar.
    - \`"guardar"\`: bom match mas com ressalvas (timing, drama denso quando mood é leve, capítulos demais). Vai entrar na lista, mas não é o próximo.
    - \`"evitar"\`: contradições importantes — tag avoided forte presente, similar avoided com user_score baixo, mood incompatível, flags graves.
    Seja honesto: não force "agora" só por educação. "Evitar" é informação útil.

13. **\`reasoning\`** (2–4 frases): por que essa decisão. Sintetiza alignment + mood + risco. Use linguagem direta em PT-BR.

14. **\`suggested_alternative_id\`** (UUID, opcional): quando \`when\` é "evitar" ou "guardar" E o POOL DE ALTERNATIVAS foi fornecido E você identifica uma obra do pool que melhor encaixa naquele mood/contexto. Use APENAS um \`id\` que aparece no pool. Se o pool é vazio, omita o campo. Se \`when\` é "agora", omita o campo. Não invente IDs.

REGRAS FINAIS:

15. **Não retorne texto livre.** Sempre use a tool \`submit_deep_analysis\`.
16. **Português brasileiro.** Direto e específico. Sem marketing.
17. **work_ids são UUIDs** que aparecem na request — não invente, não modifique.
18. **Use o extended thinking** pra cruzar evidência (tags ↔ perfil ↔ reviews ↔ similares ↔ mood). Output final estruturado, raciocínio interno fica no thinking.

CRITÉRIOS IA DISPONÍVEIS (use estes slugs em \`alignment_breakdown.criteria_*\`):
${CRITERIA_LIST_TEXT}

CRITÉRIOS PÓS-LEITURA DISPONÍVEIS (use estes slugs em \`alignment_breakdown.criteria_*\` quando comparar com post_*_score do user):
${POST_CRITERIA_LIST_TEXT}`

// ============================================================
// User prompt builder
// ============================================================

function truncate(text: string | null | undefined, maxChars: number): string {
  if (!text) return ""
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`
}

function formatTagsByGroup(tags: Array<{ name: string; group: string | null }>): string {
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
    .map(([group, names]) => `${group}(${names.join(", ")})`)
  if (ungrouped.length) parts.push(`(sem-grupo: ${ungrouped.join(", ")})`)
  return parts.join("; ")
}

function formatCategoryScores(scores: Partial<Record<string, number>>): string {
  const entries = CRITERION_SLUGS
    .map((slug) => {
      const v = scores[slug]
      return v != null ? `${slug}=${v.toFixed(1)}` : null
    })
    .filter((s): s is string => s !== null)
  return entries.length ? entries.join(", ") : "(sem category_scores)"
}

function formatPostScores(scores: Partial<Record<string, number>>): string {
  const fields = Object.keys(POST_READING_WEIGHT_LABELS) as PostReadingScoreField[]
  const entries = fields
    .map((field) => {
      const v = scores[field]
      if (v == null) return null
      return `${field}=${v}`
    })
    .filter((s): s is string => s !== null)
  return entries.length ? entries.join(", ") : ""
}

function formatReviewsWithIds(reviews: CandidateReview[]): string {
  if (!reviews || reviews.length === 0) return "reviews: (nenhuma review externa disponível)"
  const lines = ["reviews:"]
  reviews.forEach((r, idx) => {
    const star = r.rating != null ? `★${r.rating.toFixed(1)}` : "★?"
    lines.push(`  [R${idx + 1}] [${r.source} ${star}] "${truncate(r.text, 320)}"`)
  })
  return lines.join("\n")
}

function formatWorkBundle(work: DeepDiveWorkBundle): string {
  const lines: string[] = [
    `OBRA ALVO`,
    `work_id: ${work.id}`,
    `título: "${work.title}"`,
    `tags: ${formatTagsByGroup(work.tags)}`,
  ]
  if (work.synopsis) lines.push(`sinopse: ${truncate(work.synopsis, 1200)}`)
  lines.push(`category_scores (IA): ${formatCategoryScores(work.categoryScores)}`)
  if (work.expectedScore != null) {
    const stub = work.expectedIsStub ? " (stub/poucos labels — baixa confiança)" : ""
    const fit = work.fit != null ? `; fit_score=${work.fit.toFixed(2)} (0–1)` : ""
    lines.push(`Nota Esperada (L1): ${work.expectedScore.toFixed(2)}${stub}${fit}`)
  }
  const post = formatPostScores(work.postScores)
  if (post) lines.push(`post_scores: ${post}`)
  if (work.platformAvg != null) {
    const votes = work.totalVotes ? ` (${work.totalVotes} votos)` : ""
    lines.push(`platform_avg: ${work.platformAvg.toFixed(2)}${votes}`)
  }
  lines.push(formatReviewsWithIds(work.reviews))
  return lines.join("\n")
}

function formatSimilarsBundle(similars: DeepDiveSimilarsBundle): string {
  const lines: string[] = ["OBRAS SIMILARES NA BIBLIOTECA"]

  if (similars.loved.length === 0 && similars.avoided.length === 0) {
    lines.push("(nenhuma obra similar suficientemente avaliada na biblioteca)")
    return lines.join("\n")
  }

  if (similars.loved.length > 0) {
    lines.push("", `AMADAS (user_score ≥ 7):`)
    similars.loved.forEach((w) => {
      const score = w.userScore != null ? w.userScore.toFixed(1) : "—"
      const sim = (w.similarity * 100).toFixed(0)
      lines.push(`  - work_id=${w.id} sim=${sim}% nota=${score} — "${w.title}"`)
      if (w.synopsis) lines.push(`    sinopse: ${truncate(w.synopsis, 250)}`)
    })
  }

  if (similars.avoided.length > 0) {
    lines.push("", `EVITADAS (user_score ≤ 5):`)
    similars.avoided.forEach((w) => {
      const score = w.userScore != null ? w.userScore.toFixed(1) : "—"
      const sim = (w.similarity * 100).toFixed(0)
      lines.push(`  - work_id=${w.id} sim=${sim}% nota=${score} — "${w.title}"`)
      if (w.synopsis) lines.push(`    sinopse: ${truncate(w.synopsis, 250)}`)
    })
  }

  return lines.join("\n")
}

function formatAlternatives(alternatives: DeepDiveAlternativeCandidate[]): string {
  if (alternatives.length === 0) {
    return `POOL DE ALTERNATIVAS\n(vazio — não há Smart Shortlist recente; OMITA suggested_alternative_id no read_recommendation)`
  }
  const lines = [
    `POOL DE ALTERNATIVAS (top-${alternatives.length} do Smart Shortlist mais recente — use APENAS estes IDs em suggested_alternative_id):`,
  ]
  alternatives.forEach((alt) => {
    const align = alt.alignmentScore != null ? `align=${Math.round(alt.alignmentScore)}` : "align=?"
    lines.push(`  - id=${alt.id} ${align} — "${alt.title}"`)
  })
  return lines.join("\n")
}

function formatRecentActivity(
  activity: Array<{ id: string; title: string; userScore: number | null; updatedAt: string }>,
): string {
  if (activity.length === 0) {
    return `HISTÓRICO RECENTE\n(sem mudanças recentes em user_score)`
  }
  const lines = [`HISTÓRICO RECENTE (últimas ${activity.length} obras com user_score atualizado — pode indicar mood/foco atual):`]
  activity.forEach((a) => {
    const score = a.userScore != null ? a.userScore.toFixed(1) : "—"
    const date = new Date(a.updatedAt).toISOString().slice(0, 10)
    lines.push(`  - ${date}: nota=${score} — "${a.title}"`)
  })
  return lines.join("\n")
}

export interface DeepDivePromptBlocks {
  /** Cacheável (system está em outro slot). Inclui PERFIL DE GOSTO + HISTÓRICO RECENTE. */
  profileBlock: string
  /** Não cacheável: obra alvo + similares + alternativas + mood. Varia por workId/userContext. */
  tailBlock: string
}

export function buildDeepDiveUserPrompt(
  context: DeepDiveContext,
  userContext: string | null | undefined,
): DeepDivePromptBlocks {
  const profileBlock = [
    `PERFIL DE GOSTO (cacheado, base da avaliação):`,
    JSON.stringify(profileForPrompt(context.profile), null, 2),
    "",
    formatRecentActivity(context.recentActivity),
  ].join("\n")

  const tailLines: string[] = []

  const userCtx = userContext?.trim()
  if (userCtx) {
    tailLines.push(
      `CONTEXTO/MOOD DO USUÁRIO (use pra calibrar mood_match e a recomendação):`,
      `"${userCtx}"`,
      "",
    )
  } else {
    tailLines.push(
      `CONTEXTO/MOOD DO USUÁRIO: (não fornecido) → mood_match deve ser null.`,
      "",
    )
  }

  tailLines.push(formatWorkBundle(context.work), "")
  tailLines.push(formatSimilarsBundle(context.similars), "")
  tailLines.push(formatAlternatives(context.alternatives), "")
  tailLines.push(
    `INSTRUÇÃO FINAL: produza a análise via tool \`submit_deep_analysis\` cobrindo TODOS os campos do schema. Use os IDs exatos (UUIDs) fornecidos acima — não invente.`,
  )

  return { profileBlock, tailBlock: tailLines.join("\n") }
}

/**
 * Serialização determinística do perfil pra cache hit consistente.
 * Mantém apenas os campos relevantes pro deep dive em ordem fixa.
 */
function profileForPrompt(profile: TasteProfilePayload): TasteProfilePayload {
  return {
    loved_tags: [...profile.loved_tags].sort((a, b) => a.name.localeCompare(b.name)),
    avoided_tags: [...profile.avoided_tags].sort((a, b) => a.name.localeCompare(b.name)),
    loved_themes: [...profile.loved_themes].sort(),
    avoided_themes: [...profile.avoided_themes].sort(),
    criterion_preferences: profile.criterion_preferences,
    narrative_patterns: profile.narrative_patterns,
    summary: profile.summary,
  }
}
