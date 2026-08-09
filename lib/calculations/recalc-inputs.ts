/**
 * As entradas que o recálculo global de fato LÊ — dono único da régua.
 *
 * `markRecalcPending` era chamado incondicionalmente em 31 lugares, e o default
 * "na dúvida marca" é o correto: marcar de MENOS deixa nota velha na tela sem
 * nada acusar. O preço era o inverso — o badge "Recalcular notas" acendia por
 * salvar uma sinopse, por marcar "Lendo" ou por ação de um leitor cujo estado o
 * recalc global nem lê.
 *
 * A lista abaixo é a conferência do que `recalculateAll` consome: o `select` de
 * `server/actions/calculations.ts` cruzado com as features de
 * `lib/calculations/expected.ts`. Cada entrada aponta a feature que ela move.
 *
 * 🔴 Uma 2ª cópia desta lista é como o badge deixa de acender para um campo que
 * mudou de verdade — mesma armadilha do `LOW_BALANCE_USD` e do
 * `STRONG_TAG_WEIGHT`. Ao adicionar feature ao Ridge, adicione aqui no MESMO PR.
 *
 * ⚠️ O que NÃO está aqui, de propósito, porque foi conferido que não entra em
 * nenhuma feature nem no rótulo:
 *   - `personal_status_id`, `chapters_read`, `last_read_at`, `is_favorite` —
 *     estão em `PERSONAL_COLUMNS`, mas em nenhuma feature;
 *   - as 8 colunas `post_*_score` — `QUALITY_NUMERIC_FEATURES` é array VAZIO e
 *     `L0_QUALITY_ENABLED = false` (removidas por medição: MAE CV 0,63 contra
 *     0,54 do baseline). Elas alimentam o recalc só INDIRETAMENTE, via
 *     `attribute_bias` — que está na lista;
 *   - sinopses, capas, títulos alternativos, gêneros (`work_genres`), external
 *     ids: o recalc não os lê. Note que `work_tags` ENTRA e `work_genres` não.
 */

/**
 * Entradas de CATÁLOGO — valem seja quem for que as mude, porque o recalc lê a
 * linha compartilhada.
 */
export const CATALOG_RECALC_INPUTS = [
  /** As 9 notas por critério → as 9 features + `IA(n)` (GPT.N, via `score_weights`). */
  "category_scores",
  /** `platform_ratings` → `Nota.M` + `LogVotos`. */
  "platform_ratings",
  /** `works.total_chapters` → `Cps.N`. */
  "total_chapters",
  /** `works.year` / `year_end` → `ReleaseAge` + `RunLength`. */
  "year",
  /** `works.publication_status_id` → a categórica `Status` (one-hot). */
  "publication_status",
  /** `works.original_title` → a categórica `Origin` (ko/ja/zh/other). */
  "original_title",
  /** `work_tags` → `LovedTagOverlap`, `AvoidedTagOverlap`, `CriterionFitScore`. */
  "work_tags",
  /**
   * Obra entrou ou saiu do conjunto não-arquivado. Não muda o modelo (obra sem
   * rótulo não entra no treino, e imputer/scaler são fitados só no treino), mas
   * a obra nova precisa GANHAR a primeira Nota Prevista, e `personal_fit_percentile`
   * é percentil sobre o catálogo inteiro.
   */
  "catalog_membership",
] as const

/**
 * Entradas PESSOAIS — o recalc global lê as **do dono**. Mudança feita por
 * outra pessoa não move número nenhum na tela dele.
 */
export const PERSONAL_RECALC_INPUTS = [
  /** O RÓTULO que treina o Ridge. Muda uma nota → muda o catálogo inteiro. */
  "user_score",
  /** Somado determinístico (±0,30) sobre a Nota Prevista, depois do blend. */
  "observation_adjustment",
  /** → `SinopseScore`. */
  "synopsis_quality",
  /** `attribute_bias` desloca on-read as notas de origem IA (é por onde a pós-leitura entra). */
  "attribute_bias",
  /** `user_tag_preferences` → os 3 sinais de fit, em TODAS as obras. */
  "tag_preferences",
  /** Perfil de gosto corrente → loved/avoided tags → os 3 sinais de fit. */
  "taste_profile",
] as const

