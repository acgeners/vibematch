import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Guard de ISOLAMENTO (Plano 3 B2.2N — canal único). A partir da unificação, existe UM ÚNICO
 * canal de review manual: reviews EXTERNAS (`work_external_reviews_manual`), que alimenta tanto
 * o corpus do digest quanto a AVALIAÇÃO IA. O store de opinião pessoal (`work_manual_reviews`)
 * foi aposentado da UI/feed (tabela preservada no banco, sem leitura/escrita por código vivo).
 * Regra de leakage INTACTA: o corpus do digest NUNCA pode ler `work_manual_reviews`.
 * Varredura ESTÁTICA do código (sem comentários).
 */
function code(p: string): string {
  const raw = readFileSync(resolve(process.cwd(), p), "utf8")
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n")
}

describe("isolamento — canal único de review manual (externas)", () => {
  it("a Server Action externa grava SÓ work_external_reviews_manual", () => {
    const src = code("server/actions/external-manual-reviews.ts")
    expect(src).toContain("work_external_reviews_manual")
    expect(src.includes("work_manual_reviews")).toBe(false)
  })

  it("a avaliação IA (ai.ts) lê reviews EXTERNAS manuais — não o store pessoal", () => {
    const src = code("server/actions/ai.ts")
    expect(src).toContain("readManualExternalReviewsForDisplay")
    expect(src.includes("getManualReviews")).toBe(false)
    expect(src.includes("work_manual_reviews")).toBe(false)
  })

  it("o card de exibição (work-reviews) usa o loader externo, não o pessoal", () => {
    const src = code("server/queries/work-reviews.ts")
    expect(src).toContain("readManualExternalReviewsForDisplay")
    expect(src.includes("getManualReviews")).toBe(false)
    expect(src.includes("work_manual_reviews")).toBe(false)
  })

  it("leakage: o corpus do digest NUNCA lê work_manual_reviews", () => {
    for (const f of [
      "lib/synopsis-interest/canonical-review-corpus.ts",
      "lib/synopsis-interest/digest-corpus.ts",
    ]) {
      expect(code(f).includes("work_manual_reviews"), `${f} não pode ler o store pessoal`).toBe(false)
    }
  })

  it("a UI viva não importa mais o editor de impressões pessoais (removido)", () => {
    for (const f of [
      "components/titles/reviews-editor.tsx",
      "components/titles/ai-evaluation-button.tsx",
      "app/catalog/[id]/edit/page.tsx",
    ]) {
      const src = code(f)
      expect(src.includes("review-drafts-field"), `${f}`).toBe(false)
      // path-specific: NÃO casa external-manual-reviews-section (substring)
      expect(src.includes("/manual-reviews-section"), `${f}`).toBe(false)
      expect(src.includes("saveManualReviews"), `${f}`).toBe(false)
    }
  })
})
