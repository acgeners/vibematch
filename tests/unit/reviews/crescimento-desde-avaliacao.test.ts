import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  describeReviewGrowth,
  rankForDisplay,
  reviewGrowthRatio,
  toReviewGrowth,
} from "@/lib/reviews/review-growth"
import type { ReviewGrowth } from "@/lib/reviews/review-growth"
import { MIN_USEFUL_REVIEW_LENGTH } from "@/lib/reviews/useful-review"

// "+N reviews desde a avaliação (tinha M)" na fila "Reviews novas" de /curation/works. O N é
// DERIVADO (reviews úteis criadas depois da avaliação vigente, `work_review_growth`, migration
// 220) — e por isso o que este arquivo guarda são as três condições para ele não mentir:
//   1. a ordem (proporção) e o corte DEPOIS dela;
//   2. a régua de "útil" igual à do 💬 do card, senão "tinha M" não fecha com a tela;
//   3. nenhuma gravação de review regravando linha depois da avaliação (zeraria o created_at).

const ROOT = join(__dirname, "..", "..", "..")

describe("o crescimento de uma obra", () => {
  it("M é o 💬 de agora menos o N, e nunca fica negativo", () => {
    expect(toReviewGrowth(20, 8)).toEqual({ newUseful: 8, before: 12 })
    // Review apagada depois: o 💬 caiu abaixo do N. "tinha −2" seria absurdo.
    expect(toReviewGrowth(3, 5)).toEqual({ newUseful: 5, before: 0 })
  })

  it("obra sem avaliação concluída não tem crescimento (não há 'desde')", () => {
    expect(toReviewGrowth(20, undefined)).toBeNull()
    expect(toReviewGrowth(20, null)).toBeNull()
  })

  it("a proporção divide por 1 quando não havia nenhuma review", () => {
    expect(reviewGrowthRatio({ newUseful: 5, before: 0 })).toBe(5)
    expect(reviewGrowthRatio({ newUseful: 5, before: 1 })).toBe(5)
    expect(reviewGrowthRatio({ newUseful: 10, before: 20 })).toBe(0.5)
  })

  it("o texto do card só aparece quando entrou alguma, e concorda em número", () => {
    expect(describeReviewGrowth({ newUseful: 0, before: 9 })).toBeNull()
    expect(describeReviewGrowth(null)).toBeNull()
    expect(describeReviewGrowth({ newUseful: 1, before: 9 })).toBe("+1 review desde a avaliação (tinha 9)")
    expect(describeReviewGrowth({ newUseful: 12, before: 80 })).toBe("+12 reviews desde a avaliação (tinha 80)")
  })
})

describe("a ordem da fila e o teto de exibição", () => {
  const row = (id: string, title: string) => ({ id, title })

  it("ordena por PROPORÇÃO: +10 sobre 6 vem antes de +12 sobre 80", () => {
    const rows = [row("a", "A"), row("b", "B")]
    const growth = new Map<string, ReviewGrowth | null>([
      ["a", { newUseful: 12, before: 80 }],
      ["b", { newUseful: 10, before: 6 }],
    ])
    expect(rankForDisplay(rows, growth, 10).displayed.map((r) => r.id)).toEqual(["b", "a"])
  })

  it("empate na proporção: ganha quem ganhou mais em número; sem crescimento, por título, depois", () => {
    const rows = [row("z", "Zeta"), row("m", "Mu"), row("x", "Xi"), row("y", "Ypsilon")]
    const growth = new Map<string, ReviewGrowth | null>([
      ["x", { newUseful: 2, before: 1 }], // 2,0
      ["y", { newUseful: 4, before: 2 }], // 2,0 — mais em número
      ["m", { newUseful: 0, before: 30 }], // sem crescimento
    ])
    expect(rankForDisplay(rows, growth, 10).displayed.map((r) => r.id)).toEqual(["y", "x", "m", "z"])
  })

  it("🔴 o corte vem DEPOIS da ordem: as que mais cresceram cabem mesmo no fim do alfabeto", () => {
    // 600 obras, teto 500; as 5 com crescimento têm títulos que, por ordem alfabética, cairiam fora.
    const rows = Array.from({ length: 600 }, (_, i) => row(`w${i}`, `A ${String(i).padStart(3, "0")}`))
    for (let i = 0; i < 5; i++) rows.push(row(`grew${i}`, `ZZZ ${i}`))
    const growth = new Map<string, ReviewGrowth | null>(
      Array.from({ length: 5 }, (_, i) => [`grew${i}`, { newUseful: 10 + i, before: 5 }] as const),
    )
    const { displayed, matchedCount } = rankForDisplay(rows, growth, 500)
    expect(matchedCount).toBe(605)
    expect(displayed).toHaveLength(500)
    expect(displayed.slice(0, 5).map((r) => r.id)).toEqual(["grew4", "grew3", "grew2", "grew1", "grew0"])

    // Contraprova: cortar por título ANTES de ordenar (o arranjo antigo) deixa as 5 de fora.
    const porTitulo = [...rows].sort((a, b) => a.title.localeCompare(b.title)).slice(0, 500)
    expect(porTitulo.some((r) => r.id.startsWith("grew"))).toBe(false)
  })

  it("sem mapa de crescimento (caminho cacheado das contagens), a ordem é a de antes: por título", () => {
    const rows = [row("c", "Gama"), row("a", "Alfa"), row("b", "Beta")]
    expect(rankForDisplay(rows, new Map(), 10).displayed.map((r) => r.title)).toEqual(["Alfa", "Beta", "Gama"])
  })
})

