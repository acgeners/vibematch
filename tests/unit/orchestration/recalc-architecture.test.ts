import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante arquitetural (Fase B passo 5 — correção 1): o recálculo só pode ser
 * EXECUTADO pelo runner da integração. Em produção, ninguém importa `recalculateAll`
 * (nem o ex-`recalculateWork`) de `calculations` direto — todos passam por
 * recalculateScoresNow/ensureRecalculateScores. Teste robusto: varre TODOS os
 * arquivos de produção (não depende de lista frágil).
 */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p)
  }
  return out
}

// calculations.ts DEFINE recalculateAll (não importa). recalc-queue.ts é o ÚNICO
// runner autorizado a importá-la.
const DEFINER = "server/actions/calculations.ts"
const RUNNER = "server/actions/recalc-queue.ts"

describe("arquitetura: recalculateAll só pelo runner da integração", () => {
  it("nenhum arquivo de produção importa recalculateAll/recalculateWork de calculations (exceto o runner)", () => {
    const files = ["server", "lib", "app", "components"].flatMap((d) => walk(d))
    const staticImport = /import\s*\{[^}]*\b(?:recalculateAll|recalculateWork)\b[^}]*\}\s*from\s*["'][^"']*\/calculations["']/
    const dynImport = /import\s*\(\s*["'][^"']*\/calculations["']\s*\)/

    const offenders: string[] = []
    for (const file of files) {
      if (file === DEFINER || file === RUNNER) continue
      const src = readFileSync(file, "utf8")
      if (staticImport.test(src)) offenders.push(`${file} (import estático de recalculateAll/Work)`)
      else if (dynImport.test(src) && /\brecalculate(All|Work)\b/.test(src.replace(/\/\/.*$/gm, ""))) {
        offenders.push(`${file} (import dinâmico de calculations p/ recalc)`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("o runner importa recalculateAll (sanidade do teste)", () => {
    const src = readFileSync(RUNNER, "utf8")
    expect(/import\s*\{[^}]*\brecalculateAll\b[^}]*\}\s*from\s*["'][^"']*\/calculations["']/.test(src)).toBe(true)
  })
})
