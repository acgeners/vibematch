import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Preflight da VERSÃO CANÔNICA (migration 202) — a ORDEM, com a função REAL.
 *
 * 🔴 Um teste só da decisão pura passaria verde com a guarda pendurada depois do provider, ou
 * engolindo o erro. Aqui `exigirVersaoCanonica` é a de verdade, lendo um cliente falso, e o
 * provider é um espião que só pode ser tocado quando o contrato PERMITE.
 */

vi.mock("server-only", () => ({}))

const spies = vi.hoisted(() => ({
  contrato: { data: null as unknown, error: null as { code?: string; message: string } | null },
  createLoggedMessage: vi.fn(async () => {
    throw new Error("PROVIDER_ALCANCADO")
  }),
  getAnthropicClient: vi.fn(() => ({})),
}))
const { createLoggedMessage, getAnthropicClient } = spies

vi.mock("@/lib/ai-evaluation/criteria-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-evaluation/criteria-guard")>()),
  exigirCriteriosNoBanco: async () => {},
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => {
      if (t !== "canonical_contract") throw new Error(`tabela inesperada no preflight: ${t}`)
      const q = { select: () => q, eq: () => q, maybeSingle: async () => spies.contrato }
      return q
    },
  }),
}))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: spies.createLoggedMessage,
  getAnthropicClient: spies.getAnthropicClient,
  anotarPayloadRecusado: vi.fn(),
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

import { requestAiEvaluation, PROMPT_VERSION } from "@/lib/ai-evaluation/service"

const pedido = {
  workId: "00000000-0000-0000-0000-000000000000",
  title: "Obra de teste",
  genres: [],
  tags: [],
  sourcedReviews: [],
  platformRatings: [],
} as unknown as Parameters<typeof requestAiEvaluation>[0]

const linha = (versoes: string[], enforce: boolean) => ({
  data: { eval_prompt_versions: versoes, scoring_contracts: ["s9-fantasy-b-v1"], enforce },
  error: null,
})

beforeEach(() => {
  createLoggedMessage.mockClear()
  getAnthropicClient.mockClear()
})

describe("requestAiEvaluation confere a versão canônica antes de pagar", () => {
  it("enforce ligado + versão fora da lista: aborta ANTES do provider, com a mensagem do contrato", async () => {
    spies.contrato = linha(["v99"], true)
    await expect(requestAiEvaluation(pedido)).rejects.toThrow(new RegExp(`INCOMPATÍVEL[\\s\\S]*prompt_version ${PROMPT_VERSION}[\\s\\S]*v99`))
    expect(createLoggedMessage).not.toHaveBeenCalled()
    expect(getAnthropicClient).not.toHaveBeenCalled()
  })

  it("erro ao LER o contrato também aborta antes do provider (fail closed)", async () => {
    spies.contrato = { data: null, error: { code: "08006", message: "connection failure" } }
    await expect(requestAiEvaluation(pedido)).rejects.toThrow(/não consegui ler o contrato canônico/)
    expect(createLoggedMessage).not.toHaveBeenCalled()
  })

  it(`enforce ligado + ${PROMPT_VERSION} permitida: segue até o provider`, async () => {
    spies.contrato = linha([PROMPT_VERSION], true)
    await expect(requestAiEvaluation(pedido)).rejects.toThrow(/PROVIDER_ALCANCADO/)
    expect(createLoggedMessage).toHaveBeenCalled()
  })

  it("enforce DESLIGADO mantém o comportamento atual, mesmo com a versão fora da lista", async () => {
    spies.contrato = linha(["v99"], false)
    await expect(requestAiEvaluation(pedido)).rejects.toThrow(/PROVIDER_ALCANCADO/)
    expect(createLoggedMessage).toHaveBeenCalled()
  })

  it("tabela ausente (banco antes da 202) mantém o comportamento atual", async () => {
    spies.contrato = { data: null, error: { code: "PGRST205", message: "Could not find the table" } }
    await expect(requestAiEvaluation(pedido)).rejects.toThrow(/PROVIDER_ALCANCADO/)
    expect(createLoggedMessage).toHaveBeenCalled()
  })
})
