import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))

import {
  MIN_EVIDENCE_CHARS,
  buildOpeningMaterial,
  normalizeOpeningVerdict,
  type OpeningStructureContext,
} from "@/lib/works/opening-structure"

/**
 * A régua de estrutura de abertura.
 *
 * 🔴 O caso que importa é o PRIMEIRO bloco: veredito afirmativo sem citação vira
 * "indeterminado". Sem esse rebaixamento, o modo de falha é o que o piloto de 19 obras foi
 * desenhado para impedir — com 320 obras de reencarnação no catálogo, "flashforward" é o chute
 * plausível, e na tela um veredito sem prova é indistinguível de um com prova.
 */

const CTX_BASE: OpeningStructureContext = {
  workId: "w1",
  title: "Obra",
  synopsis: null,
  digest: null,
  reviews: [],
  tropeTags: [],
}

describe("normalizeOpeningVerdict — citação obrigatória", () => {
  it("rebaixa 'flashforward' sem evidência para 'indeterminado'", () => {
    const r = normalizeOpeningVerdict({ veredito: "flashforward", evidencia: "", confianca: 0.9 })
    expect(r.verdict).toBe("indeterminado")
    expect(r.evidence).toBe("")
  })

  it("rebaixa também quando a evidência é curta demais para ser citação", () => {
    const curta = "x".repeat(MIN_EVIDENCE_CHARS - 1)
    expect(normalizeOpeningVerdict({ veredito: "linear", evidencia: curta }).verdict).toBe("indeterminado")
  })

  it("rebaixa quando a evidência é só espaço em branco", () => {
    const r = normalizeOpeningVerdict({ veredito: "flashforward", evidencia: "        \n   \t  " })
    expect(r.verdict).toBe("indeterminado")
  })

  it("mantém o veredito quando há citação de verdade", () => {
    const cita = "they show us like towards the end of the story"
    const r = normalizeOpeningVerdict({ veredito: "flashforward", evidencia: cita, confianca: 0.9 })
    expect(r.verdict).toBe("flashforward")
    expect(r.evidence).toBe(cita)
  })

  it("'indeterminado' não precisa de citação — a ausência dela é o que ele afirma", () => {
    const r = normalizeOpeningVerdict({ veredito: "indeterminado", evidencia: "", raciocinio: "só enredo" })
    expect(r.verdict).toBe("indeterminado")
    expect(r.rationale).toBe("só enredo")
  })

  it("veredito desconhecido ou payload ausente cai em 'indeterminado', nunca num afirmativo", () => {
    expect(normalizeOpeningVerdict({ veredito: "talvez", evidencia: "x".repeat(40) }).verdict).toBe(
      "indeterminado",
    )
    expect(normalizeOpeningVerdict(null).verdict).toBe("indeterminado")
  })

  it("mantém a confiança dentro de 0..1", () => {
    expect(normalizeOpeningVerdict({ confianca: 7 }).confidence).toBe(1)
    expect(normalizeOpeningVerdict({ confianca: -3 }).confidence).toBe(0)
  })
})

describe("buildOpeningMaterial — a evidência não pode ser cortada pelo teto", () => {
  it("põe a review que fala da abertura ANTES das que não falam", () => {
    const ctx: OpeningStructureContext = {
      ...CTX_BASE,
      reviews: [
        { source: "a", text: "a arte é linda e os personagens são cativantes" },
        { source: "b", text: "don't read the first chapter, it spoils the ending" },
      ],
    }
    const material = buildOpeningMaterial(ctx)
    expect(material.indexOf("first chapter")).toBeLessThan(material.indexOf("a arte é linda"))
  })

  it("com muitas reviews irrelevantes, a relevante ainda entra", () => {
    // O teto é por CARACTERES: 60 reviews longas encheriam o orçamento antes da última.
    const ruido = Array.from({ length: 60 }, (_, i) => ({
      source: "x",
      text: `resenha genérica sobre romance número ${i} `.repeat(30),
    }))
    const ctx: OpeningStructureContext = {
      ...CTX_BASE,
      reviews: [...ruido, { source: "comix", text: "it's kinda like an end at the beginning" }],
    }
    expect(buildOpeningMaterial(ctx)).toContain("end at the beginning")
  })

  it("rotula as tags de tropo como NÃO-evidência", () => {
    const ctx: OpeningStructureContext = { ...CTX_BASE, tropeTags: ["regression", "time-skip"] }
    const material = buildOpeningMaterial(ctx)
    expect(material).toMatch(/TAGS DE TROPO \(NÃO são evidência/)
    expect(material).toContain("regression")
  })
})

describe("migration 185 — o banco também impõe a citação", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/185_works_opening_structure.sql"),
    "utf8",
  )

  it("tem o CHECK que exige evidência em veredito afirmativo", () => {
    expect(sql).toContain("works_opening_structure_exige_evidencia")
    // O gate do TypeScript protege UM escritor; o CHECK protege todos — inclusive um
    // `update` à mão no Studio e um backfill futuro.
    expect(sql).toMatch(/length\(btrim\(opening_structure_auto_evidence\)\)\s*>=\s*15/)
  })

  it("o override aceita só os dois valores afirmativos", () => {
    const m = sql.match(/works_opening_structure_override_valid[\s\S]{0,220}/)?.[0] ?? ""
    expect(m).toContain("'flashforward'")
    expect(m).toContain("'linear'")
    // "não sei" não é marcação humana — é a ausência dela.
    expect(m).not.toContain("'indeterminado'")
  })

  it("opening_structure é GERADA a partir de override + auto", () => {
    expect(sql).toMatch(/generated always as \(coalesce\(opening_structure_override, opening_structure_auto\)\) stored/)
  })
})

describe("recalc — a abertura não move nota nenhuma", () => {
  it("não está nas entradas do recalc, então a action não pode marcar o badge", async () => {
    const { CATALOG_RECALC_INPUTS } = await import("@/lib/calculations/recalc-inputs")
    expect([...CATALOG_RECALC_INPUTS]).not.toContain("opening_structure")

    // E o inventário do call site: a action grava em `works` e não pode marcar o badge —
    // isso acenderia "Recalcular notas" por uma coluna que o `recalculateAll` nem lê.
    //
    // ⚠️ O padrão exige a INVOCAÇÃO (`markRecalcPending(`), não a menção: a própria action
    // cita o nome num comentário explicando por que não chama. Um `not.toMatch(/markRecalcPending/)`
    // cru reprova o arquivo por causa da documentação — e a correção óbvia seria apagar o
    // comentário, que é justamente o que preserva o porquê.
    const action = readFileSync(resolve(process.cwd(), "server/actions/opening-structure.ts"), "utf8")
    const semComentarios = action
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
    expect(semComentarios).not.toMatch(/markRecalcPending\s*\(/)
  })
})
