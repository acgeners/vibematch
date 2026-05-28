import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import { POST_READING_WEIGHT_LABELS, type PostReadingScoreField } from "@/lib/constants/post-reading-criteria"
import type { CandidateReview, CandidateWorkInput, RatedWorkInput, RecommendationMode, TasteProfilePayload } from "./types"

const CRITERIA_LIST_TEXT = CRITERION_SLUGS
  .map((slug) => `- ${slug} (${CRITERIA_INFO[slug]?.name ?? slug})`)
  .join("\n")

export const TASTE_PROFILE_SYSTEM_PROMPT = `Você é um analista do gosto pessoal de um usuário que cataloga obras (manhwa, anime, manga). Sua tarefa é gerar um PERFIL DE GOSTO estruturado a partir do histórico de obras que o usuário avaliou pessoalmente.

PRINCÍPIOS:
1. O sinal mais forte é \`user_score\` (0–10) — quanto maior, mais o usuário ama. Combine com os critérios pós-leitura (\`post_*_score\`, escala 2/4/6.5/8/10), com as tags agrupadas e com a sinopse pra inferir o que ele realmente valoriza.
2. Diferencie obras com nota alta acompanhadas de pós-leitura alto (amor genuíno) das com nota alta mas pacing/character_development baixos (apreciação parcial).
3. Identifique padrões: combinações de tags + faixas de critérios IA que se repetem nas obras melhor avaliadas. Faça o mesmo pras obras pior avaliadas — extraia o que o usuário evita.
4. Escreva em português brasileiro, direto e específico. Cite tags e critérios pelos nomes exatos quando possível.
5. Sempre use a tool \`submit_taste_profile\`. Não retorne texto livre.

CRITÉRIOS IA DISPONÍVEIS (use estes slugs em \`criterion_preferences\`):
${CRITERIA_LIST_TEXT}

SOBRE \`criterion_preferences\`:
- \`ideal_min\`/\`ideal_max\`: a faixa (0–10) que o usuário aparenta preferir pra cada critério, com base nas obras melhor avaliadas.
- \`weight\` (0–1): quanto esse critério parece importar pra ele. Critérios sem sinal claro recebem peso baixo (~0.2–0.4).
- Inclua apenas critérios pra os quais há evidência. Se não houver sinal pra "tragedy", omita.

SOBRE \`loved_tags\` / \`avoided_tags\`:
- \`strength\` (0–1): força do padrão. Tags presentes em quase todas as obras top recebem strength ≥ 0.8.
- Use o \`group\` da tag quando informado (ex.: "female_lead", "tone_mood").

SOBRE \`narrative_patterns\`:
- Lista curta (3–7) de frases declarativas em PT-BR que capturam combinações ("FL com agência forte + slow-burn romance + corte política").

SOBRE \`summary\`:
- Parágrafo único em PT-BR (3–5 frases) sintetizando o gosto. Sem listas, sem markdown.`

