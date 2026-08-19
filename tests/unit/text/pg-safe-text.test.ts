import { describe, it, expect } from "vitest"
import { pgSafeText, pgSafeDeep } from "@/lib/text/pg-safe-text"

/**
 * O caractere que derruba a escrita é INVISÍVEL, então o teste o constrói à mão.
 * `HIGH` sozinho é o que sobra quando um `.slice(0, 900)` corta um emoji ao meio —
 * exatamente o que aconteceu em 2026-08-18 e fez o PostgREST devolver 400 para
 * `POST /work_reviews` e `PATCH /ai_evaluations`.
 */
const HIGH = String.fromCharCode(0xd83d) // metade alta de 🙂
const LOW = String.fromCharCode(0xde42) // metade baixa
const NUL = String.fromCharCode(0)

/** O que o Postgres/PostgREST recusam: surrogate sem par no JSON serializado. */
function temSurrogateSolto(json: string): boolean {
  return /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(json) || /(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f]/i.test(json)
}

describe("pgSafeText: o que o Postgres não tem como armazenar", () => {
  it("remove o surrogate ALTO solto (emoji cortado ao meio)", () => {
    expect(pgSafeText(`review boa${HIGH}`)).toBe("review boa")
  })

  it("remove o surrogate BAIXO solto", () => {
    expect(pgSafeText(`${LOW}review boa`)).toBe("review boa")
  })

  it("remove o NUL", () => {
    expect(pgSafeText(`a${NUL}b`)).toBe("ab")
  })

  it("🔴 NÃO estraga o emoji INTEIRO — senão a correção viraria censura de texto", () => {
    expect(pgSafeText("adorei 🙂 demais")).toBe("adorei 🙂 demais")
    expect(pgSafeText("família 👨‍👩‍👧 e 🇧🇷")).toBe("família 👨‍👩‍👧 e 🇧🇷")
  })

  it("devolve a MESMA string quando não há nada a limpar (fast path)", () => {
    const s = "texto comum, sem nada de estranho"
    expect(pgSafeText(s)).toBe(s)
  })

  it("passa null/undefined adiante (as colunas são anuláveis)", () => {
    expect(pgSafeText(null)).toBeNull()
    expect(pgSafeText(undefined)).toBeUndefined()
  })

  it("reproduz o mecanismo REAL: cortar por unidade UTF-16 quebra o par", () => {
    const cortado = `abc🙂def`.slice(0, 4) // corta no meio do emoji
    expect(temSurrogateSolto(JSON.stringify({ t: cortado }))).toBe(true)
    expect(temSurrogateSolto(JSON.stringify({ t: pgSafeText(cortado) }))).toBe(false)
  })
})

describe("pgSafeDeep: o jsonb inteiro, não só o campo principal", () => {
  it("limpa string ANINHADA — é lá no fundo que a review mora", () => {
    const raw = {
      summary: "ok",
      evaluationContext: {
        sourcedReviews: [{ id: "R1", text: `gostei muito${HIGH}` }, { id: "R2", text: "normal" }],
      },
    }
    const safe = pgSafeDeep(raw)
    expect(safe.evaluationContext.sourcedReviews[0].text).toBe("gostei muito")
    expect(temSurrogateSolto(JSON.stringify(safe))).toBe(false)
  })

  it("limpa a CHAVE também (o Postgres recusa a chave do mesmo jeito)", () => {
    const safe = pgSafeDeep({ [`fonte${HIGH}`]: 1 })
    expect(Object.keys(safe)).toEqual(["fonte"])
  })

  it("preserva tipos não-texto (número, booleano, null) — o payload é diagnóstico", () => {
    const safe = pgSafeDeep({ n: 3, b: true, z: null, arr: [1, "a"] })
    expect(safe).toEqual({ n: 3, b: true, z: null, arr: [1, "a"] })
  })
})
