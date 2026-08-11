import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { zContraPiso } from "@/scripts/consistency-panel"

/**
 * O painel de consistência ganhou uma seção 5 que julga um PILOTO (antes × depois nas mesmas
 * obras). A pergunta que ela responde — "isso é movimento ou é ruído?" — depende inteiramente
 * de como se compara com o piso, e a 1ª versão comparava com um MÚLTIPLO do piso escolhido
 * por mim (`flipPct > piso * 2`).
 *
 * Dois defeitos, e o 2º só apareceu porque o 1º foi usado de verdade:
 *   1. o "2" não vinha de medição nenhuma;
 *   2. porcentagem não tem noção de tamanho de amostra — e no primeiro uso real deu um falso
 *      negativo de beira de faca (24,4% contra piso 12,2%, reprovado por um `>` estrito).
 */
describe("piso de troca de FAIXA — z, nunca múltiplo do piso", () => {
  it("o caso que quebrou: 57/234 com piso 12,2% é sinal, não empate", () => {
    // O múltiplo dizia "dentro do ruído" porque 24,4 não é > 24,4. O z não tem beira de faca.
    expect(zContraPiso(57, 234, 12.2)).toBeGreaterThan(5)
  })

  it("mesma PORCENTAGEM, evidências opostas — é o que o múltiplo não enxerga", () => {
    // 25% em 12 notas é 1,3σ (não decide nada); 25% em 240 é 5,9σ.
    const pequeno = zContraPiso(3, 12, 12.2)
    const grande = zContraPiso(60, 240, 12.2)
    expect(pequeno).toBeLessThan(2)
    expect(grande).toBeGreaterThan(2)
    // A prova de que a régua antiga era cega: as duas amostras dão o mesmo múltiplo.
    expect((100 * 3) / 12).toBeCloseTo((100 * 60) / 240, 6)
  })

  it("ruído puro fica em z≈0, e movimento PRA BAIXO do piso dá z negativo", () => {
    expect(Math.abs(zContraPiso(29, 234, 12.2))).toBeLessThan(1)
    expect(zContraPiso(5, 234, 12.2)).toBeLessThan(-2)
  })

  it("piso 0 ou amostra vazia não estoura (devolve 0, não NaN/Infinity)", () => {
    expect(zContraPiso(0, 0, 12.2)).toBe(0)
    expect(zContraPiso(3, 100, 0)).toBe(0)
    expect(Number.isFinite(zContraPiso(3, 100, 100))).toBe(true)
  })
})

/**
 * 🔴 As duas invariantes do desenho que um teste de números não alcança. Elas são a razão de a
 * seção 5 existir, e violá-las não quebra nada — só devolve conclusão plausível e errada.
 */
describe("seção 5 — invariantes de desenho", () => {
  const fonte = fs.readFileSync(
    path.join(process.cwd(), "scripts/consistency-panel.ts"),
    "utf8",
  )
  /**
   * ⚠️ Só o CÓDIGO. A 1ª versão desta suíte varria o arquivo inteiro e reprovou por causa do
   * comentário que descreve o bug ("eu comparava `flipPct > piso * 2`") — um teste que proíbe
   * documentar o erro que ele guarda. Mesma família do teste que lia
   * `AiProvenanceSeal.toString()` e não enxergava quem desenhava o corpo.
   */
  const codigo = fonte
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n")

  it("o piso da seção 5 sai de troca de FAIXA, não da amplitude de 0,289", () => {
    // Amplitude é por NOTA e não se converte em faixa: 0,3 pt não cruza no meio da faixa e
    // cruza na borda. Usar uma pela outra é a mesma troca de régua que reprovou a v23–v25.
    expect(codigo).toMatch(/pisoFlipPct/)
    expect(codigo).toMatch(/new Set\(v\.map\(bandForScore\)\)/)
  })

  it("não sobrou comparação por múltiplo do piso no CÓDIGO", () => {
    expect(codigo).not.toMatch(/piso\w*\s*\*\s*\d/)
    // …e o veredito é lido em z, não em porcentagem crua.
    expect(codigo).toMatch(/Math\.abs\(z\)\s*>=\s*2/)
  })

  it("o entrypoint é guardado E o cliente é preguiçoso", () => {
    // As duas juntas, porque uma sem a outra não protege: com o cliente criado no escopo do
    // módulo, o `import` explodia em `validateSupabaseUrl` antes de qualquer `main()`.
    expect(codigo).toMatch(/process\.argv\[1\][\s\S]{0,80}consistency-panel\.ts/)
    expect(codigo).not.toMatch(/^const sb = createClient/m)
  })
})