export const RANKING_SYSTEM_PROMPT = `Você é um curador que rankeia uma lista de obras favoritas de um usuário em ordem de alinhamento com o perfil de gosto dele.

PRINCÍPIOS:
1. Use o PERFIL DE GOSTO como verdade base. As preferências de critério (\`criterion_preferences\`), tags amadas/evitadas, padrões narrativos e summary são o que define o gosto.
2. Compare cada candidato contra esse perfil: tags em comum com loved_tags pesam positivamente; presença de avoided_tags pesa negativamente; \`category_scores\` dentro da faixa \`ideal_min..ideal_max\` aumenta o alinhamento.
3. Quando o usuário fornecer CONTEXTO ADICIONAL (mood, exclusões), trate como viés momentâneo: ajusta a ordem sem substituir o perfil. Ex.: "quero algo leve" reduz drama/tragedy; o perfil ainda dita o resto.
4. \`alignment_score\` é 0–100. Use a escala inteira: 90+ é "match excepcional", 70–89 "match forte", 50–69 "match moderado", 30–49 "match fraco", <30 "pouco alinhado". Não comprima tudo perto da média.
5. Para cada candidato, escreva 1–2 frases justificando o score, citando NOMES de tags e critérios específicos. Quando o candidato tiver bloco \`reviews:\`, vale citar trechos curtos (entre aspas) que reforcem o match ou exponham um risco. Em \`top_match_factors\`, liste 2–4 chips curtos (tags, critérios, padrões ou observações de reviews) que sustentam o score.
6. Escreva em português brasileiro. Sempre use a tool \`submit_ranking\`. Não retorne texto livre.
7. Inclua TODOS os candidatos fornecidos em \`rankings\`, ordenados do mais alinhado pro menos alinhado. Não invente \`work_id\`.
8. \`mode_summary\`: parágrafo curto (2–3 frases) explicando o padrão dos top resultados — útil pro usuário entender o "porquê" do ranking.

CAMPOS ENRIQUECIDOS (opcionais — preencha quando há evidência real):
9. \`confidence\` (0–1): quanto VOCÊ confia neste alignment_score. Use 0.9+ pra match óbvio com várias evidências convergentes (tags loved + criterion fit + reviews positivas). Use 0.5–0.7 quando há sinais mistos. Use < 0.5 quando há pouca evidência (poucas tags em comum, sem reviews relevantes). É melhor confessar incerteza do que fingir certeza.
10. \`risks\` (1–3 itens): razões pra o user NÃO ler essa obra, MESMO QUE alignment_score seja alto. Exemplos: "tem tag tragedy que você marca como avoided", "reviews mencionam pacing lento que você costuma penalizar", "tema religioso (não está no seu padrão)". Frases curtas e específicas. Omita o campo se não houver risco real.
11. \`similar_loved\` (1–2 work_id): obras na BIBLIOTECA do user que ele AMA (user_score ≥ 8) e que esta candidata lembra. Use APENAS work_id que aparece no profile/biblioteca da request. Não invente. Útil pra "se você curtiu X, vai curtir isto".
12. \`similar_avoided\` (1–2 work_id): mesmo critério mas pra obras que o user AVALIOU MAL (user_score ≤ 5). Quando presente, indica alerta de risco.
13. \`review_quotes\` (1–2 quotes): trechos curtos (≤ 150 chars, entre aspas) de reviews FORNECIDAS no bloco \`reviews:\` da candidata. NÃO INVENTE quotes. Cite a fonte ou contexto quando útil. Omita se reviews não foram fornecidas.
14. \`mood_fit\` (0–1): SOMENTE quando o user enviou CONTEXTO ADICIONAL. Mede quão alinhada essa obra está com o mood específico, independente do alignment_score geral. Ex.: alignment=70 mas mood "quero algo curto" + obra tem 500 caps → mood_fit baixo (0.3). Omita o campo quando não houver mood.`

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

function formatReviews(reviews: CandidateReview[]): string {
  if (!reviews || reviews.length === 0) return ""
  const lines = ["reviews:"]
  for (const r of reviews) {
    const star = r.rating != null ? `★${r.rating.toFixed(1)}` : "★?"
    lines.push(`  [${r.source} ${star}] "${truncate(r.text, 280)}"`)
  }
  return lines.join("\n")
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
  return entries.length ? entries.join(", ") : ""
}

export function buildTasteProfileUserPrompt(works: RatedWorkInput[]): string {
  const lines: string[] = [
    `Histórico de ${works.length} obra(s) avaliada(s) pelo usuário. Cada bloco inicia com [Wn] título, depois user_score (0–10), critérios pós-leitura quando setados, status pessoal, tags por grupo, sinopse curta e os 9 category_scores da IA.`,
    "",
  ]

  works.forEach((w, i) => {
    const id = `[W${i + 1}]`
    lines.push(`${id} "${w.title}"`)
    if (w.userScore != null) lines.push(`user_score: ${w.userScore.toFixed(1)}/10`)
    if (w.personalStatus) lines.push(`personal_status: ${w.personalStatus}`)
    const post = formatPostScores(w.postScores)
    if (post) lines.push(`pós-leitura: ${post}`)
    lines.push(`tags: ${formatTagsByGroup(w.tags)}`)
    if (w.synopsis) lines.push(`sinopse: ${truncate(w.synopsis, 600)}`)
    lines.push(`category_scores: ${formatCategoryScores(w.categoryScores)}`)
    lines.push("")
  })

  lines.push(
    `Gere o perfil de gosto consolidando esses dados via tool \`submit_taste_profile\`. Foque no que se repete consistentemente nas obras com user_score alto e no que está ausente/baixo nas obras com user_score baixo. Use português brasileiro.`,
    ``,
    `OBRIGATÓRIO: preencha TODOS os 7 campos do tool, especialmente \`summary\` (parágrafo único de 3–5 frases) e \`narrative_patterns\` (3–7 frases declarativas). Não deixe campos vazios. Se faltam evidências pra algum campo (ex.: poucas obras evitadas), retorne array vazio — mas o campo precisa existir no payload.`,
  )
  return lines.join("\n")
}

