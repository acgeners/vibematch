import { test } from "node:test"
import assert from "node:assert/strict"
import { Semaphore, BusyError } from "../src/pool.js"

test("acquire até o limite não espera; inFlight sobe", async () => {
  const sem = new Semaphore(2, 10, 1000)
  assert.equal(await sem.acquire(), 0)
  assert.equal(await sem.acquire(), 0)
  assert.equal(sem.inFlight, 2)
})

test("além do limite entra na fila; release passa a vez", async () => {
  const sem = new Semaphore(1, 10, 1000)
  await sem.acquire()
  let got = false
  const p = sem.acquire().then(() => {
    got = true
  })
  assert.equal(sem.queueLength, 1)
  assert.equal(got, false)
  sem.release()
  await p
  assert.equal(got, true)
  assert.equal(sem.inFlight, 1)
})

test("fila cheia → BusyError imediato", async () => {
  const sem = new Semaphore(1, 1, 1000)
  await sem.acquire() // ocupa o slot
  const queued = sem.acquire() // ocupa a fila (1 lugar)
  await assert.rejects(() => sem.acquire(), BusyError) // fila cheia
  sem.release()
  await queued
})

test("espera na fila estoura o teto → BusyError", async () => {
  const sem = new Semaphore(1, 10, 20) // maxWait 20ms
  await sem.acquire()
  await assert.rejects(() => sem.acquire(), BusyError)
})

test("acquire devolve o tempo esperado na fila", async () => {
  const sem = new Semaphore(1, 10, 1000)
  await sem.acquire()
  // relógio fake: enfileira em t=100, libera em t=175 → espera 75ms
  let clock = 100
  const waited = sem.acquire(() => clock)
  clock = 175
  sem.release()
  assert.equal(await waited, 75)
})
