import { describe, it, expect } from "vitest"
import {
  mapUniqueConflict,
  ownershipError,
} from "@/lib/validations/external-review-action-result"

describe("external-review action result — conflito de índice único", () => {
  it("uniq_extid não existe mais (114): mensagem desconhecida → db", () => {
    const r = mapUniqueConflict({ code: "23505", message: 'duplicate key value violates unique constraint "work_external_reviews_manual_uniq_extid"' })
    expect(r && !r.ok && r.error).toBe("db")
  })
  it("11. conflito de hash (uniq_hash) é tratado — único índice único restante", () => {
    const r = mapUniqueConflict({ code: "23505", message: 'duplicate key value violates unique constraint "work_external_reviews_manual_uniq_hash"' })
    expect(r && !r.ok && r.error).toBe("duplicate_text")
  })
  it("23505 sem nome conhecido → db; não-23505 → null", () => {
    expect(mapUniqueConflict({ code: "23505", message: "outro" })?.ok).toBe(false)
    expect(mapUniqueConflict({ code: "23505", message: "outro" })).toMatchObject({ error: "db" })
    expect(mapUniqueConflict({ code: "23503", message: "fk" })).toBeNull()
    expect(mapUniqueConflict(null)).toBeNull()
  })
})

describe("external-review action result — posse do registro", () => {
  it("12/13. registro inexistente → review_not_found", () => {
    expect(ownershipError(null, "w1")).toMatchObject({ error: "review_not_found" })
    expect(ownershipError(undefined, "w1")).toMatchObject({ error: "review_not_found" })
  })
  it("12/13. registro de OUTRA obra → wrong_work (não altera/exclui)", () => {
    expect(ownershipError({ work_id: "w2" }, "w1")).toMatchObject({ error: "wrong_work" })
  })
  it("12/13. registro da mesma obra → null (posse válida)", () => {
    expect(ownershipError({ work_id: "w1" }, "w1")).toBeNull()
  })
})
