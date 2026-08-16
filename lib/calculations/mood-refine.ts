/**
 * Refino por mood — desempate momentâneo DENTRO de um tier de Prioridade.
 *
 * As obras de um tier estão tecnicamente empatadas (diferença de Prioridade
 * dentro do erro do modelo, MAE ~0.9). Em vez de fingir que o modelo separa
 * elas, deixamos o CONTEXTO do user desempatar: ele marca o que quer priorizar
 * agora (atributos como priorizar/evitar + dimensões práticas), e aplicamos uma
 * correção na Prioridade **limitada ao MAE** — honesta, porque só reordena
 * dentro da incerteza que já existe.
 *
 * Puro/determinístico (sem I/O) pra ser testável e rodar client-side: os dados
 * já vêm no RankingEntry/CompareWork.
 */

import type { CriterionSlug } from "@/types/domain"
import {
  isCancelledPublicationStatus,
  isConcludedPublicationStatus,
  isHiatusPublicationStatus,
  isStillPublishingStatus,
  isDismissedPersonalStatus,
  isFullyReadPersonalStatus,
  isTerminalPersonalStatus,
  tracksProgressPersonalStatus,
} from "@/lib/constants/status-lookups"

/**
 * Peso de um atributo numa escala de 5 níveis (0/ausente = neutro):
 *   -2 evitar muito · -1 evitar · (0 neutro) · +1 priorizar · +2 priorizar muito
 * O sinal dá a direção; a magnitude (1 ou 2) dá quanto a dimensão pesa.
 */
export type AttributeWeight = -2 | -1 | 1 | 2

/**
 * Dimensões que NÃO são um dos 9 atributos, mas separam obras empatadas.
 *
 * 🔴 Todas usam a MESMA escala −2..+2 dos atributos, e isso é uma correção: três
 * delas (`alignment`, `popularity`, `synopsis`) eram BOOLEANAS, o que dava duas
 * convenções no mesmo diálogo — o atributo com cinco níveis e a dimensão prática
 * com liga/desliga. Unificar não é cosmético: o lado NEGATIVO passou a existir, e
 * ele é útil de verdade — `popularity: -2` é "quero algo de nicho",
 * `publication: -1` é "quero algo em andamento", `recency: -2` é "quero algo antigo".
 *
 * ⚠️ O que cada uma mede, e por que está aqui (fração dos pares que ela separa
 * DENTRO dos grupos empatados, medido em 2026-08-15 sobre 975 obras ativas):
 *
 * | dimensão | separa | observação |
 * |---|---|---|
 * | `art` | **79,8%** | cobertura 97,5% — um dos separadores mais fortes |
 * | `popularity` | 74,0% | volume de votos |
 * | `alignment` | 73,3% | percentil de alinhamento com o perfil |
 * | `synopsis` | 55,0% | o ♥ do Interesse |
 * | `publication` | **53,9%** | "dá pra começar agora?" — o caso do hiato |
 * | `platform` | 37,9% | média externa |
 * | `recency` | 35,5% | ano de início |
 *
 * ⚠️ `chapters` fica FORA deste record de propósito: ela não tem lado "evitar"
 * simétrico (curto e longo são dois alvos, não menos e mais de uma coisa boa).
 */
export type MoodPracticalDimension =
  | "art"
  | "alignment"
  | "popularity"
  | "synopsis"
  | "publication"
  | "platform"
  | "recency"
  | "reading"

export const MOOD_PRACTICAL_DIMENSIONS: readonly MoodPracticalDimension[] = [
  "art",
  "alignment",
  "popularity",
  "synopsis",
  "publication",
  "platform",
  "recency",
  "reading",
] as const

/**
 * Categorias que podem ser EXCLUÍDAS da comparação — a operação que a rampa de peso
 * não sabe fazer.
 *
 * 🔴 Peso e exclusão respondem perguntas diferentes, e por isso convivem em vez de
 * uma virar a outra: o par diz "prefiro concluída" (empurra pro topo, sem sumir com
 * ninguém); a exclusão diz "não me mostre hiato" (a obra sai da tela). Colapsar as
 * duas num controle só obrigaria a escolher entre "prefiro" e "não quero", que não
 * são a mesma coisa.
 *
 * ⚠️ Os buckets saem das FLAGS de `publication_status`/`personal_status`, nunca de
 * nomes: quando "Completed" virou "Finished", 10 lugares quebraram e o TypeScript
 * pegou 6 (migration 155).
 */
