/**
 * Inferência ESTRUTURAL da nota de Conteúdo Adulto por versão das obras `mixed` — módulo PURO e dono
 * ÚNICO da política. Nada aqui lê ou grava banco: recebe os fatos da obra e devolve um PLANO por
 * versão. Quem executa é `server/editions/structural-inference-sync.ts`.
 *
 * A pergunta que ela responde: quando a estrutura editorial já restringe a faixa plausível da nota,
 * qual é o valor conservador que dá para afirmar SEM avaliar a versão?
 *
 * | versão  | quando                                                                 | nota                          | regra                |
 * |---------|------------------------------------------------------------------------|-------------------------------|----------------------|
 * | padrão  | mixed, sem extras, rótulo R15/R16, natureza sexual da adulta confirmada | topo da faixa 4–6 (Sugestivo) | `base_padrao_r15`    |
 * | adulta  | mixed, natureza sexual confirmada                                       | início da faixa 7–8 (Maduro)  | `piso_adulta_sexual` |
 *
 * 🔴 A fronteira que sustenta as duas é "nada de sexo mostrado (≤ 6)" × "algo sexual mostrado (≥ 7)",
 * que a régua de produção e o `c1` compartilham. O limiar de EXPLÍCITO (9) não entra aqui: ele é
 * a decisão aberta do `c1`, e uma inferência estrutural não pode depender dela.
 *
 * Os valores DERIVAM das constantes que a régua já usa (`R15_FROM_R19_CEILING`, `ADULT_LABEL_FLOOR`):
 * a base da padrão é o mesmo teto que a avaliação aplica a obra R15, e o piso da adulta é o mesmo piso
 * de "rótulo adulto sem cena afirmada". Mudar a régua move os dois juntos.
 *
 * ⚠️ Nunca substitui nota mais forte (`curator_confirmed`, `ai_evaluated`, `reused_existing`) nem o
 * "não avaliado" que a CURADORIA registrou. E só RETIRA o que ela mesma inferiu (as regras de
 * `OWNED_STRUCTURAL_RULES`). A base provisória legada da migration 214 (`baseline_normal_mixed_v1`,
 * 5,0) é a predecessora da base R15: pode ser atualizada para ela, mas nunca retirada sozinha — quando
 * a política não a sustenta, vira CONFLITO para a curadoria.
 */
import { ADULT_LABEL_FLOOR, CONTENT_RATING_BOUNDS, EXPLICIT_GENRES, R15_FROM_R19_CEILING } from "@/lib/ai-evaluation/adult-content-rules"
import type { EditionScoreSource, MixedEdition } from "@/lib/editions/mixed-edition"

// ── Os valores e as regras ───────────────────────────────────────────────────────────────────

/** Base da versão PADRÃO R15 (topo da faixa 4–6 "Sugestivo": cenas cortadas ou atenuadas). */
export const STANDARD_EDITION_BASE = R15_FROM_R19_CEILING
/** Piso da versão ADULTA de natureza sexual confirmada (início da faixa 7–8: algo sexual mostrado). */
export const ADULT_EDITION_SEXUAL_FLOOR = ADULT_LABEL_FLOOR

export const STRUCTURAL_RULES = {
  standardBase: "base_padrao_r15",
  adultFloor: "piso_adulta_sexual",
} as const
export type StructuralRule = (typeof STRUCTURAL_RULES)[keyof typeof STRUCTURAL_RULES]

/** As regras que a reconciliação CONTROLA: só linhas com elas podem ser criadas, ajustadas ou retiradas. */
export const OWNED_STRUCTURAL_RULES: readonly StructuralRule[] = [STRUCTURAL_RULES.standardBase, STRUCTURAL_RULES.adultFloor]

/** A base provisória 5,0 da migration 214 — predecessora da base R15 (atualizável, nunca retirada sozinha). */
export const LEGACY_STANDARD_BASE_RULE = "baseline_normal_mixed_v1"

/** Fontes que a inferência nunca toca: avaliação, reaproveitamento auditado, curadoria. */
export const STRONGER_EDITION_SOURCES: ReadonlySet<EditionScoreSource> = new Set([
  "reused_existing",
  "ai_evaluated",
  "curator_confirmed",
])