/** O texto da migration MAIS RECENTE que (re)define a função, sem comentários SQL. */
function latestFunctionSql(fnName: string): string {
  const dir = join(ROOT, "supabase", "migrations")
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(public\\.)?${fnName}\\s*\\(`, "i")
  const hit = files.filter((f) => re.test(readFileSync(join(dir, f), "utf8"))).at(-1)
  if (!hit) throw new Error(`nenhuma migration define ${fnName}`)
  const sql = readFileSync(join(dir, hit), "utf8").replace(/--[^\n]*/g, "")
  const start = sql.search(re)
  return sql.slice(start, sql.indexOf("$$;", start))
}

describe("a régua de 'útil' é uma só (o 💬 do card × o N da fila)", () => {
  const thresholds = (sql: string) => ({
    scraped: [...sql.matchAll(/text_length\s*>=\s*(\d+)/g)].map((m) => Number(m[1])),
    manual: [...sql.matchAll(/char_length\s*\(\s*btrim\s*\(\s*\w+\.text\s*\)\s*\)\s*>=\s*(\d+)/g)].map((m) => Number(m[1])),
  })

  it("work_review_growth usa os MESMOS limiares de work_card_counts, e os dois são MIN_USEFUL_REVIEW_LENGTH", () => {
    const card = thresholds(latestFunctionSql("work_card_counts"))
    const growth = thresholds(latestFunctionSql("work_review_growth"))
    // Nenhuma das duas pode passar por vacuidade: a régua tem de estar escrita nas duas.
    expect(card.scraped.length).toBeGreaterThan(0)
    expect(card.manual.length).toBeGreaterThan(0)
    expect(growth.scraped.length).toBeGreaterThan(0)
    expect(growth.manual.length).toBeGreaterThan(0)
    for (const n of [...card.scraped, ...card.manual, ...growth.scraped, ...growth.manual]) {
      expect(n).toBe(MIN_USEFUL_REVIEW_LENGTH)
    }
  })

  it("a avaliação vigente é a completed mais recente por created_at, com a data que a fila imprime", () => {
    const sql = latestFunctionSql("work_review_growth")
    expect(sql).toMatch(/status\s*=\s*'completed'/)
    expect(sql).toMatch(/order\s+by\s+e\.work_id\s*,\s*e\.created_at\s+desc\s*,\s*e\.id\s+desc/i)
    expect(sql).toMatch(/coalesce\s*\(\s*e\.updated_at\s*,\s*e\.created_at\s*\)/i)
    // Só as que entraram DEPOIS contam — `>=` contaria as que a avaliação leu.
    expect(sql).toMatch(/created_at\s*>\s*ev\.at/)
  })
})

/** Os nomes pelos quais `saveWorkReviews` é chamado num arquivo: ele mesmo e os apelidos. */
function saveWorkReviewsNames(src: string): string[] {
  const names = new Set<string>()
  if (/\bsaveWorkReviews\b/.test(src)) names.add("saveWorkReviews")
  // `fn = (await import("…/persist-reviews")).saveWorkReviews` e `{ saveWorkReviews: fn }`.
  for (const m of src.matchAll(/(\w+)\s*=\s*\([^)]*persist-reviews[^)]*\)\)?\.saveWorkReviews\b/g)) names.add(m[1])
  for (const m of src.matchAll(/saveWorkReviews\s*:\s*(\w+)/g)) names.add(m[1])
  return [...names]
}

/** Cada chamada (não a definição) com o texto dos argumentos, por parênteses balanceados. */
function saveWorkReviewsCalls(src: string): Array<{ line: number; args: string }> {
  const out: Array<{ line: number; args: string }> = []
  for (const name of saveWorkReviewsNames(src)) {
    const re = new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g")
    for (const m of src.matchAll(re)) {
      const before = src.slice(Math.max(0, m.index - 20), m.index)
      if (/function\s+$/.test(before)) continue // a definição
      let depth = 0
      let end = m.index + m[0].length - 1
      for (; end < src.length; end++) {
        if (src[end] === "(") depth++
        else if (src[end] === ")" && --depth === 0) break
      }
      out.push({ line: src.slice(0, m.index).split("\n").length, args: src.slice(m.index + m[0].length, end) })
    }
  }
  return out
}

/** Gravação que não regrava linha: acumulativa, ou a da criação (que carimba a data da avaliação). */
const preservaCreatedAt = (args: string) => /\baccumulate\s*:\s*true\b/.test(args) || /\bfromFreshEval\s*:\s*true\b/.test(args)

describe("🔴 nenhuma gravação regrava review depois da avaliação", () => {
  it("o detector acha a chamada por APELIDO, e reprova a que não preserva a data", () => {
    const src = `
      saveWorkReviewsFn = (await import("@/lib/external/persist-reviews")).saveWorkReviews
      await saveWorkReviewsFn(result.workId, externalReviews)
      await saveWorkReviews(id, reviews, { accumulate: true })
    `
    const calls = saveWorkReviewsCalls(src)
    expect(calls).toHaveLength(2)
    expect(calls.filter((c) => !preservaCreatedAt(c.args))).toHaveLength(1)
  })

  it("toda chamada de saveWorkReviews no repo é acumulativa ou é a da criação (fromFreshEval)", () => {
    const files = execSync("git ls-files '*.ts' '*.tsx' '*.mjs'", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => f && !f.startsWith("tests/") && f !== "lib/external/persist-reviews.ts")
    const offenders: string[] = []
    let total = 0
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), "utf8")
      if (!src.includes("saveWorkReviews")) continue
      for (const c of saveWorkReviewsCalls(src)) {
        total++
        if (!preservaCreatedAt(c.args)) offenders.push(`${f}:${c.line}`)
      }
    }
    // Sem chamada nenhuma, o teste passaria por vacuidade — e o detector estaria cego.
    expect(total).toBeGreaterThanOrEqual(5)
    expect(offenders).toEqual([])
  })
})