export type MoodExclusionKey =
  | "pub:concluded"
  | "pub:ongoing"
  | "pub:hiatus"
  | "pub:cancelled"
  | "read:unstarted"
  | "read:inProgress"
  | "read:finished"
  | "read:discarded"

export const MOOD_EXCLUSION_KEYS: readonly MoodExclusionKey[] = [
  "pub:concluded",
  "pub:ongoing",
  "pub:hiatus",
  "pub:cancelled",
  "read:unstarted",
  "read:inProgress",
  "read:finished",
  "read:discarded",
] as const

/**
 * Em qual bucket de PUBLICAÇÃO a obra cai. `null` = status desconhecido ou ausente —
 * e ela NÃO é excluída por nada, pelo mesmo motivo que `startabilityOf` devolve null:
 * "não sei" não pode virar "não serve".
 */
export function publicationBucketOf(
  publicationStatusId: number | null | undefined,
): MoodExclusionKey | null {
  if (publicationStatusId == null) return null
  if (isConcludedPublicationStatus(publicationStatusId)) return "pub:concluded"
  if (isCancelledPublicationStatus(publicationStatusId)) return "pub:cancelled"
  if (isHiatusPublicationStatus(publicationStatusId)) return "pub:hiatus"
  if (isStillPublishingStatus(publicationStatusId)) return "pub:ongoing"
  return null
}

/**
 * Em qual bucket de LEITURA a obra cai.
 *
 * ⚠️ "Descartada" NÃO usa `hideFromInterest`: essa flag também é true em `Stalled`,
 * `Read Again` e `Finished`, que são leitura em curso ou terminada — varreria os três
 * pro balde errado. São `Dropped` (terminal e não-lida) + `isDismissedPersonalStatus`
 * (Not Now / Not Interested, nomeados por slug porque não têm flag que os descreva).
 */
export function readingBucketOf(
  personalStatusId: number | null | undefined,
): MoodExclusionKey | null {
  if (personalStatusId == null) return null
  if (isFullyReadPersonalStatus(personalStatusId)) return "read:finished"
  if (isTerminalPersonalStatus(personalStatusId)) return "read:discarded"
  if (tracksProgressPersonalStatus(personalStatusId)) return "read:inProgress"
  if (isDismissedPersonalStatus(personalStatusId)) return "read:discarded"
  return "read:unstarted"
}

/** As obras que sobrevivem às exclusões — o que de fato vai à comparação. */
export function filterMoodWorks<T extends MoodWork>(works: T[], mood: MoodRefine): T[] {
  if (!mood.exclude?.length) return works
  return works.filter((w) => passesMoodExclusions(w, mood))
}

/** A obra sobrevive às exclusões escolhidas? */
export function passesMoodExclusions(work: MoodWork, mood: MoodRefine): boolean {
  const excluded = mood.exclude
  if (!excluded?.length) return true
  const pub = publicationBucketOf(work.publicationStatusId)
  const read = readingBucketOf(work.personalStatusId)
  if (pub && excluded.includes(pub)) return false
  if (read && excluded.includes(read)) return false
  return true
}

export interface MoodRefine {
  /** Peso por atributo; ausente = neutro (não entra no cálculo). */
  attributes: Partial<Record<CriterionSlug, AttributeWeight>>
  /** Capítulos: prioriza menos (`curto`) ou mais (`longo`) capítulos. */
  chapters?: "curto" | "longo"
  /** Categorias que saem da comparação. Vazio/ausente = nada é excluído. */
  exclude?: MoodExclusionKey[]
  /**
   * Peso por dimensão prática; ausente = neutro. MESMA escala dos atributos.
   * Opcional porque a ausência JÁ é o estado correto ("nenhuma prática ativa") —
   * exigi-la só encheria de `practical: {}` os literais que não usam nenhuma.
   */
  practical?: Partial<Record<MoodPracticalDimension, AttributeWeight>>
}