// ── Natureza sexual confirmada ───────────────────────────────────────────────────────────────

/**
 * Subgrupos de tag que NOMEIAM sexo (dado do banco, `tag_subgroup.slug`).
 *
 * 🔴 Estar no subgrupo NÃO basta. Dentro deles há descritores e fetiches SEM nível de nota (tier
 * nulo, só `adult_indicator`) — Whipping, Big Breasts, Gagged, Lingerie, Nudity, Aphrodisiac —, que a
 * própria régua da avaliação trata como "aviso/dinâmica, sem piso". Whipping, em particular, é a
 * marca de obra adulta por VIOLÊNCIA (medido: a única "confirmação" de uma mixed com Torture/Whipping
 * vinha dela). Por isso, dentro do subgrupo, só conta tag com nível `explicit`/`label` (ato ou
 * circunstância sexual, com piso na régua) ou com a flag FORTE de 18+ (`adult_indicator_strong`,
 * curada na migration 210: Creampie, Deepthroat, BDSM…).
 * ⚠️ A violência sexual (Sexual Assault…) mora em `sexual-themes` SEM flag nenhuma desde a migration
 * 203 — fica fora pela mesma regra.
 * ⚠️ `rating-labels` fica FORA: ali moram Adult, Mature, R19, R19 Version — rótulos de idade, que
 * podem ser por violência.
 */
export const SEXUAL_TAG_SUBGROUPS: readonly string[] = ["explicit", "sexual-acts", "sexual-themes"]
const TIERS_COM_PISO: readonly string[] = ["explicit", "label"]
/**
 * As duas exceções de `rating-labels` que nomeiam sexo — nenhuma flag do banco as separa de "Adult"
 * (as três são `label`, `adult_indicator`, sem `strong`), daí a lista. Entraram no ensaio aprovado
 * em 2026-10-15 como sinal suficiente.
 */
export const SEXUAL_RATING_LABEL_TAGS: readonly string[] = ["Sexual Content", "Borderline H"]
/**
 * Classificações externas (MangaDex/ComicK) que já valem, na régua da avaliação, pelo menos o piso
 * adulto — `erotica` (7) e `pornographic` (9). `suggestive` (5) é faixa 4–6 e não confirma nada.
 */
export const SEXUAL_EXTERNAL_RATINGS: readonly string[] = Object.entries(CONTENT_RATING_BOUNDS)
  .filter(([, bound]) => bound >= ADULT_LABEL_FLOOR)
  .map(([rating]) => rating)

/**
 * Procedências de VÍNCULO obra↔tag (`work_tags.source`) que podem confirmar a natureza sexual — lista
 * de PERMISSÃO, então procedência nova fica de fora até ser decidida aqui.
 *   · `null` — legado, formulário da obra e "Atualizar dados" (tags das fontes): humano ou externo.
 *   · `"imported"` — backfill das tags das fontes.
 *   · `"curadoria"` — decisão humana auditada (migration 212).
 * 🔴 Fora: `"ai_inferred"` é a IA lendo a sinopse e o resumo das reviews — a mesma prosa que a política
 * recusa como confirmação. Virar tag não a torna fato estrutural. `"synopsis_marker"` é marcador de
 * texto da sinopse. Medido em 2026-10-16: 3 das 47 adultas do legado se confirmavam só por uma
 * "Sexual Content" `ai_inferred`.
 */
export const TAG_SOURCES_THAT_CONFIRM: ReadonlySet<string | null> = new Set([null, "imported", "curadoria"])

export interface StructuralTagFacts {
  name: string
  tier: string | null
  adultIndicator: boolean
  adultIndicatorStrong: boolean
  subgroup: string | null
  /** `work_tags.source` do vínculo. `undefined` = não foi lida ⇒ não confirma (nunca libera por omissão). */
  source: string | null | undefined
}

export interface CurrentEditionRow {
  source: EditionScoreSource
  score: number | null
  decidedBy: string | null
  /** `evidence.regra` da linha (null quando não houver). */
  rule: string | null
}

