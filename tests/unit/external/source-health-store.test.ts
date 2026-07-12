import { describe, it, expect, vi, beforeEach } from "vitest"

// O que este arquivo prende é uma sutileza fácil de desfazer sem perceber: no upsert do
// PostgREST, uma coluna AUSENTE do payload fica fora do `DO UPDATE SET` e é preservada.
// É disso que depende o `last_ok_at` sobreviver a uma queda — e a diferença entre omitir a
// chave e mandá-la como `null` (que APAGA o valor) é invisível numa leitura rápida.
const upsert = vi.fn().mockResolvedValue({ error: null })
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert }) }),
}))

import { upsertSourceHealth } from "@/lib/external/source-health-store"

const payload = () => upsert.mock.calls[0][0] as Record<string, unknown>

beforeEach(() => vi.clearAllMocks())

describe("upsertSourceHealth — preservação de timestamps", () => {
  it("ao gravar uma QUEDA, não manda last_ok_at — senão apagaria o último sucesso", async () => {
    await upsertSourceHealth("myanimelist", {
      status: "down",
      lastOkAt: null,
      lastFailAt: Date.now(),
      failReason: "HTTP 504",
      consecutiveFails: 3,
    })

    // A chave precisa estar AUSENTE. Mandá-la como null zeraria a coluna no banco — e o
    // aviso "A fonte não respondeu" só exibe "Último sucesso: X" QUANDO a fonte está fora,
    // ou seja, no exato instante em que o valor teria acabado de ser destruído.
    expect(payload()).not.toHaveProperty("last_ok_at")
    expect(payload()).toMatchObject({
      source: "myanimelist",
      status: "down",
      fail_reason: "HTTP 504",
      consecutive_fails: 3,
    })
    expect(payload()).toHaveProperty("last_fail_at")
  })

  it("ao gravar um SUCESSO, não manda last_fail_at — a data da última queda segue disponível", async () => {
    await upsertSourceHealth("myanimelist", {
      status: "ok",
      lastOkAt: Date.now(),
      lastFailAt: null,
      failReason: null,
      consecutiveFails: 0,
    })

    expect(payload()).toHaveProperty("last_ok_at")
    expect(payload()).not.toHaveProperty("last_fail_at")
    expect(payload()).toMatchObject({ status: "ok", fail_reason: null, consecutive_fails: 0 })
  })

  it("telemetria nunca quebra o scraping: erro do supabase é engolido", async () => {
    upsert.mockRejectedValueOnce(new Error("relation does not exist"))
    await expect(
      upsertSourceHealth("comix", {
        status: "ok",
        lastOkAt: Date.now(),
        lastFailAt: null,
        failReason: null,
        consecutiveFails: 0,
      })
    ).resolves.toBeUndefined()
  })
})