export const RECALC_INPUTS = [...CATALOG_RECALC_INPUTS, ...PERSONAL_RECALC_INPUTS] as const

export type RecalcInput = (typeof RECALC_INPUTS)[number]
export type CatalogRecalcInput = (typeof CATALOG_RECALC_INPUTS)[number]
export type PersonalRecalcInput = (typeof PERSONAL_RECALC_INPUTS)[number]

const PERSONAL_SET: ReadonlySet<string> = new Set(PERSONAL_RECALC_INPUTS)

/** `true` quando a entrada só importa se quem mexeu for o dono do catálogo. */
export function isPersonalRecalcInput(input: RecalcInput): boolean {
  return PERSONAL_SET.has(input)
}

/**
 * Igualdade tolerante ao que o PostgREST devolve. `numeric` volta como STRING
 * ("8.5"), então `prev.score !== data.score` compara string com number e diz
 * "mudou" em toda edição — o diff nasceria inútil, marcando sempre, e ninguém
 * notaria porque o resultado (marcar) é o mesmo de hoje.
 *
 * `null` e `undefined` são o MESMO ausente: um patch que não traz a coluna e uma
 * coluna nula descrevem o mesmo estado do banco.
 */
export function sameRecalcValue(a: unknown, b: unknown): boolean {
  const aEmpty = a == null
  const bEmpty = b == null
  if (aEmpty || bEmpty) return aEmpty && bEmpty
  if (typeof a === "boolean" || typeof b === "boolean") return a === b
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb
  return String(a) === String(b)
}

export type MarkRecalcDecision = { mark: true } | { mark: false; reason: string }

/**
 * A decisão do gate, PURA — o `getOwnerUserId` fica no caller (`server/recalc/queue.ts`),
 * que é quem tem IO. Separado assim porque o que regride nesta classe é a REGRA,
 * e regra testada contra mock de Supabase passa verde por motivo errado.
 *
 * Toda dúvida resolve em `mark: true`. Não marcar deixa nota velha na tela sem
 * nada acusar; marcar demais custa um clique.
 */
export function decideMarkRecalc(
  changed: readonly RecalcInput[] | undefined,
  actorId?: string | null,
  ownerId?: string | null,
): MarkRecalcDecision {
  if (!changed) return { mark: true } // não declarou → comportamento histórico
  if (changed.length === 0) return { mark: false, reason: "nada material mudou" }
  // Entrada de catálogo vale para quem quer que a mude.
  if (!changed.every(isPersonalRecalcInput)) return { mark: true }
  if (!actorId || !ownerId) return { mark: true }
  if (actorId === ownerId) return { mark: true }
  return {
    mark: false,
    reason: `só entradas pessoais de quem não é o dono (${changed.join(",")})`,
  }
}

/**
 * `true` quando a decisão depende de saber quem é o dono — ou seja, quando vale
 * a pena pagar o `getOwnerUserId()`. Sem isto, o caminho comum (edição de
 * catálogo) pagaria uma consulta a mais por save pra nada.
 */
export function needsOwnerToDecide(
  changed: readonly RecalcInput[] | undefined,
  actorId?: string | null,
): boolean {
  return (
    changed != null && changed.length > 0 && changed.every(isPersonalRecalcInput) && Boolean(actorId)
  )
}

/**
 * Recebe triplas `[entrada, antes, depois]` e devolve as entradas que mudaram,
 * sem repetição. Uma entrada pode aparecer em mais de uma tripla (`year` cobre
 * `year` e `year_end`); basta uma delas mudar.
 */
export function changedInputs(
  pairs: ReadonlyArray<readonly [RecalcInput, unknown, unknown]>,
): RecalcInput[] {
  const out: RecalcInput[] = []
  for (const [input, before, after] of pairs) {
    if (out.includes(input)) continue
    if (!sameRecalcValue(before, after)) out.push(input)
  }
  return out
}
