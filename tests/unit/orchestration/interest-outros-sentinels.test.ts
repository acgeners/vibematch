import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  INTEREST_NONE,
  INTEREST_UNKNOWN_RETIRED,
  matchesManualInterest,
  matchesPredictedInterest,
  sanitizeInterestSelection,
} from "@/lib/interest-sentinels"

const work = (synopsisQuality: string | null) => ({ synopsisQuality })
const pred = (predictedSynopsisQuality: string | null) => ({ predictedSynopsisQuality })

describe("chip 'Outros' do Interesse manual", () => {
  it("♥ selecionado não arrasta obra sem ♥", () => {
    const sel = new Set(["♥♥"])
    expect(matchesManualInterest(work("♥♥"), sel)).toBe(true)
    expect(matchesManualInterest(work(null), sel)).toBe(false)
    expect(matchesManualInterest(work("♥"), sel)).toBe(false)
  })

  it("'none' pega exatamente as obras sem ♥", () => {
    const sel = new Set([INTEREST_NONE])
    expect(matchesManualInterest(work(null), sel)).toBe(true)
    expect(matchesManualInterest(work("♥♥♥"), sel)).toBe(false)
  })

  it("♥ e 'Outros' convivem na mesma seleção (OU)", () => {
    const sel = new Set(["♥", INTEREST_NONE])
    expect(matchesManualInterest(work("♥"), sel)).toBe(true)
    expect(matchesManualInterest(work(null), sel)).toBe(true)
    expect(matchesManualInterest(work("♥♥"), sel)).toBe(false)
  })

  it("seleção vazia não casa nada (quem decide 'sem filtro' é o chamador)", () => {
    expect(matchesManualInterest(work(null), new Set())).toBe(false)
    expect(matchesManualInterest(work("♥♥"), new Set())).toBe(false)
  })
})

describe("chip 'Outros' da Previsão da IA", () => {
  it("'none' pega as obras sem previsão — o caso comum de quem ainda não tem perfil", () => {
    const sel = new Set([INTEREST_NONE])
    expect(matchesPredictedInterest(pred(null), sel)).toBe(true)
    expect(matchesPredictedInterest(pred("♥♥"), sel)).toBe(false)
  })

  it("♥ previsto e 'sem previsão' convivem (OU)", () => {
    const sel = new Set(["♥♥♥", INTEREST_NONE])
    expect(matchesPredictedInterest(pred("♥♥♥"), sel)).toBe(true)
    expect(matchesPredictedInterest(pred(null), sel)).toBe(true)
    expect(matchesPredictedInterest(pred("♥"), sel)).toBe(false)
  })
})

describe("proveniência 'Desconhecido' aposentada (migration 179)", () => {
  it("um filtro salvo com 'unknown' abre SEM ele, não como filtro vazio", () => {
    expect(sanitizeInterestSelection(["♥♥", INTEREST_UNKNOWN_RETIRED])).toEqual(["♥♥"])
    expect(sanitizeInterestSelection([INTEREST_NONE, INTEREST_UNKNOWN_RETIRED])).toEqual([
      INTEREST_NONE,
    ])
  })

  it("seleção que era SÓ 'unknown' vira 'sem filtro' (undefined), nunca lista vazia", () => {
    // 🔴 A distinção é o bug: `[]` significa "nenhuma obra casa" para os chamadores —
    // devolver isso esvaziaria a página de quem tinha o filtro salvo.
    expect(sanitizeInterestSelection([INTEREST_UNKNOWN_RETIRED])).toBeUndefined()
  })

  it("não mexe em seleção sem o token aposentado", () => {
    expect(sanitizeInterestSelection(["♥", "♥♥"])).toEqual(["♥", "♥♥"])
    expect(sanitizeInterestSelection([])).toEqual([])
    expect(sanitizeInterestSelection(undefined)).toBeUndefined()
  })

  it("nenhum código de produção casa por 'legacy_unknown'", () => {
    const dirs = ["server", "lib", "components", "app"]
    const offenders: string[] = []
    for (const dir of dirs) {
      const out = execFileSyncSafe(dir)
      offenders.push(...out)
    }
    expect(offenders, `ainda comparam com legacy_unknown:\n${offenders.join("\n")}`).toEqual([])
  })
})

/** grep simples por comparações com a string aposentada (comentários não contam). */
function execFileSyncSafe(dir: string): string[] {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process")
  try {
    const out = execFileSync(
      "grep",
      ["-rn", "--include=*.ts", "--include=*.tsx", "legacy_unknown", dir],
      { cwd: process.cwd(), encoding: "utf8" },
    )
    return out
      .split("\n")
      .filter(Boolean)
      // linhas de comentário/documentação podem citar o nome — o que não pode é CÓDIGO
      // comparando ou gravando a string.
      .filter((l) => {
        const code = l.slice(l.indexOf(":", l.indexOf(":") + 1) + 1).trim()
        return !code.startsWith("//") && !code.startsWith("*") && !code.startsWith("/*")
      })
  } catch {
    return [] // grep sai com 1 quando não encontra nada
  }
}

describe("arquitetura: a sentinela não pode encurtar o fetch", () => {
  /**
   * `resolvePersonalFilterIds` vira `.in("synopsis_quality", [...])` sobre
   * `user_work_state`. Uma obra sem ♥ não tem linha (ou tem NULL), então pré-resolver
   * por id com a sentinela ligada devolveria vazio JUSTAMENTE para o valor pedido —
   * sem erro e com resultado plausível. O guard tem que existir.
   */
  it("getRanking só pré-resolve ids de Interesse quando não há sentinela", () => {
    const src = readFileSync(resolve(process.cwd(), "server/queries/ranking.ts"), "utf8")
    const guard = src.match(/const interestFilterIds =[\s\S]{0,400}?resolvePersonalFilterIds/)
    expect(guard, "trecho de interestFilterIds não encontrado — o teste precisa ser atualizado")
      .not.toBeNull()
    expect(guard![0]).toContain("!interestHasSentinel")
    expect(src).toMatch(/interestHasSentinel\s*=[\s\S]{0,200}INTEREST_NONE/)
  })
})
