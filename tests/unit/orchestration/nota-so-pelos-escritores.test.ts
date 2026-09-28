import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

/**
 * A captura da previsão PRÉ-nota mora nos dois escritores de `user_work_state`
 * (`writeReadingState` e `mirrorOwnerState` → lib/server/predictions/label-transition.ts). Ela
 * só cobre "qualquer caminho de 1ª nota" enquanto NENHUM outro código de app escrever nessa
 * tabela por fora — um `.from("user_work_state").upsert(...)` novo num action qualquer gravaria
 * nota sem ledger, sem descarte e sem erro nenhum.
 *
 * Deriva os arquivos do git (lista fixa não acha o arquivo de amanhã) e procura a FORMA da
 * escrita, não um nome de função.
 */

const DONO = "server/queries/user-work-state.ts"

function arquivosDoApp(): string[] {
  return execSync("git ls-files server lib app components", { encoding: "utf8" })
    .split("\n")
    // o índice ainda lista arquivo apagado no disco (sem commit) — ler o que não existe dá ENOENT
    .filter((f) => /\.(ts|tsx)$/.test(f) && existsSync(f))
}

/** Cadeias `.from("user_work_state")…` que chamam um método de ESCRITA antes do próximo `;`/`.from(`. */
export function escritasDiretas(fonte: string): string[] {
  const achados: string[] = []
  const re = /\.from\(\s*["'`]user_work_state["'`]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(fonte))) {
    const resto = fonte.slice(m.index + m[0].length)
    const fim = resto.search(/;|\.from\(/)
    const cadeia = fim >= 0 ? resto.slice(0, fim) : resto
    if (/\.(upsert|insert|update|delete)\s*\(/.test(cadeia)) achados.push(m[0] + cadeia.slice(0, 80))
  }
  return achados
}

describe("a nota só é escrita pelos dois escritores", () => {
  it("nenhum arquivo de app escreve em user_work_state fora de user-work-state.ts", () => {
    const violacoes: string[] = []
    for (const f of arquivosDoApp()) {
      if (f === DONO) continue
      for (const a of escritasDiretas(readFileSync(f, "utf8"))) violacoes.push(`${f}: ${a.replace(/\s+/g, " ")}`)
    }
    expect(violacoes, "escrita direta em user_work_state pula a captura da previsão pré-nota").toEqual([])
  })

  it("o dono é o único com as escritas — e ele tem as duas (senão o teste acima não vê nada)", () => {
    expect(escritasDiretas(readFileSync(DONO, "utf8")).length).toBeGreaterThanOrEqual(2)
  })

  it("o detector reconhece as formas de escrita (senão ele passaria verde por não enxergar)", () => {
    expect(escritasDiretas(`sb.from("user_work_state").upsert(rows)`)).toHaveLength(1)
    expect(escritasDiretas(`sb\n  .from("user_work_state")\n  .update({ user_score: 1 })\n  .eq("id", x)`)).toHaveLength(1)
    expect(escritasDiretas(`sb.from("user_work_state").select("user_score").eq("a", 1); sb.from("x").upsert(r)`)).toHaveLength(0)
  })

  it("não sobra captura de 1ª nota espalhada pelos actions (um critério só)", () => {
    const fora: string[] = []
    for (const f of arquivosDoApp()) {
      if (f.startsWith("lib/server/predictions/")) continue
      const src = readFileSync(f, "utf8")
      if (/capturePredictionForFirstRating|markPredictionLabelChanged\(|discardPredictionsForWork\(|resolvePredictionsForWork\(/.test(src)) fora.push(f)
    }
    expect(fora, "a transição da nota é decidida em label-transition.ts — não em cada action").toEqual([])
  })
})
