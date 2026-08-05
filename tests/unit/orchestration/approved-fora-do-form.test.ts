import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Teste de ARQUITETURA: `works.approved` não pode virar campo de formulário.
 *
 * Toda função exportada de um `"use server"` é endpoint HTTP público — chamável por POST, com ou
 * sem botão na tela. O `workFormSchema` é o que `persistNewWork`/`updateWork` aceitam do cliente:
 * no dia em que alguém puser `approved` ali "por conveniência", qualquer leitor aprova a própria
 * obra mandando `approved: true` no payload. Zero erro, zero log.
 *
 * É a MESMA classe do buraco que `createWork` já trata explicitamente com as 9 notas de atributo
 * (works.ts: "um Leitor free postaria as notas que quisesse direto no CATÁLOGO"). Esse foi
 * descoberto depois de existir; este fica preso antes.
 *
 * O único caminho de escrita legítimo é `setWorkApproval`, que é `ensureAdmin`.
 */

const raiz = resolve(__dirname, "../../..")
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8")

describe("works.approved fora do alcance do cliente", () => {
  it("não aparece no schema do formulário", () => {
    const schema = ler("lib/validations/work.schema.ts")
    expect(
      /\bapproved\b/.test(schema),
      "`approved` no workFormSchema torna a coluna gravável por POST de qualquer usuário — " +
        "use `setWorkApproval` (ensureAdmin) em vez de passar pelo form",
    ).toBe(false)
  })

  it("só `setWorkApproval` escreve a coluna, e ela é ensureAdmin", () => {
    const works = ler("server/actions/works.ts")

    // Todo trecho que grava `approved:` nos updates/inserts deste arquivo.
    const escritas = works.match(/approved:\s*[^,\n]+/g) ?? []
    expect(escritas.length, "esperava as escritas dos 3 inserts + as 2 de setWorkApproval").toBeGreaterThan(0)

    // A action de decisão existe e está atrás do gate do curador.
    const bloco = works.slice(works.indexOf("export async function setWorkApproval"))
    const corpo = bloco.slice(0, bloco.indexOf("\n}\n"))
    expect(corpo).toContain("ensureAdmin()")
  })

  it("os DOIS caminhos de insert em works decidem por PAPEL", () => {
    // O import não passa por `createWork` — monta a linha na mão. Foi por isso que ele quase
    // marcou como não-aprovada toda obra importada, inclusive as do próprio curador.
    const importacao = ler("server/actions/external-list-import.ts")
    expect(importacao).toContain('ensurePermission("curate_ai")')
    expect(importacao).toContain("approved: approvedByRole")

    const works = ler("server/actions/works.ts")
    expect(works).toContain("approved: opts.approvedByRole")
  })
})
