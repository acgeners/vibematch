import { describe, it, expect } from "vitest"
import {
  buildReadingStatusFormHtml,
  assertReadingStatusFormOffline,
  countFormCards,
  guardFormOutput,
  type ReadingStatusFormWork,
} from "@/lib/synopsis-interest/reading-status-form"

function works(n: number): ReadingStatusFormWork[] {
  return Array.from({ length: n }, (_, i) => ({
    workId: `w${i + 1}`,
    title: `Obra ${i + 1}`,
    personalStatus: i % 2 ? "Want to Read" : "Completed",
    chaptersRead: i % 2 ? null : 100,
    totalChapters: 100,
    lastReadAt: i % 2 ? null : "2026-01-01",
    dbSuggested: i % 2 ? "unread" : "fully_read",
  }))
}
const meta = { goldenVersion: "pilot-1", baseSnapshotVersion: "base-1" }

describe("reading-status-form — HTML offline", () => {
  it("14. o HTML contém EXATAMENTE 80 obras (1 por work_id) e 5 opções por obra", () => {
    const html = buildReadingStatusFormHtml(works(80), meta)
    expect(countFormCards(html)).toBe(80)
    const doc = new DOMParser().parseFromString(html, "text/html")
    expect(doc.querySelectorAll("[data-work-id]").length).toBe(80)
    expect(doc.querySelectorAll('input[type="radio"][value="uncertain"]').length).toBe(80)
    expect(doc.querySelectorAll('input[type="radio"][value="unread_familiar"]').length).toBe(80)
    // 5 categorias × 80 obras = 400 radios
    expect(doc.querySelectorAll('input[type="radio"]').length).toBe(400)
  })

  it("15. o HTML NÃO contém campos proibidos nem valores de label de interesse", () => {
    const html = buildReadingStatusFormHtml(works(80), meta)
    const v = assertReadingStatusFormOffline(html, { expectedCount: 80 })
    expect(v.ok).toBe(true)
    expect(v.issues).toEqual([])
    expect(html).not.toMatch(/♥/) // labels de interesse (escala ♥..♥♥♥♥)
    expect(html).not.toMatch(/\bstratum\b/i)
    expect(html).not.toMatch(/\bsplit\b/i)
    expect(html).not.toMatch(/\bprediction\b/i)
    expect(html).not.toMatch(/\balignment\b/i)
  })

  it("mostra apenas os sinais permitidos (título, status, capítulos, sugestão não-autoritativa)", () => {
    const html = buildReadingStatusFormHtml(works(3), meta)
    expect(html).toMatch(/Obra 1/)
    expect(html).toMatch(/Status no banco/)
    expect(html).toMatch(/Capítulos lidos/)
    expect(html).toMatch(/NÃO autoritativa/)
    expect(html).toMatch(/anterior.+rotulagem/i) // nota de familiaridade
  })

  it("é 100% offline (sem fetch/XHR/URL externa/iframe/handler inline)", () => {
    const html = buildReadingStatusFormHtml(works(2), meta)
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/fetch\s*\(/)
    expect(html).not.toMatch(/XMLHttpRequest/)
    expect(html).not.toMatch(/<iframe/)
    expect(html).not.toMatch(/\sonclick\s*=/)
  })

  it("countFormCards ignora as referências dentro do <script>", () => {
    expect(countFormCards(buildReadingStatusFormHtml(works(5), meta))).toBe(5)
  })

  it("a asserção detecta vazamento de label de interesse se injetado", () => {
    const html = buildReadingStatusFormHtml(works(1), meta).replace("</body>", "<span>♥♥♥</span></body>")
    const v = assertReadingStatusFormOffline(html)
    expect(v.ok).toBe(false)
    expect(v.issues.some((s) => /♥/.test(s))).toBe(true)
  })
})

describe("reading-status-form — proteção contra sobrescrita (guardFormOutput)", () => {
  it("arquivo inexistente → geração permitida", () => {
    expect(guardFormOutput({ outputExists: false, force: false }).allowed).toBe(true)
  })

  it("arquivo existente SEM --force → bloqueio", () => {
    const g = guardFormOutput({ outputExists: true, force: false })
    expect(g.allowed).toBe(false)
    expect(g.reason).toMatch(/já existe|sobrescrever/i)
  })

  it("saída DIFERENTE (caminho inexistente) → permitido", () => {
    // --out=<outro caminho> resolve para um arquivo que ainda não existe ⇒ outputExists=false
    expect(guardFormOutput({ outputExists: false, force: false }).allowed).toBe(true)
  })

  it("arquivo existente COM --force → permitido (suportado, não executado sobre o artefato real)", () => {
    expect(guardFormOutput({ outputExists: true, force: true }).allowed).toBe(true)
  })
})
