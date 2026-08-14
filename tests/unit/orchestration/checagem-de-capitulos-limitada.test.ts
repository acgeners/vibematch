import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A checagem de capítulos NÃO pode fazer fan-out irrestrito.
 *
 * Motivo medido (2026-08-12): as fontes passam por um bypass de Cloudflare estreito
 * (sidecar com poucos slots; FlareSolverr serializado por sessão nomeada), enquanto o
 * timeout de 25s do agregador começa a correr no INSTANTE do disparo. Com
 * `Promise.all` sobre a lista inteira, o teto "por fonte" vira orçamento de relógio
 * pro LOTE: 38 obras ⇒ **29 reprovadas**, com o lote fechando em 25,0s exatos.
 *
 * ⚠️ É um erro que PRODUZ RESULTADO — a UI diz "N obras não verificadas", que se lê
 * como fonte externa fora do ar. Nada quebra, nada loga, e o próximo `Promise.all`
 * reintroduz o bug sem ninguém decidir nada. Daí o teste ler o SOURCE.
 */
const RAIZ = join(__dirname, "../../..")
const readingSrc = readFileSync(join(RAIZ, "server/actions/reading.ts"), "utf8")

describe("checagem de capítulos: fan-out limitado", () => {
  it("não itera as obras dentro de um Promise.all", () => {
    // Pega tanto `Promise.all(works.map(` quanto a forma quebrada em linhas.
    const fanOutIrrestrito = /Promise\.all\(\s*works\s*\.?\s*\n?\s*\.?map\(/.test(readingSrc)
    expect(fanOutIrrestrito).toBe(false)
  })

  it("usa o helper com teto e passa um limite", () => {
    expect(readingSrc).toContain("mapWithConcurrency")
    expect(readingSrc).toMatch(/mapWithConcurrency\(\s*\n?\s*works,\s*\n?\s*CHECK_CONCURRENCY/)
    expect(readingSrc).toMatch(/const CHECK_CONCURRENCY = \d+/)
  })

  it("o teto não passa dos slots do sidecar — DERIVADO do config dele, não copiado", () => {
    // O sidecar é a camada primária do bypass; pedir mais do que ele atende só engorda
    // a fila (→ `busy`) e empurra a chamada pro FlareSolverr, que é serializado. Se
    // alguém mexer na capacidade do sidecar, é aqui que a relação aparece.
    const sidecarSrc = readFileSync(join(RAIZ, "services/comix-render/src/config.ts"), "utf8")
    const slots = Number(
      sidecarSrc.match(/maxConcurrency:\s*num\(process\.env\.MAX_CONCURRENCY,\s*(\d+)\)/)?.[1],
    )
    expect(Number.isFinite(slots)).toBe(true)

    const teto = Number(readingSrc.match(/const CHECK_CONCURRENCY = (\d+)/)?.[1])
    expect(teto).toBeGreaterThan(0)
    expect(teto).toBeLessThanOrEqual(slots)
  })
})
