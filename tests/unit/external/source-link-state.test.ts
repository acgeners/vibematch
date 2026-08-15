import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifySourceLink } from "@/lib/external/source-link-state"

/**
 * `work_external_ids` tem TRÊS estados (migration 038) e DOIS lugares os leem: a fila da
 * aba "Fontes" (`getSourceGapQueue`, as 9 fontes) e o card de cobertura do Comix em
 * /settings (`getComixCoverageLists`, só a Comix). Eram duas cópias do mesmo `if`.
 *
 * 🔴 O modo de falha não é o `if` estar errado — é ele DIVERGIR. As duas telas falam da
 * mesma linha do banco: uma diria "pendente" e a outra "resolvida" sobre a mesma obra,
 * sem erro, sem log e com as duas parecendo certas isoladamente.
 */
describe("classifySourceLink", () => {
  it("id preenchido e não rejeitado é vínculo ativo", () => {
    expect(classifySourceLink({ external_id: "003kd", is_rejected: false })).toBe("linked")
  })

  it("rejeitado SEM id é a obra declarada ausente da fonte — decisão, não pendência", () => {
    expect(classifySourceLink({ external_id: null, is_rejected: true })).toBe("absent")
  })

  it("sem id e sem rejeição é lacuna (a forma que a ausência de linha produz)", () => {
    expect(classifySourceLink({ external_id: null, is_rejected: false })).toBe("gap")
  })

  it("rejeitado COM id volta pra lacuna: descartar um candidato não nega a obra na fonte", () => {
    expect(classifySourceLink({ external_id: "003kd", is_rejected: true })).toBe("gap")
  })

  it("undefined (linha ausente / coluna não selecionada) é lacuna, nunca vínculo", () => {
    expect(classifySourceLink({ external_id: undefined, is_rejected: undefined })).toBe("gap")
  })
})

/**
 * Guarda de arquitetura ESTREITA de propósito: os dois classificadores não podem
 * reescrever a comparação em JS.
 *
 * ⚠️ O que ela NÃO pega, e é honesto dizer: um terceiro consumidor que apareça amanhã, e
 * um `if` reescrito com outra forma sintática. Ela casa o fato "estes dois derivam do
 * dono único" pelo par (importa a função) + (não compara `is_rejected` a literal em JS).
 * Filtro SQL (`.eq("is_rejected", false)`) segue liberado — é outra coisa: pega só o
 * vínculo ativo, não classifica os três estados.
 */
describe("os dois consumidores derivam do dono único", () => {
  const root = join(__dirname, "..", "..", "..")
  const files = ["server/queries/comix-coverage.ts", "lib/external/source-gaps.ts"]

  for (const file of files) {
    it(`${file} chama classifySourceLink e não reescreve a comparação`, () => {
      const src = readFileSync(join(root, file), "utf8")
      // Fora os comentários: eles descrevem a regra e casariam com o padrão proibido.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      expect(code).toContain("classifySourceLink(")
      expect(code).not.toMatch(/is_rejected\s*[=!]==?\s*(true|false)/)
      expect(code).not.toMatch(/!\w+\.is_rejected/)
    })
  }
})
