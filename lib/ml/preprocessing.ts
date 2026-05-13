/**
 * Preprocessadores equivalentes aos do scikit-learn usados no script Python:
 *  - SimpleImputer(strategy="median") para numéricos
 *  - StandardScaler para numéricos
 *  - SimpleImputer(strategy="most_frequent") + OneHotEncoder para categóricos
 */

export type NumericRow = (number | null | undefined)[]
export type CategoricalRow = (string | null | undefined)[]

// --------------------------- Numeric ---------------------------

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = q * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export class MedianImputer {
  medians: number[] = []

  fit(rows: NumericRow[]) {
    if (rows.length === 0) return this
    const ncols = rows[0].length
    this.medians = []
    for (let j = 0; j < ncols; j++) {
      const col: number[] = []
      for (const r of rows) {
        const v = r[j]
        if (v != null && Number.isFinite(v)) col.push(v as number)
      }
      this.medians.push(median(col))
    }
    return this
  }

  transform(rows: NumericRow[]): number[][] {
    return rows.map((r) =>
      r.map((v, j) => (v != null && Number.isFinite(v as number) ? (v as number) : this.medians[j]))
    )
  }

  fitTransform(rows: NumericRow[]): number[][] {
    return this.fit(rows).transform(rows)
  }
}

export class StandardScaler {
  means: number[] = []
  stds: number[] = []

  fit(rows: number[][]) {
    if (rows.length === 0) return this
    const ncols = rows[0].length
    this.means = new Array(ncols).fill(0)
    this.stds = new Array(ncols).fill(1)
    for (let j = 0; j < ncols; j++) {
      let sum = 0
      for (const r of rows) sum += r[j]
      const mean = sum / rows.length
      this.means[j] = mean
      let variance = 0
      for (const r of rows) {
        const d = r[j] - mean
        variance += d * d
      }
      variance /= rows.length
      this.stds[j] = Math.sqrt(variance) || 1
    }
    return this
  }

  transform(rows: number[][]): number[][] {
    return rows.map((r) => r.map((v, j) => (v - this.means[j]) / this.stds[j]))
  }

  fitTransform(rows: number[][]): number[][] {
    return this.fit(rows).transform(rows)
  }
}

// --------------------------- Categorical ---------------------------

export function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = ""
  let bestCount = -1
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k
      bestCount = c
    }
  }
  return best
}

export class CategoricalImputer {
  fillers: string[] = []

  fit(rows: CategoricalRow[]) {
    if (rows.length === 0) return this
    const ncols = rows[0].length
    this.fillers = []
    for (let j = 0; j < ncols; j++) {
      const col: string[] = []
      for (const r of rows) {
        const v = r[j]
        if (v != null && v !== "") col.push(String(v))
      }
      this.fillers.push(mostFrequent(col) || "Unknown")
    }
    return this
  }

  transform(rows: CategoricalRow[]): string[][] {
    return rows.map((r) =>
      r.map((v, j) => (v != null && v !== "" ? String(v) : this.fillers[j]))
    )
  }

  fitTransform(rows: CategoricalRow[]): string[][] {
    return this.fit(rows).transform(rows)
  }
}

export class OneHotEncoder {
  categories: string[][] = []

  fit(rows: string[][]) {
    if (rows.length === 0) return this
    const ncols = rows[0].length
    this.categories = []
    for (let j = 0; j < ncols; j++) {
      const set = new Set<string>()
      for (const r of rows) set.add(r[j])
      this.categories.push([...set].sort())
    }
    return this
  }

  transform(rows: string[][]): number[][] {
    return rows.map((r) => {
      const out: number[] = []
      for (let j = 0; j < r.length; j++) {
        const cats = this.categories[j]
        for (const c of cats) out.push(r[j] === c ? 1 : 0)
      }
      return out
    })
  }

  fitTransform(rows: string[][]): number[][] {
    return this.fit(rows).transform(rows)
  }

  /** Nomes das colunas geradas, no formato "<feature>_<category>". */
  featureNames(prefixes: string[]): string[] {
    const names: string[] = []
    for (let j = 0; j < this.categories.length; j++) {
      const prefix = prefixes[j] ?? `cat${j}`
      for (const c of this.categories[j]) names.push(`${prefix}_${c}`)
    }
    return names
  }
}

// --------------------------- Combined ---------------------------

/**
 * Concatena (linha a linha) blocos numérico e categórico já processados.
 */
export function hstack(a: number[][], b: number[][]): number[][] {
  if (a.length !== b.length) throw new Error("hstack: row count mismatch")
  return a.map((row, i) => [...row, ...b[i]])
}