export interface SexualSignalInput {
  tags: ReadonlyArray<StructuralTagFacts>
  /** Gêneros do MangaUpdates gravados na evidência de edição (`work_genres` não guarda os adultos). */
  muGenres: ReadonlyArray<string>
  /** `externalContentRating` da avaliação mais recente da obra (é a classificação da FONTE, não da IA). */
  externalRatings: ReadonlyArray<string>
  /** A linha atual da versão adulta — só conta se for de fonte mais forte. */
  adultEditionRow: CurrentEditionRow | null | undefined
}

/**
 * Os sinais que CONFIRMAM a natureza sexual da versão adulta. Vazio ⇒ não confirmada.
 *
 * Não confirmam sozinhos (de propósito): tag ou gênero de IDADE (Adult, Mature, R19), "Uncensored" no
 * MangaUpdates (a censura pode ser de gore), aviso do digest e texto de review (prosa), tag que a IA
 * inferiu dessa prosa (`TAG_SOURCES_THAT_CONFIRM`) e a nota genérica da avaliação da obra (não tem
 * versão-alvo). Uma tag de IA não impede a inferência: só não conta — se houver outro sinal, ele basta.
 */
export function sexualNatureSignals(input: SexualSignalInput): string[] {
  const out: string[] = []
  const generos = input.muGenres.map((g) => g.trim().toLowerCase())
  for (const g of EXPLICIT_GENRES) if (generos.includes(g)) out.push(`gênero do MangaUpdates: ${g}`)
  for (const t of input.tags) {
    if (t.source === undefined || !TAG_SOURCES_THAT_CONFIRM.has(t.source)) continue
    if (t.tier === "explicit") out.push(`tag de ato explícito: ${t.name}`)
    else if (t.subgroup && SEXUAL_TAG_SUBGROUPS.includes(t.subgroup) && ((t.tier != null && TIERS_COM_PISO.includes(t.tier)) || t.adultIndicatorStrong))
      out.push(`tag sexual: ${t.name}`)
    else if (SEXUAL_RATING_LABEL_TAGS.includes(t.name)) out.push(`tag sexual: ${t.name}`)
  }
  for (const r of input.externalRatings) {
    const rating = r.trim().toLowerCase()
    if (SEXUAL_EXTERNAL_RATINGS.includes(rating)) out.push(`classificação externa: ${rating}`)
  }
  const adulta = input.adultEditionRow
  if (adulta && STRONGER_EDITION_SOURCES.has(adulta.source) && adulta.score != null && adulta.score >= ADULT_EDITION_SEXUAL_FLOOR)
    out.push(`versão adulta já avaliada: ${adulta.score.toFixed(1)} (${adulta.source})`)
  return [...new Set(out)]
}

// ── Rótulo etário da versão padrão ──────────────────────────────────────────────────────────

export type StandardEditionLabel = "R15" | "abaixo de R15" | "R17" | "desconhecido"

/**
 * O rótulo etário da versão PADRÃO, lido das linhas do MangaUpdates (R12–R17). Só R15/R16 sustentam a
 * base: abaixo de R15 a versão é mais limpa (a base exageraria) e R17 pode mostrar parcialmente (a
 * base subestimaria). Havendo mais de um rótulo, vence o que EXCLUI — dúvida não vira base.
 */
export function standardEditionLabel(lines: ReadonlyArray<string>): StandardEditionLabel {
  const idades = new Set<number>()
  for (const l of lines) for (const m of l.matchAll(/\bR(1[2-7])\b/gi)) idades.add(Number(m[1]))
  if ([...idades].some((i) => i >= 17)) return "R17"
  if ([...idades].some((i) => i <= 14)) return "abaixo de R15"
  if (idades.has(15) || idades.has(16)) return "R15"
  return "desconhecido"
}

// ── O plano ─────────────────────────────────────────────────────────────────────────────────

export interface StructuralFacts {
  isMixed: boolean
  r18ExtraChapters: boolean
  standardLines: ReadonlyArray<string>
  tags: ReadonlyArray<StructuralTagFacts>
  muGenres: ReadonlyArray<string>
  externalRatings: ReadonlyArray<string>
  current: Partial<Record<MixedEdition, CurrentEditionRow>>
}

export interface StructuralTarget {
  score: number
  rule: StructuralRule
}

