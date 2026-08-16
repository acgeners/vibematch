import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * A trilha "O que o modelo previu, ao lado do que você deu" (`/account/taste-profile`, aba "A prova")
 * é uma COMPARAÇÃO: o card inteiro pareia a Nota Prevista com a nota que a pessoa deu. Obra
 * lida SEM nota não tem o segundo lado — renderizaria só a capa e o título, um buraco no
 * meio da prova.
 *
 * 🔴 O subtítulo sempre disse "entre as N que você leu e avaliou". O filtro dizia só "leu".
 * Em 2026-08-13 era 1 obra de 107, então o defeito era LATENTE: bastava ela subir no top-6
 * por Nota Prevista pra aparecer. Contradição entre o que a tela afirma e o que a query faz
 * é a família de defeito mais cara deste projeto — ela não quebra nada, só mente.
 *
 * ⚠️ Teste de SOURCE, e não de render: o componente recebe `aligned.read` pronto. Um teste de
 * componente passaria verde com o filtro errado, porque ele renderiza o que a fixture manda —
 * era exatamente o que a 1ª versão deste teste fazia.
 */
const FILE = "server/queries/recommendations.ts"

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

/** O corpo do `getAlignedWorkSplit`, sem comentários. */
function corpoDaFuncao(): string {
  const src = stripComments(readFileSync(join(process.cwd(), FILE), "utf8"))
  const inicio = src.indexOf("export async function getAlignedWorkSplit")
  expect(inicio, `${FILE} não tem mais getAlignedWorkSplit`).toBeGreaterThan(-1)
  const fim = src.indexOf("\nexport ", inicio + 1)
  return src.slice(inicio, fim === -1 ? undefined : fim)
}

describe("arquitetura: a trilha de confirmação exige nota", () => {
  it("🔴 a trilha exibida sai de `ratedRead`, nunca de `read`", () => {
    const corpo = corpoDaFuncao()
    expect(corpo).toMatch(/read:\s*\[\.\.\.ratedRead\]/)
    expect(corpo).not.toMatch(/read:\s*\[\.\.\.read\]/)
  })

  it("`readTotal` conta as AVALIADAS — é o número impresso no subtítulo", () => {
    const corpo = corpoDaFuncao()
    expect(corpo).toMatch(/readTotal:\s*ratedRead\.length/)
    expect(corpo).not.toMatch(/readTotal:\s*read\.length/)
  })

  it("🔴 `otherTotal` desconta `ratedRead`, senão a lida-sem-nota some das TRÊS contas", () => {
    // readTotal + unreadTotal + otherTotal tem que fechar com a biblioteca. Descontando
    // `read` (que inclui as sem nota) enquanto a trilha conta `ratedRead`, essas obras
    // desapareceriam de todos os números da tela — sumiço silencioso.
    const corpo = corpoDaFuncao()
    expect(corpo).toMatch(/otherTotal:\s*works\.length\s*-\s*ratedRead\.length\s*-\s*unread\.length/)
  })

  it("`ratedRead` continua definido por `userScore != null`", () => {
    const corpo = corpoDaFuncao()
    expect(corpo).toMatch(/const ratedRead = read\.filter\(\(w\) => w\.userScore != null\)/)
  })

  it("a tela nomeia o caso novo — 'lidas sem nota' no rodapé do outro total", () => {
    // Sem essa palavra o rodapé descreveria só "em andamento ou pausadas", e a obra lida
    // sem nota entraria numa conta que a frase não cobre.
    const painel = readFileSync(
      join(process.cwd(), "components/conta/taste-profile-panel.tsx"),
      "utf8",
    )
    expect(stripComments(painel)).toContain("lidas sem nota")
  })
})