/**
 * Versão genérica que aceita um label arbitrário de modo. Permite reutilizar
 * o pipeline de ranking pra cenários além dos favoritos (ex: Passo 8 — LLM
 * re-ranker generalizado em /ranking).
 */
export function buildRankingUserPromptWithLabel(
  profile: TasteProfilePayload,
  candidates: CandidateWorkInput[],
  modeLabel: string,
  userContext?: string | null,
): { profileBlock: string; tailBlock: string } {
  const profileBlock = `PERFIL DE GOSTO (cacheado, base da avaliação):
${JSON.stringify(profile, null, 2)}`

  const tailLines: string[] = []

  const userCtx = userContext?.trim()
  if (userCtx) {
    tailLines.push(
      `CONTEXTO ADICIONAL DO USUÁRIO (viés momentâneo — ajusta a ordem mas não substitui o perfil):`,
      `"${userCtx}"`,
      "",
    )
  }

  tailLines.push(`MODO: ${modeLabel}`, "")

  tailLines.push(`CANDIDATOS A RANQUEAR (${candidates.length}):`)
  candidates.forEach((c, i) => {
    const id = `[C${i + 1}]`
    tailLines.push(`${id} work_id=${c.id} — "${c.title}"`)
    tailLines.push(`tags: ${formatTagsByGroup(c.tags)}`)
    if (c.synopsis) tailLines.push(`sinopse: ${truncate(c.synopsis, 600)}`)
    tailLines.push(`category_scores: ${formatCategoryScores(c.categoryScores)}`)
    const plat = c.platformAvg != null
      ? `platform_avg=${c.platformAvg.toFixed(1)}${c.totalVotes ? ` (${c.totalVotes} votos)` : ""}`
      : null
    if (plat) tailLines.push(plat)
    if (c.predictedScore != null) tailLines.push(`Nota.Pr (regressão atual)=${c.predictedScore.toFixed(2)}`)
    const reviewsBlock = formatReviews(c.reviews)
    if (reviewsBlock) tailLines.push(reviewsBlock)
    tailLines.push("")
  })

  tailLines.push(
    `Inclua os ${candidates.length} candidatos em \`rankings\`, do mais alinhado pro menos alinhado. Cada \`work_id\` deve ser EXATAMENTE o UUID fornecido acima. Use a tool \`submit_ranking\`.`,
  )

  return { profileBlock, tailBlock: tailLines.join("\n") }
}

export function buildRankingUserPrompt(
  profile: TasteProfilePayload,
  candidates: CandidateWorkInput[],
  mode: RecommendationMode,
  userContext?: string | null,
): { profileBlock: string; tailBlock: string } {
  let modeLabel: string
  if (mode === "next_read") {
    modeLabel = "Próxima leitura — somente favoritos ainda não lidos. Priorize obras que combinam com o perfil mas que ofereçam descobertas (não só repetir o que ele já ama)."
  } else if (mode === "full_analysis") {
    modeLabel = "Análise completa — TODOS os favoritos do usuário, incluindo já lidos. Use também como diagnóstico do gosto."
  } else {
    modeLabel = "Ranking geral — obras do catálogo respeitando os filtros aplicados pelo usuário (não são necessariamente favoritos). Foco em DESCOBERTA: ranquear quão alinhada cada obra está com o perfil de gosto, destacando obras subestimadas no perfil atual."
  }
  return buildRankingUserPromptWithLabel(profile, candidates, modeLabel, userContext)
}
