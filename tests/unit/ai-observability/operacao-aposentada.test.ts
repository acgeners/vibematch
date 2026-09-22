import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { AI_OPERATION_KEYS, AI_OPERATIONS } from "@/lib/ai-observability/types"

/**
 * `AI_OPERATIONS` responde "qual é a CONFIGURAÇÃO ATUAL desta operação" — nunca "o que já
 * rodou aqui". O campo estava fazendo as duas coisas ao mesmo tempo, e nada no tipo as
 * distinguia: 14 operações traziam `defaultModel: SONNET_MODEL` (configuração viva) e as
 * duas `calibration_*` traziam um literal declarado, em comentário, como registro
 * histórico. A tela renderizava as duas semânticas com a MESMA frase ("Modelo padrão X").
 *
 * 🔴 O literal de `calibration_audit` era falso: medido no banco, as 28 linhas dela em
 * `ai_api_calls` são 100% `claude-sonnet-5`. As execuções em 4.6 (12 runs, 05–06/2026) são
 * anteriores ao início do log e só existem em `calibration_runs`.
 *
 * 🔴 A raiz não foi o modelo — foi a ORFANDADE passar despercebida. Os executores saíram em
 * 16/08/2026 e as duas chaves ficaram declarando configuração de algo que não existe mais;
 * seis dias depois alguém escreveu um comentário defendendo o literal. Este guard dispara no
 * dia em que uma operação perde o executor, que é quando ainda é barato.
 */

// Diretórios de PRODUÇÃO. `tests/` fica fora por construção — é onde moram as fixtures que
// citam `operation: "calibration_audit"` sem executar nada.
const DIRS = ["lib", "server", "app", "components", "scripts"]
const EXT = /\.(ts|tsx|js|mjs|cjs)$/

function arquivos(dir: string, out: string[] = []): string[] {
  let entradas: string[]
  try {
    entradas = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entradas) {
    if (e === "node_modules" || e.startsWith(".")) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) arquivos(p, out)
    else if (EXT.test(e)) out.push(p)
  }
  return out
}

/** Comentários fora — uma MENÇÃO a `operation: "x"` em prosa não é um call site. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

/**
 * O mecanismo REAL de registro: toda linha de `ai_api_calls` nasce de
 * `createLoggedMessage(..., { operation: "<key>" })` ou `logAiCall(..., { operation: "<key>" })`.
 * Procurar a propriedade `operation` com literal é procurar exatamente esse mecanismo — não
 * a string solta em qualquer lugar do repositório.
 */
function callSitesPorOperacao(): Map<string, string[]> {
  const mapa = new Map<string, string[]>()
  for (const d of DIRS) {
    for (const f of arquivos(join(process.cwd(), d))) {
      const codigo = semComentarios(readFileSync(f, "utf8"))
      for (const m of codigo.matchAll(/\boperation:\s*"([a-z_]+)"/g)) {
        const rel = f.slice(process.cwd().length + 1)
        const lista = mapa.get(m[1]) ?? []
        if (!lista.includes(rel)) lista.push(rel)
        mapa.set(m[1], lista)
      }
    }
  }
  return mapa
}

const CALL_SITES = callSitesPorOperacao()
const ATIVAS = AI_OPERATION_KEYS.filter((k) => AI_OPERATIONS[k].status === "active")
const APOSENTADAS = AI_OPERATION_KEYS.filter((k) => AI_OPERATIONS[k].status === "retired")

describe("AI_OPERATIONS: configuração viva × registro histórico", () => {
  it(`toda operação ATIVA tem call site de logging (hoje ${ATIVAS.length})`, () => {
    const orfas = ATIVAS.filter((k) => (CALL_SITES.get(k) ?? []).length === 0)
    expect(
      orfas,
      `sem executor no código: ${orfas.join(", ")} — se saiu de vez, marque status: "retired"`,
    ).toEqual([])
  })

  it(`toda operação sem call site está marcada APOSENTADA (hoje ${APOSENTADAS.length})`, () => {
    // O outro lado: chave que perdeu o executor não pode seguir declarando configuração.
    const semExecutor = AI_OPERATION_KEYS.filter((k) => (CALL_SITES.get(k) ?? []).length === 0)
    expect(semExecutor.slice().sort()).toEqual(APOSENTADAS.slice().sort())
  })

  it("ATIVA declara defaultModel; APOSENTADA não declara nenhum", () => {
    for (const k of ATIVAS) {
      const def = AI_OPERATIONS[k]
      expect(def.status === "active" && def.defaultModel, `${k} é ativa e não declara modelo`)
        .toBeTruthy()
    }
    for (const k of APOSENTADAS) {
      // 🔴 O `tsc` já recusa `defaultModel` numa entrada `retired` (`?: never`). Isto pega o
      // caso que o tipo não vê: um objeto montado/espalhado em runtime.
      expect(
        Object.prototype.hasOwnProperty.call(AI_OPERATIONS[k], "defaultModel"),
        `${k} é aposentada e ainda declara defaultModel — histórico mora no dado`,
      ).toBe(false)
    }
  })

  it("nenhuma aposentada carrega modelo em campo NENHUM", () => {
    // Impede o literal migrar de casa (`defaultModel` → `modelHistorico`) e voltar a
    // misturar configuração com passado.
    for (const k of APOSENTADAS) {
      const serializado = JSON.stringify(AI_OPERATIONS[k])
      expect(serializado, `${k} ainda cita um modelo`).not.toMatch(/claude-[a-z0-9-]+/)
    }
  })

  it("as duas calibration_* são as aposentadas de hoje", () => {
    expect(APOSENTADAS.slice().sort()).toEqual(["calibration_audit", "calibration_bias"])
  })
})