/** Dados mínimos por obra pro scoring (subset de RankingEntry/CompareWork). */
export interface MoodWork {
  id: string
  /** Prioridade base (0–10). null = sem Prevista → não rankeável. */
  decisionScore: number | null
  /** Notas dos 9 atributos (0–10). */
  scores: Partial<Record<CriterionSlug, number | null>>
  totalChapters: number | null
  /** Alinhamento cru com o perfil (0–1). */
  personalFit: number | null
  totalVotes: number
  /** Interesse na sinopse (♥..♥♥♥♥) — ordinal = nº de ♥. */
  synopsisQuality: string | null
  /** Percentil da estimativa de arte (0–1). NULL = sem estimativa (3º estado, nunca média). */
  artPercentile?: number | null
  /** Id do status de publicação — vira "dá pra começar agora?" via `startabilityOf`. */
  publicationStatusId?: number | null
  /** Média externa das plataformas (0–10). */
  platformAvg?: number | null
  /** Status de LEITURA de quem está escolhendo — vira "já comecei?" via `readingProgressOf`. */
  personalStatusId?: number | null
  /** Ano de início. */
  year?: number | null
}

/**
 * "Dá pra começar agora sem ficar esperando?" em [0,1].
 *
 * 🔴 É uma ESCOLHA de produto, não uma medição — e por isso está escrita num lugar
 * só, com a régua explícita: o que ela ordena é o risco de você começar e ficar
 * pendurado. Concluída não tem risco; em andamento sai capítulo novo; em hiato está
 * parada sem data; cancelada não termina nunca.
 *
 * ⚠️ Os ids vêm por SLUG (`isConcludedPublicationStatus` / `isStillPublishingStatus`),
 * nunca comparando nome à mão — a migration 155 documenta o que renomear "Completed"
 * quebrou. Status desconhecido cai no meio, não em zero: "não sei" não é "é ruim".
 */
export function startabilityOf(publicationStatusId: number | null | undefined): number | null {
  if (publicationStatusId == null) return null
  if (isConcludedPublicationStatus(publicationStatusId)) return 1
  if (isStillPublishingStatus(publicationStatusId)) {
    // Ongoing e Hiatus são os dois "ainda saindo", e o hiato é o pior dos dois —
    // é exatamente a dúvida que motivou esta dimensão ("2 estão em hiato, começo?").
    return isHiatusPublicationStatus(publicationStatusId) ? 0.25 : 0.6
  }
  // Cancelled: acabou incompleta — o pior caso pra quem quer se comprometer.
  if (isCancelledPublicationStatus(publicationStatusId)) return 0

  /* 🔴 `Unknown` (e qualquer status futuro) vira NULL, não zero — e isto era um bug:
     o `return 0` no fim pegava Cancelled E Unknown juntos, então "não sabemos se
     acabou" era tratado como "acabou incompleta", o pior caso possível. O docstring
     já afirmava "cai no meio, não em zero"; a prosa estava certa e o código não.
     NULL faz o cálculo tratar como SEM DADO — contribuição neutra —, que é o
     tratamento correto de ausência e o mesmo que a obra sem estimativa de arte recebe.
     Afeta 3 obras hoje, mas o modo de falha é o que importa: status novo no Supabase
     entraria calado como "pior caso". */
  return null
}

/**
 * "Já comecei esta?" em [0,1] — o eixo continuar × começar.
 *
 * ⚠️ Status TERMINAL (terminada, largada) devolve `null`, não 0 nem 1: ele não é
 * nenhum dos dois lados. Mandá-lo pro 0 faria "quero começar algo novo" promover
 * obras que você JÁ LEU junto com as que nunca abriu — e pro 1 faria "quero
 * continuar" oferecer o que não tem como continuar. Neutro é o único valor honesto.
 *
 * ⚠️ A régua vem das colunas semânticas de `personal_status` (migration 155), nunca
 * de uma lista de nomes: quando "Completed" virou "Finished", 10 lugares quebraram e
 * o TypeScript só pegou 6.
 *
 * ⚠️ Sem linha no espelho é `null` — e não "não comecei". São 690 das 978 obras em
 * `Untracked`, então essa escolha decide o comportamento da maioria: `Untracked` É
 * uma escolha explícita da pessoa e conta como não-começada; ausência de linha é
 * desconhecimento e fica fora.
 */
export function readingProgressOf(personalStatusId: number | null | undefined): number | null {
  if (personalStatusId == null) return null
  if (isTerminalPersonalStatus(personalStatusId)) return null
  // 🔴 A régua é `tracksProgress`, NÃO `isUnread`. Medido nas flags de
  // `personal_status`: `isUnread` marca só Untracked e Want to Read — "Not Now" e
  // "Not Interested" têm `is_unread = false`, então com `isUnread` elas caíam no
  // lado "já comecei", afirmando que a pessoa abriu obras que ela explicitamente
  // adiou ou recusou. `tracksProgress` separa certo: é true exatamente para os
  // status em que faz sentido ter capítulo lido.
  return tracksProgressPersonalStatus(personalStatusId) ? 1 : 0
}

