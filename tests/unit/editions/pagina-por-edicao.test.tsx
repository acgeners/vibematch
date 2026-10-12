import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveMixedEdition } from "@/lib/editions/mixed-edition"
import { reviewsForEdition } from "@/lib/editions/edition-reviews"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
import { EditionSelector } from "@/components/titles/edition-selector"

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "")

describe("seletor de edição", () => {
  it("dois links de URL (?edition=normal|r18), a ativa marcada — não é switch", () => {
    render(<EditionSelector basePath="/catalog/obra" resolution={resolveMixedEdition({ hideAdult: false, signedIn: true })} />)
    const normal = screen.getByRole("link", { name: "Versão normal" })
    const r18 = screen.getByRole("link", { name: "Versão R18" })
    expect(normal.getAttribute("href")).toBe("/catalog/obra?edition=normal")
    expect(r18.getAttribute("href")).toBe("/catalog/obra?edition=r18")
    expect(r18.getAttribute("aria-current")).toBe("page")
    expect(normal.getAttribute("aria-current")).toBeNull()
    expect(screen.queryByRole("switch")).toBeNull()
  })
  it("ocultar 18+ força a normal e o texto diz que a R18 pede confirmação", () => {
    render(<EditionSelector basePath="/catalog/obra" resolution={resolveMixedEdition({ hideAdult: true, signedIn: true })} />)
    expect(screen.getByRole("link", { name: "Versão normal" }).getAttribute("aria-current")).toBe("page")
    expect(screen.getByText(/a versão R18 pede confirmação e sua preferência não muda/)).toBeTruthy()
  })
  it("trocar de edição é navegar: o seletor não chama action nenhuma (a preferência não muda)", () => {
    const src = ler("components/titles/edition-selector.tsx")
    expect(src).not.toMatch(/server\/actions/)
    expect(src).not.toMatch(/"use client"/)
  })
})

describe("página da obra — fiação por edição (lida do source)", () => {
  const page = semComentarios(ler("app/catalog/[id]/page.tsx"))

  it("o seletor só existe em obra mixed (a resolução só nasce de isMixedWork)", () => {
    expect(page).toMatch(/const isMixedWork = isMixedEditionState\(work\.edition_state\)/)
    expect(page).toMatch(/const editionResolution = isMixedWork\s*\?\s*resolveMixedEdition\(/)
    expect(page).toMatch(/\{editionResolution && <EditionSelector/)
  })
  it("a URL (?edition) e o filtro (?adult) entram na resolução; hide vem das preferências", () => {
    expect(page).toMatch(/urlEdition: parseMixedEdition\(sp\.edition\)/)
    expect(page).toMatch(/adultFilter: sp\.adult === "hide" \|\| sp\.adult === "only"/)
    expect(page).toMatch(/hideAdult: editionSettings\?\.hideAdult/)
  })
  it("a nota de adult_content da página é a da edição — ou some; nunca a misturada", () => {
    expect(page).toMatch(/adultContentFor\(\s*\{ isMixed: isMixedWork, legacyScore: scoreMap\.adult_content, editionRows \}/)
    expect(page).toMatch(/if \(adultResolution\.kind === "edition"\) scoreMap\.adult_content = adultResolution\.score\s*else delete scoreMap\.adult_content/)
  })
  it("nota ausente mostra a procedência ('Não avaliado para esta versão')", () => {
    expect(page).toMatch(/isEditionScore && editionProvenance && activeEdition/)
    expect(page).toMatch(/editionProvenance\.label/)
  })
  it("na normal: tags da R18 e adultas de edição desconhecida saem (pelas flags), avisos exclusivos saem, reviews/síntese filtradas", () => {
    expect(page).toMatch(/isMixedWork && activeEdition === "normal"/)
    expect(page).toMatch(/tagsForEdition\(withTagFlags\(objetos, tagEditionFlags\), "normal"\)/)
    expect(page).toMatch(/fetchTagEditionFlags\(/)
    expect(page).toMatch(/warningsForEdition\(displayableContentWarnings\(reviewsSnapshot\.digest\), activeEdition/)
    expect(page).toMatch(/snapshot=\{editionReviews\.snapshot\}/)
  })
  it("Nota Prevista/Chance são as DA EDIÇÃO ATIVA (dono único), nunca as de outra edição", () => {
    expect(page).toMatch(/predictionForEdition\(work\.calculated_scores, isMixedWork, activeEdition\)/)
    expect(page).toMatch(/work\.calculated_scores = editionPrediction\.row/)
  })
  it("ocultar 18+ + pedir a R18 ⇒ portão de confirmação (variante da edição R18)", () => {
    expect(page).toMatch(/gated=\{gateAdult \|\| gateR18Edition\}/)
    expect(page).toMatch(/const gateR18Edition = editionResolution\?\.requiresConfirmation === true/)
  })
})

describe("reviews na versão normal: sem fingir separação", () => {
  const snap = {
    total: 3,
    bySource: [{ source: "mal", reviews: [{ text: "the smut is perfect" }, { text: "great art and pacing" }, { text: "loved the FL" }] }],
    manual: [],
    summary: "Readers praise the art.",
    digest: { consensus: "Romance leve e bem desenhado.", content_warnings: ["Cenas sexuais explícitas (smut)", "Violência gráfica"] },
  }
  it("na normal: sai a review que cita sexo explícito, e o aviso exclusivo da R18", () => {
    const v = reviewsForEdition(snap, "normal")
    expect(v.reviewsHidden).toBe(1)
    expect(v.snapshot.bySource[0].reviews.map((r) => r.text)).toEqual(["great art and pacing", "loved the FL"])
    expect(v.snapshot.total).toBe(2)
    expect(v.synthesisHidden).toBe(false)
    expect(v.snapshot.digest?.content_warnings).toEqual(["Violência gráfica"])
  })
  it("síntese que cita sexo explícito sai INTEIRA na normal (digest e resumo)", () => {
    const v = reviewsForEdition({ ...snap, digest: { ...snap.digest, consensus: "Smut explícito e recorrente." } }, "normal")
    expect(v.synthesisHidden).toBe(true)
    expect(v.snapshot.digest).toBeNull()
    expect(v.snapshot.summary).toBeNull()
  })
  it("na R18 (e em obra não-mixed) tudo passa intacto", () => {
    expect(reviewsForEdition(snap, "r18").snapshot).toBe(snap)
    expect(reviewsForEdition(snap, null).snapshot).toBe(snap)
  })
})
