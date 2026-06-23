import { describe, it, expect } from "vitest"
import {
  buildBlindHtml,
  buildLabelsTemplateCsv,
  assertBlindHtmlOffline,
  computeLabelingPackageSignature,
  sha256Hex,
  type BlindSlot,
} from "@/lib/synopsis-interest/blind-package"

const meta = { experimentVersion: "digest-exp-1", goldenVersion: "pilot-1", snapshotVersion: "base-1" }

const slots: BlindSlot[] = [
  { slotKey: "S001", synopsis: "A heroine navigates a slow burn romance.", shuffleOrder: 2 },
  { slotKey: "R001", synopsis: "A heroine navigates a slow burn romance.", shuffleOrder: 1 }, // repetição da mesma obra
  { slotKey: "S002", synopsis: "A villainess seeks redemption.", shuffleOrder: 3 },
]

describe("blind-package — HTML", () => {
  it("respeita a ordem congelada (shuffleOrder)", () => {
    const html = buildBlindHtml(slots, meta)
    expect(html.indexOf("R001")).toBeLessThan(html.indexOf("S001"))
    expect(html.indexOf("S001")).toBeLessThan(html.indexOf("S002"))
  })
  it("slots da mesma obra mostram conteúdo IDÊNTICO, sem marca de repetição", () => {
    const html = buildBlindHtml(slots, meta)
    expect(html).not.toMatch(/repeti|repeat/i) // sem indicação de repetição
    // os dois cards (S001/R001) têm a mesma sinopse
    const occ = html.split("A heroine navigates a slow burn romance.").length - 1
    expect(occ).toBe(2)
  })
  it("é offline e sem leakage (sem work_id/script/url/output)", () => {
    const html = buildBlindHtml(slots, meta)
    const v = assertBlindHtmlOffline(html, { workIds: ["1a8ec6b3-ad81-49f6-adb2-11e5ea9cb57f"] })
    expect(v.ok).toBe(true)
    expect(v.issues).toEqual([])
  })
  it("não contém work_id, título, tags, scores, ranking", () => {
    const html = buildBlindHtml(slots, meta)
    expect(html).not.toContain("1a8ec6b3")
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/https?:\/\//)
  })
  it("detecta leakage: work_id injetado", () => {
    const bad = buildBlindHtml(slots, meta) + "<!-- 1a8ec6b3-ad81-49f6-adb2-11e5ea9cb57f -->"
    const v = assertBlindHtmlOffline(bad, { workIds: ["1a8ec6b3-ad81-49f6-adb2-11e5ea9cb57f"] })
    expect(v.ok).toBe(false)
  })
  it("detecta leakage: script externo", () => {
    const bad = buildBlindHtml(slots, meta).replace("</body>", '<script src="https://x.com/a.js"></script></body>')
    const v = assertBlindHtmlOffline(bad, { workIds: [] })
    expect(v.ok).toBe(false)
  })
  it("NÃO falsa-positiva quando a SINOPSE contém termos sensíveis (ex.: 'summary', 'http')", () => {
    const s: BlindSlot[] = [{ slotKey: "S009", synopsis: "Here is a summary of the prediction: visit http://example for the alignment.", shuffleOrder: 1 }]
    const html = buildBlindHtml(s, meta)
    const v = assertBlindHtmlOffline(html, { workIds: [] })
    expect(v.ok).toBe(true) // termos estão DENTRO da sinopse (.syn), ignorados pela validação estrutural
  })
  it("escapa HTML da sinopse (sem injeção de tag)", () => {
    const s: BlindSlot[] = [{ slotKey: "S010", synopsis: "<script>alert(1)</script>", shuffleOrder: 1 }]
    const html = buildBlindHtml(s, meta)
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
    expect(assertBlindHtmlOffline(html, { workIds: [] }).ok).toBe(true)
  })
})

describe("blind-package — CSV template", () => {
  it("é slot_key,label vazio na ordem congelada", () => {
    const csv = buildLabelsTemplateCsv(slots)
    expect(csv.split("\n")[0]).toBe("slot_key,label")
    expect(csv).toContain("R001,")
    expect(csv).not.toMatch(/♥/) // template vazio, sem rótulos
  })
})

describe("blind-package — assinaturas", () => {
  it("packageSignature determinístico e order-independent nos slotKeys", () => {
    const html = buildBlindHtml(slots, meta)
    const csv = buildLabelsTemplateCsv(slots)
    const a = computeLabelingPackageSignature({ ...meta, snapshotBaseSignature: "snap", slotKeys: ["S001", "R001", "S002"], blindHtmlSha256: sha256Hex(html), labelsTemplateSha256: sha256Hex(csv) })
    const b = computeLabelingPackageSignature({ ...meta, snapshotBaseSignature: "snap", slotKeys: ["S002", "S001", "R001"], blindHtmlSha256: sha256Hex(html), labelsTemplateSha256: sha256Hex(csv) })
    expect(a).toBe(b)
  })
  it("muda se o HTML mudar", () => {
    const base = computeLabelingPackageSignature({ ...meta, snapshotBaseSignature: "snap", slotKeys: ["S001"], blindHtmlSha256: "h1", labelsTemplateSha256: "c1" })
    const changed = computeLabelingPackageSignature({ ...meta, snapshotBaseSignature: "snap", slotKeys: ["S001"], blindHtmlSha256: "h2", labelsTemplateSha256: "c1" })
    expect(base).not.toBe(changed)
  })
})
