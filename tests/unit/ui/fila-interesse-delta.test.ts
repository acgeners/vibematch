import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { deltaChip } from "@/components/titles/synopsis-predict-panel"

/**
 * Na fila de Interesse (`/fila-recomendacao?tab=sinopse`), a comparação entre a
 * previsão da IA e o ♥ manual era desenhada DUAS vezes no mesmo card, a partir do
 * mesmo predicado (`delta !== 0` ⟺ `diverges`):
 *
 *  - chip de estado "Diverge" (laranja) / "Bate" (verde);
 *  - chip `Δ +1` / `Δ 0`, com as MESMAS duas cores, hand-rolladas à parte.
 *
 * Medido nas 815 obras com previsão ativa (clone local, 2026-08-15): o chip de estado
 * aparecia em 45 (5,5%) e, nessas 45, o `Δ` logo abaixo já dizia o mesmo. Pior, o chip
 * tinha PRECEDÊNCIA abaixo de "Desatualizado", então sumia justamente nas 676 obras
 * stale que têm os dois valores pra comparar. Ficou o `Δ`.
 */

const REPO = join(import.meta.dirname, "../../..")
const PANEL = join(REPO, "components/titles/synopsis-predict-panel.tsx")

function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

describe("fila de Interesse: o Δ é o único que compara", () => {
  it("cor e texto saem da MESMA chamada", () => {
    // 🔴 Um `if` de cor escrito à parte no JSX é como o chip fica laranja e a frase
    // fala de concordância — a família "dois critérios pro mesmo fato", que é o que a
    // remoção do chip veio fechar. Por isso `deltaChip` devolve o par.
    expect(deltaChip(0).className).toMatch(/emerald/)
    expect(deltaChip(0).texto).toMatch(/mesmo nível/i)

    for (const d of [1, 2, 3]) {
      expect(deltaChip(d).className).toMatch(/orange/)
      expect(deltaChip(-d).className).toMatch(/orange/)
    }
  })

  it("o texto diz DE QUEM é o nível mais alto — '+1' sozinho não diz", () => {
    expect(deltaChip(1).texto).toMatch(/1 nível acima/)
    expect(deltaChip(-1).texto).toMatch(/1 nível abaixo/)
    expect(deltaChip(2).texto).toMatch(/2 níveis acima/)
    expect(deltaChip(-3).texto).toMatch(/3 níveis abaixo/)
  })

  it("nenhum Δ fica sem explicação — é jargão e o chip que o traduzia saiu", () => {
    const src = semComentarios(readFileSync(PANEL, "utf8"))
    // O `Δ` só é desenhado dentro de um span que carrega `title` E `aria-label`.
    const trecho = src.slice(src.indexOf("Δ ") - 400, src.indexOf("Δ ") + 60)
    expect(trecho).toMatch(/title=\{dc\.texto\}/)
    expect(trecho).toMatch(/aria-label=\{dc\.texto\}/)
  })

  it("o chip de ESTADO não voltou a comparar previsão com manual", () => {
    // 🔴 A âncora é a palavra na tela, não o nome da variável: reintroduzir isto como
    // `{ label: "Diverge", tone: "orange" }` sob outro identificador passa por um teste
    // que procurasse `diverges`, e devolve o par que discorda em silêncio.
    const src = semComentarios(readFileSync(PANEL, "utf8"))
    expect(src).not.toMatch(/"Diverge"/)
    expect(src).not.toMatch(/"Bate"/)
  })

  it("o chip de estado guarda só ESTADO do sistema", () => {
    const src = semComentarios(readFileSync(PANEL, "utf8"))
    // Os dois que sobraram são estado de verdade: um envelheceu, o outro nunca rodou.
    expect(src).toMatch(/label: "Desatualizado"/)
    expect(src).toMatch(/label: "Não previsto"/)
  })
})
