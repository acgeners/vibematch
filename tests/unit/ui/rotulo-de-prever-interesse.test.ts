import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { interestPredictLabel } from "@/lib/ui/interest-predict-label"

/**
 * O botão que dispara a previsão de Interesse aparece em DUAS telas (página da obra e
 * fila `/my-ai-scores?tab=sinopse`) e chamava a mesma ação de dois jeitos:
 * "Prever de novo" numa, "Reprever" na outra. Ninguém decidiu isso — cada tela nomeou
 * o botão quando foi construída, e nada as obrigava a concordar.
 *
 * São dois testes de naturezas diferentes, e os dois são necessários:
 *  - a TABELA, que fixa qual estado produz qual palavra;
 *  - a VARREDURA, que é o que impede a terceira cópia. Sem ela, nada obriga uma tela
 *    nova (ou uma "melhoria" numa das duas) a passar pelo dono único.
 *
 * ⚠️ **A varredura lê o source SEM os comentários.** A 1ª versão reprovou acusando a
 * própria explicação da mudança — o comentário que dizia "foi o que aconteceu com
 * 'Reprever'" casava com o padrão. Mesma pegadinha já registrada no CLAUDE.md sobre
 * `abas-da-obra.test.ts`: comentário CITA o histórico, e citar não é reimplementar.
 */

const REPO = join(import.meta.dirname, "../../..")

/** Todo `.tsx` sob `components/` — derivado do filesystem, nunca de lista fixa: tela
 *  nova é justamente o caso que uma lista escrita à mão não acha. */
function componentesTsx(dir = join(REPO, "components")): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...componentesTsx(p))
    else if (e.name.endsWith(".tsx")) out.push(p)
  }
  return out
}

function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // bloco, inclusive o `{/* … */}` do JSX
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1") // linha, sem morder o `//` de uma URL
}

const ROTULOS_LITERAIS = ["Reprever", "Prever de novo", "Atualizar previsão"]

describe("rótulo do botão de prever Interesse", () => {
  it("o estado decide a palavra — nunca 'já rodou antes'", () => {
    // 🔴 "Atualizar previsão" promete trocar algo velho por algo novo. Dizer isso sobre
    // previsão FRESCA é oferecer conserto pro que não está quebrado — e a chamada é paga.
    expect(interestPredictLabel({ hasPrediction: false, stale: false })).toBe("Prever interesse")
    expect(interestPredictLabel({ hasPrediction: true, stale: false })).toBe("Prever de novo")
    expect(interestPredictLabel({ hasPrediction: true, stale: true })).toBe("Atualizar previsão")
  })

  it("sem previsão, 'stale' não muda nada (não há o que atualizar)", () => {
    expect(interestPredictLabel({ hasPrediction: false, stale: true })).toBe("Prever interesse")
  })

  it("nenhuma tela escreve o rótulo à mão — todas passam pelo dono único", () => {
    // 🔴 Esta é a metade que pega a PRÓXIMA divergência: uma tela que volte a digitar
    // "Reprever" reprova mesmo importando o dono para outra coisa. Foi ela que achou a
    // INSTRUÇÃO velha do `shadow-compare-panel` ("Clique 'Reprever'"), que mandava o
    // usuário procurar um botão que já não existia com aquele nome.
    const infratores = componentesTsx()
      .map((f) => [f.slice(REPO.length + 1), semComentarios(readFileSync(f, "utf8"))] as const)
      .filter(([, src]) => ROTULOS_LITERAIS.some((r) => src.includes(r)))
      .map(([rel]) => rel)

    expect(infratores, `rótulo escrito à mão fora do dono único:\n${infratores.join("\n")}`).toEqual([])
  })

  it("as duas telas conhecidas consomem o dono", () => {
    const consumidores = componentesTsx()
      .filter((f) => readFileSync(f, "utf8").includes("interestPredictLabel"))
      .map((f) => f.slice(REPO.length + 1))

    expect(consumidores).toContain("components/titles/synopsis-quality-suggestion.tsx")
    expect(consumidores).toContain("components/titles/predict-synopsis-row-actions.tsx")
  })

  it("a fila pede o trilho LARGO — o rótulo novo não cabe no padrão", () => {
    // 🔴 Medido no browser em 2026-08-15: com `w-28` (112px) o botão pede 128px de
    // conteúdo — o ✨ saía PRA FORA da pílula e o "ã" vazava pela borda. jsdom não
    // calcula layout, então o que dá pra guardar é a DECISÃO (`wideActions` = w-36).
    // Sem esta linha, encurtar o rótulo "pra caber" volta a ser a saída fácil — e é
    // ela que reabre a divergência de vocabulário.
    const src = readFileSync(join(REPO, "components/titles/synopsis-predict-panel.tsx"), "utf8")
    expect(semComentarios(src)).toMatch(/wideActions/)
  })

  it("a fila passa o ESTADO, não o proxy 'hasPrediction'", () => {
    // 🔴 O painel só lista obra "sem previsão OU desatualizada", então lá dentro os dois
    // coincidem HOJE. Derivar o rótulo disso é depender do filtro daquela página:
    // afrouxá-lo faria o botão prometer "atualizar" sobre previsão fresca, em silêncio.
    const src = readFileSync(join(REPO, "components/titles/synopsis-predict-panel.tsx"), "utf8")
    expect(src).toMatch(/stale=\{isStale\}/)
  })
})
