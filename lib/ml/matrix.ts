/**
 * Operações matriciais mínimas para resolver Ridge regression
 * via decomposição de Cholesky. Sem dependências externas.
 *
 * Convenção: matriz é Array<Array<number>>, vetor é Array<number>.
 */

export type Matrix = number[][]
export type Vector = number[]

export function shape(m: Matrix): [number, number] {
  return [m.length, m[0]?.length ?? 0]
}

export function zeros(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Array(cols).fill(0))
}

export function transpose(m: Matrix): Matrix {
  const [r, c] = shape(m)
  const t = zeros(c, r)
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      t[j][i] = m[i][j]
    }
  }
  return t
}

/** A (r×k) * B (k×c) = (r×c) */
export function multiply(a: Matrix, b: Matrix): Matrix {
  const [ar, ak] = shape(a)
  const [br, bc] = shape(b)
  if (ak !== br) throw new Error(`multiply: incompatible ${ar}x${ak} * ${br}x${bc}`)
  const out = zeros(ar, bc)
  for (let i = 0; i < ar; i++) {
    for (let k = 0; k < ak; k++) {
      const aik = a[i][k]
      if (aik === 0) continue
      for (let j = 0; j < bc; j++) {
        out[i][j] += aik * b[k][j]
      }
    }
  }
  return out
}

/** A (r×k) * v (k) = vector (r) */
export function multiplyVec(a: Matrix, v: Vector): Vector {
  const [r, k] = shape(a)
  if (k !== v.length) throw new Error(`multiplyVec: incompatible ${r}x${k} * ${v.length}`)
  const out = new Array<number>(r).fill(0)
  for (let i = 0; i < r; i++) {
    let s = 0
    for (let j = 0; j < k; j++) s += a[i][j] * v[j]
    out[i] = s
  }
  return out
}

/**
 * Resolve sistema simétrico positivo-definido A·x = b via Cholesky.
 * A é destruído. Levanta exceção se não-PD.
 */
export function solveSPD(A: Matrix, b: Vector): Vector {
  const n = A.length
  // Decomposição A = L L^T (L triangular inferior)
  const L = zeros(n, n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j]
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]
      if (i === j) {
        if (sum <= 0) throw new Error("solveSPD: matrix not positive-definite")
        L[i][j] = Math.sqrt(sum)
      } else {
        L[i][j] = sum / L[j][j]
      }
    }
  }
  // Resolve L y = b (forward substitution)
  const y = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    let sum = b[i]
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k]
    y[i] = sum / L[i][i]
  }
  // Resolve L^T x = y (back substitution)
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k]
    x[i] = sum / L[i][i]
  }
  return x
}
