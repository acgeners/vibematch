import { describe, it, expect, vi, beforeEach } from "vitest"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * O recálculo de uma pessoa lê o catálogo inteiro. Antes deste agendador, dez notas rápidas nas
 * boas-vindas abriam dez recálculos completos ao mesmo tempo, um por `after()`. Aqui: uma execução
 * por vez por pessoa, e o que chega durante ela vira UMA execução a mais no fim.
 */

vi.mock("server-only", () => ({}))

const chamadas: string[] = []
let liberar: Array<() => void> = []
let falharProxima = false

vi.mock("@/server/recalc/user-recalc", () => ({
  recalculateForUser: (id: string) => {
    chamadas.push(id)
    if (falharProxima) {
      falharProxima = false
      return Promise.reject(new Error("recalc caiu"))
    }
    return new Promise<void>((ok) => liberar.push(ok))
  },
}))

const { scheduleUserRecalc } = await import("@/server/recalc/user-recalc-schedule")

/** Solta a execução em curso e deixa a fila de microtarefas andar. */
async function terminarUma() {
  const ok = liberar.shift()
  ok?.()
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  chamadas.length = 0
  liberar = []
  falharProxima = false
})

describe("recálculo por pessoa, agrupado", () => {
  it("uma rajada de pedidos vira no máximo duas execuções", async () => {
    const promessas = Array.from({ length: 10 }, () => scheduleUserRecalc("leitora", "teste"))
    expect(chamadas, "a primeira começa na hora").toEqual(["leitora"])
    await terminarUma()
    expect(chamadas, "os nove pedidos do meio viram UMA repetição").toEqual(["leitora", "leitora"])
    await terminarUma()
    await Promise.all(promessas)
    expect(chamadas).toHaveLength(2)
  })

  it("sem pedido durante a execução, não repete", async () => {
    const p = scheduleUserRecalc("leitora", "teste")
    await terminarUma()
    await p
    expect(chamadas).toEqual(["leitora"])
  })

  it("pessoas diferentes não esperam umas pelas outras", () => {
    void scheduleUserRecalc("a", "teste")
    void scheduleUserRecalc("b", "teste")
    expect(chamadas).toEqual(["a", "b"])
  })

  it("falha só loga, e o próximo pedido roda normalmente", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {})
    falharProxima = true
    await scheduleUserRecalc("c", "teste")
    expect(erro).toHaveBeenCalled()
    const p = scheduleUserRecalc("c", "teste")
    expect(chamadas).toEqual(["c", "c"])
    await terminarUma()
    await p
    erro.mockRestore()
  })
})

describe("ninguém chama o recálculo por pessoa sem passar pelo agendador", () => {
  it("só o agendador importa `recalculateForUser` no código do app", () => {
    const raiz = join(__dirname, "../../..")
    const arquivos = execSync("git ls-files -co --exclude-standard -- app server lib components", {
      cwd: raiz,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f))
    const quem = arquivos.filter((f) => {
      if (f === "server/recalc/user-recalc.ts" || f === "server/recalc/user-recalc-schedule.ts") return false
      const src = readFileSync(join(raiz, f), "utf8")
      return /import\s*\{[^}]*\brecalculateForUser\b[^}]*\}\s*from/.test(src)
    })
    expect(quem, "use `scheduleUserRecalc` (server/recalc/user-recalc-schedule.ts)").toEqual([])
  })
})
