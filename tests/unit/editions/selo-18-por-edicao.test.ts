import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveMixedEdition, showsAdultBadge, type MixedEdition } from "@/lib/editions/mixed-edition"

/**
 * O selo "18+" da página da obra. Medido no app em 2026-10-12, com o código do v45: numa obra
 * `mixed` ele lia o gate global (`is_adult`), que na mixed é falso por construção (mig 204) — então
 * NUNCA aparecia, nem na versão R18 — e um `adult_override` o ligava nas DUAS edições (Lucia), afirmando
 * "18+" sobre a versão normal. Decisão de produto: na mixed, quem decide é a EDIÇÃO ATIVA.
 */
const selo = (isMixed: boolean, activeEdition: MixedEdition | null, isAdult: boolean) =>
  showsAdultBadge({ isMixed, activeEdition, isAdult })

describe("selo 18+ — a matriz da decisão de produto", () => {
  it("mixed + normal ⇒ sem selo; mixed + R18 ⇒ com selo", () => {
    expect(selo(true, "normal", false)).toBe(false)
    expect(selo(true, "r18", false)).toBe(true)
  })
  it("mixed com adult_override (gate ligado) ⇒ ainda sem selo na normal, com selo na R18", () => {
    expect(selo(true, "normal", true)).toBe(false)
    expect(selo(true, "r18", true)).toBe(true)
  })
  it("fora das mixed o selo é o gate de sempre (r18_only, unknown e single adulta ⇒ sim; não adulta ⇒ não)", () => {
    expect(selo(false, null, true)).toBe(true)
    expect(selo(false, null, false)).toBe(false)
  })
})

describe("selo 18+ — acompanha a troca de edição pela URL", () => {
  const pela = (ctx: Parameters<typeof resolveMixedEdition>[0]) => selo(true, resolveMixedEdition(ctx).edition, false)
  it("?edition=normal ⇒ sem selo; ?edition=r18 ⇒ com selo", () => {
    expect(pela({ hideAdult: false, urlEdition: "normal" })).toBe(false)
    expect(pela({ hideAdult: false, urlEdition: "r18" })).toBe(true)
  })
  it("sem ?edition vale a preferência (normal por padrão); ?adult=only abre a R18", () => {
    expect(pela({ hideAdult: false })).toBe(false)
    expect(pela({ hideAdult: false, preference: "r18" })).toBe(true)
    expect(pela({ hideAdult: false, adultFilter: "only" })).toBe(true)
  })
  it("quem oculta 18+ cai na normal (sem selo); pedindo a R18, ela vem atrás da confirmação — com selo", () => {
    expect(pela({ hideAdult: true })).toBe(false)
    expect(pela({ hideAdult: true, urlEdition: "r18" })).toBe(true)
  })
})

describe("página da obra — fiação do selo (lida do source)", () => {
  const src = readFileSync(join(process.cwd(), "app/catalog/[id]/page.tsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")

  it("o selo sai de showsAdultBadge com a edição ATIVA — não do gate global sozinho", () => {
    expect(src).toMatch(/showsAdultBadge\(\{\s*isMixed:\s*isMixedWork,\s*activeEdition,\s*isAdult\s*\}\)\s*&&/)
    expect(src).not.toMatch(/\{isAdult && \(/)
  })
  it("o PORTÃO de conteúdo segue no gate (só o selo mudou)", () => {
    expect(src).toMatch(/const gateAdult = isAdult && hideAdultContent/)
  })
  it("o seletor depende só do estado de edição (mixed) — adult_override não entra", () => {
    expect(src).toMatch(/const isMixedWork = isMixedEditionState\(work\.edition_state\)/)
    expect(src).toMatch(/const editionResolution = isMixedWork\s*\?/)
    expect(src).toMatch(/\{editionResolution && <EditionSelector/)
  })
})