/**
 * Amplitude máxima da correção, em pontos de Prioridade (0–10). Casada com o
 * MAE (~0.9): a correção por mood nunca empurra uma obra além de ±MOOD_SWING/… do
 * valor base — ou seja, fica dentro da incerteza estatística que já existe.
 */
export const MOOD_SWING = 0.9

export function isMoodActive(mood: MoodRefine): boolean {
  return (
    Object.keys(mood.attributes).length > 0 ||
    mood.chapters != null ||
    Object.keys(mood.practical ?? {}).length > 0 ||
    (mood.exclude?.length ?? 0) > 0
  )
}

/** Faixas ideais por critério (subset do perfil) — alvo de borda dos sliders. */
export type MoodCriterionRanges = Record<string, { ideal_min: number; ideal_max: number }>

/**
 * Alvo (0–10) de um atributo conforme o nível escolhido, relativo à FAIXA IDEAL:
 *   −2 → 0 (mínimo absoluto) · −1 → ideal_min · +1 → ideal_max · +2 → 10 (máximo)
 * A obra é pontuada por PROXIMIDADE a esse alvo (não por "maior/menor"). Sem
 * faixa pro atributo, ±1 cai no extremo (vira ±2) — i.e. volta ao monótono.
 *
 * Como a normalização é feita DENTRO do cluster (ver `computeMoodFit`), os
 * alvos extremos (0/10) reproduzem EXATAMENTE o comportamento monótono antigo
 * de ±2 — só ±1 ganha o alvo de borda. Backward-compatible por construção.
 */
function attributeTarget(level: AttributeWeight, range: { ideal_min: number; ideal_max: number } | undefined): number {
  switch (level) {
    case 2: return 10
    case 1: return range?.ideal_max ?? 10
    case -1: return range?.ideal_min ?? 0
    case -2: return 0
  }
}

interface Dimension {
  /** Métrica onde MAIOR = melhor (já codifica direção/alvo); null = sem dado. */
  metric: (w: MoodWork) => number | null
  /** Peso relativo da dimensão na média (atributos: 1 ou 2; práticas: 1). */
  weight: number
}

function activeDimensions(mood: MoodRefine, ranges?: MoodCriterionRanges): Dimension[] {
  const dims: Dimension[] = []
  for (const [slug, w] of Object.entries(mood.attributes) as Array<[CriterionSlug, AttributeWeight]>) {
    const target = attributeTarget(w, ranges?.[slug])
    // Proximidade ao alvo: −|nota − alvo| → quanto mais perto, MAIOR a métrica.
    dims.push({ metric: (mw) => { const v = mw.scores[slug]; return v == null ? null : -Math.abs(v - target) }, weight: Math.abs(w) })
  }
  if (mood.chapters) {
    const shorter = mood.chapters === "curto"
    dims.push({ metric: (w) => (w.totalChapters == null ? null : (shorter ? -w.totalChapters : w.totalChapters)), weight: 1 })
  }

  // Dimensões práticas: MESMA escala −2..+2 dos atributos. O SINAL vira direção
  // (multiplica a métrica) e a magnitude vira peso — é isso que dá "quero algo de
  // nicho" (popularity −) e "quero algo em andamento" (publication −), que as
  // versões booleanas não sabiam dizer.
  for (const [dim, w] of Object.entries(mood.practical ?? {}) as Array<
    [MoodPracticalDimension, AttributeWeight]
  >) {
    const base = PRACTICAL_METRIC[dim]
    const dir = w > 0 ? 1 : -1
    dims.push({
      metric: (mw) => {
        const v = base(mw)
        return v == null ? null : dir * v
      },
      weight: Math.abs(w),
    })
  }
  return dims
}

/**
 * Métrica CRUA de cada dimensão prática, sempre no sentido "maior = mais disso".
 * A direção que a pessoa escolheu é aplicada em `activeDimensions`; separar as duas
 * coisas é o que mantém `-2` como espelho exato de `+2`.
 *
 * ⚠️ `null` significa SEM DADO e vira contribuição neutra (0,5) no cálculo — nunca
 * zero. Obra sem estimativa de arte não pode afundar por causa disso.
 */
