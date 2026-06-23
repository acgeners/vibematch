/**
 * Serialização CANÔNICA e estável para chaves de cache (plano §6).
 *
 * Regras (todas testadas em tests/unit/ai-cache/canonicalize.test.ts):
 *  - ordena chaves de OBJETOS (ordem de inserção não muda a saída);
 *  - PRESERVA a ordem de ARRAYS (quem quiser ordem irrelevante ordena ANTES);
 *  - distingue `null`, ausente (undefined) e string vazia;
 *  - normaliza números sem perda (-0 → 0; rejeita NaN/Infinity);
 *  - locale-independente (sem toLocaleString, sem Date implícito);
 *  - determinístico: mesma entrada ⇒ mesma saída;
 *  - recusa nomes de campo que pareçam SECRET (defesa: nunca hashear credencial).
 *
 * Função PURA: sem Date.now(), sem random, sem acesso a banco, sem mutar input.
 */

/** Nomes de campo proibidos numa chave de cache (defesa contra hashear secrets). */
const SECRET_KEY_RE = /(api[_-]?key|secret|password|service[_-]?role|authorization|bearer[_-]?token|access[_-]?token)/i

export class CanonicalizeError extends Error {}

/**
 * Converte um valor arbitrário numa estrutura JSON canônica (objetos com chaves
 * ordenadas; `undefined` removido; números normalizados). Não serializa em
 * string — devolve a estrutura, pronta pra `JSON.stringify` determinístico.
 */
export function canonicalize(value: unknown): unknown {
  return canonicalizeInner(value, new WeakSet())
}

function canonicalizeInner(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null
  if (value === undefined) return undefined

  const t = typeof value
  if (t === "string" || t === "boolean") return value

  if (t === "number") {
    const n = value as number
    if (!Number.isFinite(n)) {
      throw new CanonicalizeError(`Número não-finito não pode entrar numa chave de cache: ${String(n)}`)
    }
    return n === 0 ? 0 : n // normaliza -0 → 0
  }

  if (t === "bigint") return `${(value as bigint).toString()}n`

  if (t === "function" || t === "symbol") {
    throw new CanonicalizeError(`Tipo não-serializável numa chave de cache: ${t}`)
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new CanonicalizeError("Referência circular numa chave de cache.")
    seen.add(value)
    // Arrays preservam a ORDEM (semântica). `undefined`/funções viram null
    // (igual ao JSON.stringify) para manter o índice estável.
    const out = value.map((v) => {
      const c = canonicalizeInner(v, seen)
      return c === undefined ? null : c
    })
    seen.delete(value)
    return out
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>
    if (seen.has(obj)) throw new CanonicalizeError("Referência circular numa chave de cache.")
    seen.add(obj)
    const out: Record<string, unknown> = {}
    // Ordena as chaves → ordem de inserção não afeta a saída.
    for (const key of Object.keys(obj).sort()) {
      if (SECRET_KEY_RE.test(key)) {
        throw new CanonicalizeError(`Campo sensível recusado numa chave de cache: "${key}"`)
      }
      const c = canonicalizeInner(obj[key], seen)
      // `undefined` é OMITIDO (ausente ≠ null ≠ ""). Espelha JSON.stringify.
      if (c !== undefined) out[key] = c
    }
    seen.delete(obj)
    return out
  }

  throw new CanonicalizeError(`Tipo não suportado numa chave de cache: ${t}`)
}

/**
 * Serialização determinística: canonicaliza e converte em string estável.
 * Duas entradas semanticamente iguais (mesma ordem de array, chaves em qualquer
 * ordem) produzem a MESMA string.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? "null"
}
