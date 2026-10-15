import { describe, expect, it } from "vitest"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { workContentBadge } from "@/lib/editions/mixed-edition"

/**
 * O selo de conteúdo da página da obra. Decisão de produto de 2026-10-14, que revoga a de 12/10 (na
 * mixed, o "18+" seguia a versão aberta, e a obra mostrava "18+" e "Versão R19 disponível" juntos): o
 * selo descreve a ESTRUTURA editorial, não a aba. Mixed (normal + R18) ⇒ só "Versão R19 disponível";
 * obra adulta sem versão mais leve ⇒ só "18+".
 */
describe("selo de conteúdo — a matriz da decisão", () => {
  it("mixed ⇒ 'Versão R19 disponível', nunca '18+' — também com adult_override ligando o gate", () => {
    expect(workContentBadge({ isMixed: true, isAdult: false })).toBe("r19_edition")
    expect(workContentBadge({ isMixed: true, isAdult: true })).toBe("r19_edition")
  })
  it("fora das mixed: adulta (r18_only, unknown, single adulta) ⇒ '18+' e nenhum selo de versão; não adulta ⇒ nenhum", () => {
    expect(workContentBadge({ isMixed: false, isAdult: true })).toBe("adult")
    expect(workContentBadge({ isMixed: false, isAdult: false })).toBeNull()
  })
})

describe("página da obra — fiação do selo (lida do source)", () => {
  const src = readFileSync(join(process.cwd(), "app/catalog/[id]/page.tsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")

  it("os DOIS selos saem de uma decisão só, pelo estado de edição — a versão aberta não entra", () => {
    expect(src).toMatch(/const contentBadge = workContentBadge\(\{\s*isMixed:\s*isMixedWork,\s*isAdult\s*\}\)/)
    expect(src).toMatch(/\{contentBadge === "adult" && \(/)
    expect(src).toMatch(/\{contentBadge === "r19_edition" && <EditionNoteBadge/)
    // Trocar Normal/R18 não pode mexer no selo: nada do cabeçalho de selos lê a versão aberta.
    const decisao = src.match(/const contentBadge = [^\n]*/)?.[0] ?? ""
    expect(decisao).not.toMatch(/activeEdition/)
    expect(src).not.toMatch(/showsAdultBadge|hasEditionNoteTag/)
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

describe("o selo não decide filtro", () => {
  it("nenhum código de servidor (consultas, filtros, ocultação) consulta a decisão do selo", () => {
    // Escopo `server/`: é onde moram as consultas e os filtros. `lib/` pode ter helper de UI legítimo.
    const usos = execSync("git grep -lE 'workContentBadge\\(|WorkContentChip' -- server || true", {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
    expect(usos).toEqual([])
  })
})