const PRACTICAL_METRIC: Record<MoodPracticalDimension, (w: MoodWork) => number | null> = {
  art: (w) => w.artPercentile ?? null,
  alignment: (w) => w.personalFit,
  popularity: (w) => w.totalVotes,
  // O ordinal do Interesse é o nº de ♥ — a string é o dado, o comprimento é a escala.
  synopsis: (w) => (w.synopsisQuality ? w.synopsisQuality.length : null),
  publication: (w) => startabilityOf(w.publicationStatusId),
  platform: (w) => w.platformAvg ?? null,
  recency: (w) => w.year ?? null,
  reading: (w) => readingProgressOf(w.personalStatusId),
}

/** Contribuição [0,1] de uma dimensão pra uma obra, normalizada no cluster. */
function dimensionContribution(dim: Dimension, work: MoodWork, min: number, max: number): number {
  const v = dim.metric(work)
  if (v == null) return 0.5 // sem dado → neutro
  return max > min ? (v - min) / (max - min) : 0.5
}

/**
 * `moodFit` [0,1] por obra = média PONDERADA das contribuições das dimensões
 * ativas (peso do atributo: ±±=2, ±=1). Retorna `null` quando não há dimensão
 * ativa (mood vazio).
 */
export function computeMoodFit(works: MoodWork[], mood: MoodRefine, ranges?: MoodCriterionRanges): Map<string, number | null> {
  const dims = activeDimensions(mood, ranges)
  const out = new Map<string, number | null>()
  if (dims.length === 0) {
    for (const w of works) out.set(w.id, null)
    return out
  }

  // min/max da MÉTRICA por dimensão sobre o cluster (só valores não-nulos).
  const bounds = dims.map((dim) => {
    let min = Infinity
    let max = -Infinity
    for (const w of works) {
      const v = dim.metric(w)
      if (v == null) continue
      if (v < min) min = v
      if (v > max) max = v
    }
    return { min, max }
  })

  const totalWeight = dims.reduce((s, d) => s + d.weight, 0)
  for (const w of works) {
    let sum = 0
    for (let i = 0; i < dims.length; i++) {
      sum += dims[i].weight * dimensionContribution(dims[i], w, bounds[i].min, bounds[i].max)
    }
    out.set(w.id, sum / totalWeight)
  }
  return out
}

/**
 * Prioridade ajustada ao mood (0–10) por obra:
 *   adjusted = base + MOOD_SWING × (moodFit − médiaMoodFit)
 * Centrar na média mantém a correção dentro de ±MOOD_SWING (≈ MAE), então o
 * mood só reordena dentro da incerteza, sem inventar gap. Obras sem Prioridade
 * base (`decisionScore == null`) ficam `null`. Sem dimensão ativa → devolve a
 * base inalterada (clamp 0–10).
 */
export function computeMoodAdjusted(works: MoodWork[], mood: MoodRefine, ranges?: MoodCriterionRanges): Map<string, number | null> {
  const fit = computeMoodFit(works, mood, ranges)
  const out = new Map<string, number | null>()

  const rankable = works.filter((w) => w.decisionScore != null)
  const fits = rankable.map((w) => fit.get(w.id)).filter((f): f is number => f != null)
  const meanFit = fits.length > 0 ? fits.reduce((s, f) => s + f, 0) / fits.length : 0.5

  for (const w of works) {
    if (w.decisionScore == null) {
      out.set(w.id, null)
      continue
    }
    const f = fit.get(w.id)
    if (f == null) {
      out.set(w.id, w.decisionScore) // mood vazio → base
      continue
    }
    const adjusted = w.decisionScore + MOOD_SWING * (f - meanFit)
    out.set(w.id, Math.max(0, Math.min(10, adjusted)))
  }
  return out
}

/**
 * Ordena os `works` pela Prioridade ajustada ao mood (desc). Obras sem base vão
 * pro fim. Estável (preserva ordem de entrada em empates).
 */
export function sortByMoodAdjusted(works: MoodWork[], mood: MoodRefine, ranges?: MoodCriterionRanges): MoodWork[] {
  const adjusted = computeMoodAdjusted(works, mood, ranges)
  return [...works].sort((a, b) => {
    const av = adjusted.get(a.id)
    const bv = adjusted.get(b.id)
    return (bv ?? -Infinity) - (av ?? -Infinity)
  })
}
