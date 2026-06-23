import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { createAnthropicDigestAdapter, type AnthropicSend, type AnthropicSendResult } from "@/lib/synopsis-interest/digest-text-only-adapter"
import {
  EXPERIMENT_DIGEST_MODEL,
  EXPERIMENT_DIGEST_MAX_TOKENS,
  EXPERIMENT_DIGEST_TEMPERATURE,
  TEXT_ONLY_DIGEST_TOOL,
  buildTextOnlyDigestPrompt,
  type TextOnlyDigest,
} from "@/lib/synopsis-interest/digest-text-only"

const DIGEST: TextOnlyDigest = {
  consensus: "c", divergence: "d", recurring_positives: ["p"], recurring_negatives: ["n"], narrative_traits: ["t"], content_warnings: [],
}
const toolMessage = (input: unknown): AnthropicSendResult["message"] => ({ model: EXPERIMENT_DIGEST_MODEL, content: [{ type: "tool_use", name: TEXT_ONLY_DIGEST_TOOL.name, input }] })

/** `send` fake: registra params/meta e NUNCA toca rede. */
function fakeSend(message: AnthropicSendResult["message"], usage = { inputTokens: 11, outputTokens: 22 }) {
  const calls: Array<{ params: unknown; meta: unknown }> = []
  const fn: AnthropicSend = async (params, meta) => { calls.push({ params, meta }); return { message, usage } }
  return Object.assign(fn, { calls })
}

const { system, user } = buildTextOnlyDigestPrompt(["Alpha review — texto sintético longo o suficiente.", "Beta review — outro texto sintético longo."])

describe("adapter real — request correto com cliente MOCKADO (§9)", () => {
  it("monta request com model/system/[Review N]/tool/max_tokens/temperature congelados", async () => {
    const send = fakeSend(toolMessage(DIGEST))
    const adapter = createAnthropicDigestAdapter({ send })
    await adapter.generate({ system, user, model: EXPERIMENT_DIGEST_MODEL })
    const p = send.calls[0].params as Record<string, unknown>
    expect(p.model).toBe(EXPERIMENT_DIGEST_MODEL)
    expect(p.max_tokens).toBe(EXPERIMENT_DIGEST_MAX_TOKENS)
    expect(p.temperature).toBe(EXPERIMENT_DIGEST_TEMPERATURE)
    expect(p.system).toBe(system)
    expect((p.messages as Array<{ content: string }>)[0].content).toContain("[Review 1]")
    expect((p.tools as Array<{ name: string }>)[0].name).toBe(TEXT_ONLY_DIGEST_TOOL.name)
    expect(p.tool_choice).toEqual({ type: "tool", name: TEXT_ONLY_DIGEST_TOOL.name })
  })
  it("resposta válida é parseada (raw da tool) + tokens capturados", async () => {
    const send = fakeSend(toolMessage(DIGEST))
    const out = await createAnthropicDigestAdapter({ send }).generate({ system, user, model: EXPERIMENT_DIGEST_MODEL })
    expect(out.raw).toEqual(DIGEST)
    expect(out.model).toBe(EXPERIMENT_DIGEST_MODEL)
    expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 22 })
  })
  it("tool_use ausente ⇒ erro propagado", async () => {
    const send = fakeSend({ model: "m", content: [{ type: "text" }] })
    await expect(createAnthropicDigestAdapter({ send }).generate({ system, user, model: EXPERIMENT_DIGEST_MODEL })).rejects.toThrow(/tool_use ausente/)
  })
  it("erro da API é propagado", async () => {
    const boom: AnthropicSend = async () => { throw new Error("429 rate limit") }
    await expect(createAnthropicDigestAdapter({ send: boom }).generate({ system, user, model: EXPERIMENT_DIGEST_MODEL })).rejects.toThrow(/429/)
  })
  it("request é determinístico (mesmo hash) p/ a mesma entrada", async () => {
    const s1 = fakeSend(toolMessage(DIGEST)); const s2 = fakeSend(toolMessage(DIGEST))
    await createAnthropicDigestAdapter({ send: s1 }).generate({ system, user, model: EXPERIMENT_DIGEST_MODEL })
    await createAnthropicDigestAdapter({ send: s2 }).generate({ system, user, model: EXPERIMENT_DIGEST_MODEL })
    const h = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex")
    expect(h(s1.calls[0].params)).toBe(h(s2.calls[0].params))
  })
  it("com send injetado, NENHUMA rede real é tocada (boundary dinâmico nunca alcançado)", async () => {
    // se tocasse o boundary real, getAnthropicClient lançaria sem ANTHROPIC_API_KEY no ambiente de teste
    const send = fakeSend(toolMessage(DIGEST))
    await expect(createAnthropicDigestAdapter({ send }).generate({ system, user, model: EXPERIMENT_DIGEST_MODEL })).resolves.toBeDefined()
    expect(send.calls.length).toBe(1)
  })
})
