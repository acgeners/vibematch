import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  classifyCollectionError,
  warnPredictionCollectionOnce,
  __resetCollectionWarnings,
} from "@/lib/server/predictions/collection-status"

describe("classifyCollectionError", () => {
  it("sem erro → active", () => {
    expect(classifyCollectionError(null)).toBe("active")
    expect(classifyCollectionError(undefined)).toBe("active")
  })
  it("42P01 → migration_missing", () => {
    expect(classifyCollectionError({ code: "42P01", message: "relation does not exist" })).toBe("migration_missing")
  })
  it("mensagem 'does not exist' sem code → migration_missing", () => {
    expect(classifyCollectionError({ message: 'relation "prediction_snapshots" does not exist' })).toBe(
      "migration_missing",
    )
  })
  it("classe 08 → connection_error", () => {
    expect(classifyCollectionError({ code: "08006", message: "connection failure" })).toBe("connection_error")
  })
  it("outro código → unexpected_error", () => {
    expect(classifyCollectionError({ code: "23505", message: "duplicate" })).toBe("unexpected_error")
  })
})

describe("warnPredictionCollectionOnce", () => {
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    __resetCollectionWarnings()
    spy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    spy.mockRestore()
  })

  it("loga uma vez por status, não repete", () => {
    warnPredictionCollectionOnce("migration_missing", "x")
    warnPredictionCollectionOnce("migration_missing", "x")
    warnPredictionCollectionOnce("migration_missing", "x")
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it("status saudáveis não logam", () => {
    warnPredictionCollectionOnce("active")
    warnPredictionCollectionOnce("no_data")
    expect(spy).not.toHaveBeenCalled()
  })
  it("statuses diferentes logam separadamente", () => {
    warnPredictionCollectionOnce("migration_missing")
    warnPredictionCollectionOnce("connection_error")
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
