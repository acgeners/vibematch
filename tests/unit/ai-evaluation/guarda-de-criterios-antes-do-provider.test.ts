import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A ORDEM, que é o ponto: a guarda tem de barrar ANTES de qualquer gasto.
 *
 * 🔴 Um teste só da guarda pura passaria verde com ela pendurada DEPOIS da chamada ao provider
 * — que é exatamente o defeito de 2026-09-21 (a FK só falava depois de US$0,0647 debitados).
 * Aqui o provider é um espião que NÃO pode ser tocado.
 *
 * ⚠️ E o cache entra no teste de propósito: um hit devolve os MESMOS slugs e bateria na mesma
 * FK. Guardar só o caminho do provider deixaria essa metade descoberta.
 */

vi.mock("server-only", () => ({}))

// `vi.hoisted`: as factories de `vi.mock` são içadas acima dos `const`, então um spy
// declarado com `const` lá embaixo estoura em TDZ quando o service é importado.
const spies = vi.hoisted(() => ({
  guarda: vi.fn<() => Promise<void>>(async () => {}),
  createLoggedMessage: vi.fn(async () => {
    throw new Error("o provider NÃO podia ter sido chamado")
  }),
  getAnthropicClient: vi.fn(() => ({})),
}))
const { guarda, createLoggedMessage, getAnthropicClient } = spies

vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({
  exigirCriteriosNoBanco: () => spies.guarda(),
}))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: spies.createLoggedMessage,
  getAnthropicClient: spies.getAnthropicClient,
}))
vi.mock("@/server/queries/ai-cache", () => ({
  recordCacheEventAsync: vi.fn(),
  readAiCache: vi.fn(async () => null),
  writeAiCache: vi.fn(),
}))

vi.mock("@/lib/server/covers/fetch-cover-for-model", () => ({
  fetchCoverForModelWithStatus: vi.fn(async () => ({ image: null, status: "skipped" })),
  isImageRelatedModelError: () => false,
}))

import { requestAiEvaluation } from "@/lib/ai-evaluation/service"

const pedido = {
  workId: "00000000-0000-0000-0000-000000000000",
  title: "Obra de teste",
  genres: [],
  tags: [],
  sourcedReviews: [],
  platformRatings: [],
} as unknown as Parameters<typeof requestAiEvaluation>[0]

beforeEach(() => {
  guarda.mockClear()
  createLoggedMessage.mockClear()
  getAnthropicClient.mockClear()
  guarda.mockImplementation(async () => {})
})

describe("requestAiEvaluation consulta a guarda antes de gastar", () => {
  it("a guarda é chamada — e é a PRIMEIRA coisa", async () => {
    guarda.mockImplementation(async () => {
      // Se o provider já tivesse sido tocado, o gasto já teria acontecido.
      expect(createLoggedMessage).not.toHaveBeenCalled()
      expect(getAnthropicClient).not.toHaveBeenCalled()
      throw new Error("guarda: banco não conhece fantasy, nobility")
    })

    await expect(requestAiEvaluation(pedido)).rejects.toThrow(/fantasy, nobility/)
    expect(guarda).toHaveBeenCalledTimes(1)
  })

  it("guarda que reprova NÃO deixa o provider ser chamado", async () => {
    guarda.mockImplementation(async () => {
      throw new Error("guarda reprovou")
    })

    await expect(requestAiEvaluation(pedido)).rejects.toThrow(/guarda reprovou/)
    expect(createLoggedMessage).not.toHaveBeenCalled()
    expect(getAnthropicClient).not.toHaveBeenCalled()
  })

  it("a mensagem da guarda CHEGA a quem clicou, sem ser trocada por uma genérica", async () => {
    guarda.mockImplementation(async () => {
      throw new Error("o banco X não conhece 2 dos 11 critérios: fantasy, nobility")
    })

    // Erro engolido e reembrulhado deixaria a pessoa sem saber qual migration falta.
    await expect(requestAiEvaluation(pedido)).rejects.toThrow(
      /não conhece 2 dos 11 critérios: fantasy, nobility/
    )
  })
})
