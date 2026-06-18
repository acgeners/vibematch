import { describe, it, expect, beforeEach } from "vitest"
import {
  runSingleFlight,
  inFlightCount,
  __resetSingleFlight,
} from "@/lib/ai-cache/single-flight"

beforeEach(() => __resetSingleFlight())

/** Promise controlável: resolve/reject manual. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("runSingleFlight (§25.3)", () => {
  it("duas chamadas iguais geram UMA execução; ambas recebem o resultado", async () => {
    let calls = 0
    const d = deferred<number>()
    const op = () => {
      calls += 1
      return d.promise
    }
    const p1 = runSingleFlight("k", op)
    const p2 = runSingleFlight("k", op)
    expect(calls).toBe(1)
    d.resolve(42)
    expect(await p1).toBe(42)
    expect(await p2).toBe(42)
  })

  it("vinte chamadas iguais geram UMA execução", async () => {
    let calls = 0
    const d = deferred<string>()
    const op = () => {
      calls += 1
      return d.promise
    }
    const ps = Array.from({ length: 20 }, () => runSingleFlight("same", op))
    expect(calls).toBe(1)
    d.resolve("ok")
    const results = await Promise.all(ps)
    expect(results.every((r) => r === "ok")).toBe(true)
  })

  it("chaves diferentes não bloqueiam (execuções independentes)", async () => {
    let calls = 0
    const da = deferred<number>()
    const db = deferred<number>()
    const pa = runSingleFlight("a", () => {
      calls += 1
      return da.promise
    })
    const pb = runSingleFlight("b", () => {
      calls += 1
      return db.promise
    })
    expect(calls).toBe(2)
    da.resolve(1)
    db.resolve(2)
    expect(await pa).toBe(1)
    expect(await pb).toBe(2)
  })

  it("erro libera a chave e propaga pra todos os waiters", async () => {
    const d = deferred<number>()
    const p1 = runSingleFlight("err", () => d.promise)
    const p2 = runSingleFlight("err", () => d.promise)
    d.reject(new Error("boom"))
    await expect(p1).rejects.toThrow("boom")
    await expect(p2).rejects.toThrow("boom")
    expect(inFlightCount()).toBe(0) // chave liberada após erro
  })

  it("nova chamada após erro funciona (não fica presa)", async () => {
    await expect(runSingleFlight("retry", async () => { throw new Error("x") })).rejects.toThrow("x")
    const ok = await runSingleFlight("retry", async () => "recuperado")
    expect(ok).toBe("recuperado")
  })

  it("a promise é sempre removida após sucesso (sem cache permanente implícito)", async () => {
    await runSingleFlight("done", async () => "v")
    expect(inFlightCount()).toBe(0)
    // segunda chamada RE-executa (não reaproveita resultado anterior)
    let calls = 0
    await runSingleFlight("done", async () => {
      calls += 1
      return "v2"
    })
    expect(calls).toBe(1)
  })

  it("throw SÍNCRONO da operação vira rejeição (não escapa)", async () => {
    await expect(
      runSingleFlight("sync", () => {
        throw new Error("sync-throw")
      }),
    ).rejects.toThrow("sync-throw")
    expect(inFlightCount()).toBe(0)
  })

  it("onWaiter dispara só pros waiters, não pro líder", async () => {
    let waiters = 0
    const d = deferred<number>()
    const opts = { onWaiter: () => { waiters += 1 } }
    const p1 = runSingleFlight("w", () => d.promise, opts) // líder
    const p2 = runSingleFlight("w", () => d.promise, opts) // waiter
    const p3 = runSingleFlight("w", () => d.promise, opts) // waiter
    expect(waiters).toBe(2)
    d.resolve(0)
    await Promise.all([p1, p2, p3])
  })
})
