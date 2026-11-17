/**
 * O que ordena as listas pessoais (o /ranking e o "Pra você hoje" da home) de quem olha.
 *
 *   "expected"  → tem modelo (20+ notas): a Nota Prevista, como sempre.
 *   "alignment" → sem modelo, mas com tags declaradas: o Alinhamento (só tags, não precisa de
 *                 nota), e a média externa desempata. É o que faz as boas-vindas valerem na hora.
 *   "platform"  → nem modelo nem tags (visitante, ou conta que não disse nada): a média externa.
 *
 * Dono único: o ranking e a home chamam `resolveSortBasis` sobre o MESMO `getScoresReader`, e o
 * texto que diz de onde vem a ordem deriva do mesmo valor.
 */
export type SortBasis = "expected" | "alignment" | "platform"

export function resolveSortBasis(reader: { hasModel: boolean; hasAlignment?: boolean }): SortBasis {
  if (reader.hasModel) return "expected"
  return reader.hasAlignment ? "alignment" : "platform"
}

/** Precisam do modelo: sem ele são nulos em todas as linhas. */
const MODEL_FIELDS = new Set(["expected_score", "recommended", "decision", "chance_score"])

/**
 * Pessoais sem substituto: a arte é estimada pelos rótulos DO DONO (nula para os demais) e o
 * Veredito é por obra, pago. Ordenar por um campo todo-nulo devolveria ordem arbitrária com cara
 * de "ordenado por arte".
 */
const NO_FALLBACK_FIELDS = new Set(["art", "alignment_score"])

interface Level {
  field: string
  dir: "asc" | "desc"
}

/**
 * Os níveis de ordenação que valem de fato para `basis`, a partir dos que a URL pediu.
 *
 * Em "alignment" o eixo do modelo vira o Alinhamento (mesma direção) e a média externa entra no
 * fim como desempate: com poucas tags declaradas o Alinhamento tem poucos valores distintos, e é
 * ela que ordena dentro de cada um. Nível repetido sai (um campo que já decidiu não decide de novo).
 */
export function effectiveSortLevels<L extends Level>(levels: L[], basis: SortBasis): L[] {
  if (basis === "expected") return levels
  const toPlatform = (l: L): L => ({ ...l, field: "platform_avg" })

  const mapped =
    basis === "platform"
      ? levels.map((l) =>
          MODEL_FIELDS.has(l.field) || NO_FALLBACK_FIELDS.has(l.field) || l.field === "personal_fit"
            ? toPlatform(l)
            : l,
        )
      : levels.map((l) =>
          MODEL_FIELDS.has(l.field)
            ? ({ ...l, field: "personal_fit" } as L)
            : NO_FALLBACK_FIELDS.has(l.field)
              ? toPlatform(l)
              : l,
        )

  const seen = new Set<string>()
  const out = mapped.filter((l) => (seen.has(l.field) ? false : (seen.add(l.field), true)))
  if (basis === "alignment" && seen.has("personal_fit") && !seen.has("platform_avg")) {
    out.push({ ...out[0], field: "platform_avg", dir: "desc" })
  }
  return out
}

/**
 * A ordenação PADRÃO de uma lista (`"campo:dir,campo:dir"`, o formato do parâmetro `sort`) como
 * ela vale para `basis`. A página passa este valor ao painel de filtros E à consulta: sem isso o
 * painel de quem não tem modelo dizia "N. Prevista" sobre uma lista ordenada pelo Alinhamento.
 * Mesma função que `getRanking` aplica, então reaplicá-la ao que já foi convertido não muda nada.
 */
export function defaultSortForBasis(sort: string, basis: SortBasis): string {
  if (basis === "expected") return sort
  const levels = sort
    .split(",")
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const [field, dir] = seg.split(":")
      return { field, dir: dir === "asc" ? ("asc" as const) : ("desc" as const) }
    })
  return effectiveSortLevels(levels, basis)
    .map((l) => `${l.field}:${l.dir}`)
    .join(",")
}

/**
 * O Alinhamento de alguém ordena alguma coisa? Sem tag declarada o recálculo deixa `personal_fit`
 * nulo; com o perfil sem variação, 0,5 em todas as obras. Nos dois casos ele não separa nada, e a
 * lista fica na média externa. `Number()`: a coluna é `numeric`, que pode chegar como texto.
 */
export function hasAlignmentSignal(fits: Iterable<unknown>): boolean {
  let first: number | null = null
  for (const raw of fits) {
    const fit = raw == null ? NaN : Number(raw)
    if (!Number.isFinite(fit)) continue
    if (first === null) first = fit
    else if (fit !== first) return true
  }
  return false
}