export type EditionDecision =
  /** Grava a inferência — cria (sem linha) ou atualiza a linha de `over`. */
  | { kind: "infer"; target: StructuralTarget; over: CurrentEditionRow | null }
  /** A inferência própria já está certa: nada a gravar. */
  | { kind: "keep"; current: CurrentEditionRow }
  /** Inferência própria que deixou de valer: retirar (e devolver o que havia antes dela). */
  | { kind: "retract"; current: CurrentEditionRow; reason: string }
  /** Nota mais forte, ou "não avaliado" da curadoria: nunca tocada. */
  | { kind: "preserve"; current: CurrentEditionRow; reason: string }
  /** Base legada (ou de regra alheia) que a política não sustenta: fica, e vai para a curadoria. */
  | { kind: "conflict"; current: CurrentEditionRow; reason: string }
  /** Segue sem nota. */
  | { kind: "none"; reason: string }

export interface StructuralPlan {
  sexualSignals: string[]
  standardLabel: StandardEditionLabel
  decisions: Record<MixedEdition, EditionDecision>
}

const EDITIONS: MixedEdition[] = ["normal", "r18"]

export function planStructuralInference(f: StructuralFacts): StructuralPlan {
  const sexualSignals = sexualNatureSignals({
    tags: f.tags,
    muGenres: f.muGenres,
    externalRatings: f.externalRatings,
    adultEditionRow: f.current.r18,
  })
  const sexual = sexualSignals.length > 0
  const standardLabel = standardEditionLabel(f.standardLines)

  const naoSexual = "natureza sexual da versão adulta não confirmada"
  const alvo: Record<MixedEdition, { target: StructuralTarget | null; why: string }> = {
    normal: !f.isMixed
      ? { target: null, why: "obra não é mixed" }
      : f.r18ExtraChapters
        ? { target: null, why: "conteúdo adulto só nos extras" }
        : standardLabel !== "R15"
          ? { target: null, why: `versão padrão ${standardLabel}` }
          : !sexual
            ? { target: null, why: naoSexual }
            : { target: { score: STANDARD_EDITION_BASE, rule: STRUCTURAL_RULES.standardBase }, why: "" },
    r18: !f.isMixed
      ? { target: null, why: "obra não é mixed" }
      : !sexual
        ? { target: null, why: naoSexual }
        : { target: { score: ADULT_EDITION_SEXUAL_FLOOR, rule: STRUCTURAL_RULES.adultFloor }, why: "" },
  }

  const decisions = {} as Record<MixedEdition, EditionDecision>
  for (const ed of EDITIONS) decisions[ed] = decide(f.current[ed] ?? null, alvo[ed].target, alvo[ed].why)
  return { sexualSignals, standardLabel, decisions }
}

function decide(cur: CurrentEditionRow | null, target: StructuralTarget | null, why: string): EditionDecision {
  if (cur && STRONGER_EDITION_SOURCES.has(cur.source)) return { kind: "preserve", current: cur, reason: `nota mais forte (${cur.source})` }
  if (cur && cur.source === "not_rated" && cur.decidedBy === "curator")
    return { kind: "preserve", current: cur, reason: "a curadoria registrou 'não avaliado'" }

  if (cur && cur.source === "inferred_base") {
    const propria = cur.rule != null && (OWNED_STRUCTURAL_RULES as readonly string[]).includes(cur.rule)
    const predecessora = cur.rule === LEGACY_STANDARD_BASE_RULE
    if (target) {
      if (propria && cur.rule === target.rule && cur.score === target.score) return { kind: "keep", current: cur }
      if (propria || (predecessora && target.rule === STRUCTURAL_RULES.standardBase)) return { kind: "infer", target, over: cur }
      return { kind: "conflict", current: cur, reason: `inferência de outra regra (${cur.rule ?? "sem regra"})` }
    }
    if (propria) return { kind: "retract", current: cur, reason: why }
    return { kind: "conflict", current: cur, reason: `base legada sem respaldo na política: ${why}` }
  }

  // Sem linha, ou "não avaliado" automático (auditoria): a inferência pode preencher.
  if (target) return { kind: "infer", target, over: cur }
  return { kind: "none", reason: why }
}

/** A decisão escreve no banco? */
export function decisionWrites(d: EditionDecision): boolean {
  return d.kind === "infer" || d.kind === "retract"
}
