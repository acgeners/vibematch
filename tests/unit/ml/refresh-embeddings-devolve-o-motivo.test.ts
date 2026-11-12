import { describe, it, expect, beforeEach, vi } from "vitest"

const { embedMock, upsertMock } = vi.hoisted(() => ({
  embedMock: vi.fn(),
  upsertMock: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: vi.fn(async () => ({ ok: true })) }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert: upsertMock }) }),
}))
// 150 obras ativas e nenhum embedding salvo ⇒ 150 candidatas, em 2 lotes de 100.
vi.mock("@/lib/supabase/paginate", () => ({
  fetchAllRows: vi.fn(async (_build: unknown, opts: { label: string }) =>
    opts.label.includes("(works)")
      ? Array.from({ length: 150 }, (_, i) => ({
          id: `obra-${i}`,
          title: `Obra ${i}`,
          review_digest: null,
          review_summary: null,
          category_scores: [],
          work_tags: [],
          work_synopses: [],
        }))
      : [],
  ),
}))
vi.mock("@/lib/ml/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ml/embeddings")>()),
  embedTexts: embedMock,
}))

import { refreshEmbeddings } from "@/server/embeddings/refresh"
import { OpenAIEmbeddingsError } from "@/lib/ml/embeddings"

const SEM_CREDITO = new OpenAIEmbeddingsError("OpenAI embeddings falhou (429): You have no credits remaining.", {
  status: 429,
  type: "insufficient_quota",
  code: "credit_balance_exhausted",
})
const RITMO = new OpenAIEmbeddingsError("OpenAI embeddings falhou (429): Rate limit reached.", {
  status: 429,
  type: "requests",
  code: "rate_limit_exceeded",
})
const sucesso = async (texts: string[]) => ({ vectors: texts.map(() => [0]), tokensUsed: 10 })

/**
 * O refresh devolve POR QUE as obras falharam — e para de bater na API quando o
 * motivo vale pra conta inteira.
 *
 * 🔴 Antes ele devolvia só `failed: 15`, o motivo ficava no `console.error` e a tela
 * mandava "ver os logs do servidor". E sem crédito ele seguia pro lote seguinte, que
 * recebia a mesma recusa.
 */
describe("refreshEmbeddings devolve o motivo da falha", () => {
  beforeEach(() => {
    embedMock.mockReset()
    upsertMock.mockReset()
    upsertMock.mockResolvedValue({ error: null })
  })

  it("sem crédito: para no 1º lote e conta as não tentadas pelo MESMO motivo", async () => {
    embedMock.mockRejectedValue(SEM_CREDITO)
    const r = await refreshEmbeddings()

    expect(embedMock, "seguiu pro lote seguinte depois de a conta recusar").toHaveBeenCalledTimes(1)
    expect(upsertMock).not.toHaveBeenCalled()
    expect(r.refreshed).toBe(0)
    expect(r.failed).toBe(150)
    expect(r.failures).toEqual([
      expect.objectContaining({ kind: "sem_credito", works: 150 }),
    ])
  })

  it("limite de ritmo: o lote seguinte AINDA é tentado", async () => {
    embedMock.mockRejectedValueOnce(RITMO).mockImplementationOnce(sucesso)
    const r = await refreshEmbeddings()

    expect(embedMock).toHaveBeenCalledTimes(2)
    expect(r.refreshed).toBe(50)
    expect(r.failed).toBe(100)
    expect(r.failures).toEqual([expect.objectContaining({ kind: "limite_de_ritmo", works: 100 })])
  })

  it("falha de gravação no banco também volta com o motivo", async () => {
    embedMock.mockImplementation(sucesso)
    upsertMock.mockResolvedValueOnce({ error: { message: "statement timeout" } })
    const r = await refreshEmbeddings()

    expect(r.refreshed).toBe(50)
    expect(r.failures).toEqual([
      expect.objectContaining({ kind: "gravacao", detail: "statement timeout", works: 100 }),
    ])
  })

  it("a soma das obras por motivo fecha com o total de falhas", async () => {
    embedMock.mockRejectedValue(SEM_CREDITO)
    const r = await refreshEmbeddings()
    const soma = r.failures.reduce((s, f) => s + f.works, 0)
    expect(soma).toBe(r.failed)
  })
})
