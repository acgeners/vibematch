import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"

/**
 * O que a auditoria de critérios pode TOCAR e o que ela pode fazer SOZINHA.
 *
 * Dono único das duas decisões. Elas eram implícitas: todo critério era auditável e o
 * auto-apply era um par de constantes no meio da action. Ficando aqui, o prompt, o schema
 * da tool, o filtro do serviço e a guarda do servidor leem a MESMA lista — em vez de cada
 * lado enumerar os critérios de novo, que é como o escopo passa a divergir em silêncio.
 */

/**
 * Critérios FORA da auditoria, com o motivo medido de cada um (2026-08-16).
 *
 * 🔴 O texto entra no prompt. Não é comentário: é o que o modelo lê para saber por que
 * aquele bloco de notas aparece como contexto e não como alvo.
 */
export const AUDIT_OUT_OF_SCOPE: Readonly<Partial<Record<CriterionSlug, string>>> = {
  adult_content:
    "tem piso e teto determinísticos por procedência (marcador R19, content rating externo, " +
    "tier da tag) aplicados fora da auditoria — sugerir aqui cria uma segunda régua para o mesmo número",
  couple_dynamics:
    "é o único critério de VALÊNCIA e a rubrica ampliada (v23) foi revertida; o prompt vigente " +
    "não distingue tolerar de querer, então a sugestão nasce sobre uma régua meia-aplicada",
}

/**
 * Critérios que a auditoria pode sugerir. **Derivado** de `CRITERION_SLUGS`: critério novo
 * entra como auditável por padrão, e tirá-lo exige escrever o motivo acima. Uma lista de
 * inclusão faria o contrário — o critério novo sumiria da auditoria sem ninguém decidir.
 */
export const AUDITABLE_CRITERIA: readonly CriterionSlug[] = CRITERION_SLUGS.filter(
  (slug) => !(slug in AUDIT_OUT_OF_SCOPE),
)

export function isAuditableCriterion(slug: string): slug is CriterionSlug {
  return (AUDITABLE_CRITERIA as readonly string[]).includes(slug)
}

/**
 * 🔴 Auto-aplicação DESLIGADA em 2026-08-16, e o motivo é medido — não é precaução.
 *
 * O gate exige `confidence ≥ 0.8`, mas a confiança que o modelo emite **satura em 0,85**:
 * das 765 sugestões pendentes, 6 (0,78%) alcançam 0,80 — e a faixa que o próprio prompt
 * descreve como certeza forte (0,9+) nunca aparece. O gate foi calibrado contra uma escala
 * que a saída não produz.
 *
 * Pior que a cobertura: no run de 16/08 (212 obras) as 3 auto-aplicações foram todas
 * contestáveis — duas em `adult_content` subindo a nota por tag de circunstância (o
 * mecanismo que a migration 182 rebaixou de propósito) e uma subindo `protagonist` porque
 * o `user_score` da obra é 9,4, que é a feature sendo empurrada na direção do rótulo.
 * No topo da escala, a única verificação humana que existe reprovou 2 de 2.
 *
 * Religar é trocar esta constante — e o gate que volta a valer é o de baixo, intacto de
 * propósito. Antes de religar, exija a prova que falta: precisão medida no topo da escala.
 */
export const AUTO_APPLY_ENABLED = false

/** Gate que volta a valer se `AUTO_APPLY_ENABLED` for religado. */
export const AUTO_APPLY_MIN_CONFIDENCE = 0.8
export const AUTO_APPLY_MAX_DELTA = 1.5

/**
 * A sugestão pode ser gravada sem passar por uma pessoa?
 *
 * Função e não expressão solta na action: é o que permite varrer a grade inteira de
 * (confiança, Δ) num teste e provar que NENHUM par escreve sozinho enquanto a política
 * estiver desligada. Um `&&` no meio do laço só poderia ser conferido por leitura.
 */
export function shouldAutoApply(confidence: number, delta: number): boolean {
  if (!AUTO_APPLY_ENABLED) return false
  return confidence >= AUTO_APPLY_MIN_CONFIDENCE && Math.abs(delta) <= AUTO_APPLY_MAX_DELTA
}

/**
 * As colunas de pós-leitura que provam que a pessoa LEU a obra e a avaliou dimensão a
 * dimensão. É a única evidência que o auditor tem e o avaliador não tinha.
 *
 * 🔴 A distinção que sustenta a pool inteira: `user_score` é **gosto** (a média dos 7 eixos
 * de taste desde 16/07/2026) — ele diz "gostei muito", não "o romance é intenso". Estas
 * colunas são **observação por dimensão**. Sem elas o auditor vira a mesma ferramenta que
 * produziu a nota, relendo a mesma evidência: o digest sobrepõe 78,9% da amostra de reviews
 * que a avaliação já tinha lido, então sobraria só a tabela de distribuição como novidade.
 */
export const POST_READING_FIELDS = [
  "post_story_score",
  "post_fl_score",
  "post_ml_score",
  "post_character_development_score",
  "post_pacing_score",
  "post_art_visual_score",
  "post_impact_immersion_score",
  "post_originality_score",
] as const

/**
 * A obra tem observação de quem leu? — o critério de entrada na pool desde 2026-08-16.
 *
 * ⚠️ Medido: 190 das 212 obras avaliadas têm pós-leitura; o catálogo tem 851 com digest.
 * Auditar as 851 pareceria cobertura 4× maior e seria a IA se re-julgando em 661 delas.
 * A cobertura certa cresce por LEITURA — cada leitor que preenche o pós-leitura amplia a
 * pool sozinho —, não por afrouxar a exigência.
 */
export function temLeituraDoUsuario(post: Partial<Record<string, number | null>>): boolean {
  return POST_READING_FIELDS.some((f) => post[f] != null)
}

/**
 * Obra sem consenso de reviews destilado fica FORA do run (2026-08-16).
 *
 * 🔴 Sem digest o auditor volta a ser o juiz cego que produziu os dois erros de 85%: ele
 * julga com tag e sinopse e contradiz uma evidência que não viu. Medido na pool: **196 das
 * 212 têm digest**, então o corte custa 16 obras e compra evidência nas outras 196.
 *
 * ⚠️ Mora aqui, e não na query, porque é a mesma classe de decisão que `AUDITABLE_CRITERIA`
 * — o que a auditoria pode julgar. Na query viraria um `.filter()` que ninguém lê como
 * política, e o próximo caller a esqueceria.
 */
export function temEvidenciaParaAuditar(digest: {
  consensus: string | null
  divergence: string | null
  traits: unknown[]
}): boolean {
  return Boolean(digest.consensus || digest.divergence || digest.traits.length > 0)
}

/**
 * Run em `processing` mais velho que isto está morto — o processo caiu sem gravar
 * `failed`. Medido em 2026-08-16: 5 runs presos desde maio/junho, o mais novo com 69 dias.
 * Nenhum envenena o escopo (`loadLastRun` filtra `completed`), mas eles poluem a aba Runs
 * e escondem uma falha real no meio de lixo antigo.
 */
export const STALE_RUN_HOURS = 6
