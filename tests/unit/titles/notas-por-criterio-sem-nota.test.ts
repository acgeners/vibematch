import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * O card "Notas por critério" só existe quando a obra TEM nota (2026-08-20).
 *
 * 🔴 Sem nota nenhuma o bloco não era feio, era MENTIROSO: a grade compacta desenha as 9
 * linhas com "–" e a barra de faixa vazia, e o painel abre no primeiro critério com só o
 * ícone e o nome. A tela afirmava que a obra foi analisada e não pontuou, quando o que
 * houve é que ninguém avaliou — e é o estado por onde TODA obra nova passa. Medido na
 * nuvem em 20/08/2026: 3 obras ativas sem nota (as três `skipped`).
 *
 * Teste de ARQUITETURA porque a página é um server component async de ~2.000 linhas que
 * não renderiza em jsdom. O que regride não é comportamento, é a GUARDA sumir num
 * refactor — e sem ela nada quebra: o card volta a desenhar nove traços, sem erro.
 *
 * ⚠️ Ele casa o FATO ("a guarda deriva de `scoreMap`"), nunca o NOME da variável: renomear
 * a const é mudança inocente e não pode pintar a suíte de vermelho. O que reprova é a
 * guarda sumir, ou passar a derivar da existência de uma AVALIAÇÃO — nota também vem de
 * import e de edição manual, e um card que sumisse por falta de `ai_evaluations`
 * esconderia número que a obra tem.
 */

const RAW = readFileSync(resolve(__dirname, "../../../app/catalog/[id]/page.tsx"), "utf8")
/** Sem comentários: eles citam "Notas por critério" ao explicar a mudança, e a 1ª versão
 *  do teste vizinho (`abas-da-obra`) reprovou acusando a própria explicação. */
const SOURCE = RAW.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "")

/** O `<Card>` que abre imediatamente antes do `<CardTitle>` dado. */
function cardDoTitulo(titulo: string): { abertura: number; guarda: string } {
  const t = SOURCE.indexOf(`>${titulo}<`)
  expect(t, `não achei o CardTitle "${titulo}"`).toBeGreaterThan(-1)
  const abertura = SOURCE.lastIndexOf("<Card>", t)
  expect(abertura, `"${titulo}" não está dentro de um <Card>`).toBeGreaterThan(-1)
  // O que vem ANTES da abertura do card, já sem comentários: é ali que a guarda mora.
  return { abertura, guarda: SOURCE.slice(Math.max(0, abertura - 200), abertura).trimEnd() }
}

describe("card de Notas por critério", () => {
  it("é renderizado sob uma guarda, e não incondicionalmente", () => {
    const { guarda } = cardDoTitulo("Notas por critério")
    expect(
      /\{\s*[A-Za-z_$][\w$]*\s*&&\s*\(\s*$/.test(guarda),
      `o <Card> abre sem guarda — sem nota, ele desenha 9 critérios "–". Trecho: ${JSON.stringify(guarda.slice(-90))}`,
    ).toBe(true)
  })

  it("a guarda DERIVA de scoreMap — não do nome da variável, não da avaliação", () => {
    const { guarda } = cardDoTitulo("Notas por critério")
    const nome = guarda.match(/\{\s*([A-Za-z_$][\w$]*)\s*&&\s*\(\s*$/)?.[1]
    expect(nome, "guarda sem identificador").toBeTruthy()

    const decl = SOURCE.match(new RegExp(`const\\s+${nome}\\s*=\\s*([^\\n]+)`))
    expect(decl, `\`${nome}\` não é declarada nesta página`).toBeTruthy()
    const expr = decl![1]

    // O FATO: a decisão vem das notas persistidas.
    expect(expr, `a guarda não deriva de scoreMap: ${expr}`).toContain("scoreMap")
    // 🔴 E NÃO da avaliação: obra com nota importada ou editada à mão não tem
    // `ai_evaluations` e mesmo assim tem o que mostrar.
    expect(/latestAiEval|ai_evaluations|aiEvalProvenance/.test(expr)).toBe(false)
  })

  it("a mesma régua alimenta o botão de avaliar — uma fonte só", () => {
    // Duas cópias de "tem nota?" divergiriam no primeiro critério novo, e a página passaria
    // a esconder o card enquanto o botão continuasse achando que há notas (ou o inverso).
    const nome = cardDoTitulo("Notas por critério").guarda.match(
      /\{\s*([A-Za-z_$][\w$]*)\s*&&\s*\(\s*$/,
    )?.[1]
    expect(SOURCE).toMatch(new RegExp(`hasCriteriaScores=\\{\\s*${nome}\\s*\\}`))
  })
})
