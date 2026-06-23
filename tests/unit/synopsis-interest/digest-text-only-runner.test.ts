import { describe, it, expect } from "vitest"
import {
  runTextOnlyDigest,
  readWorkArtifact,
  writeWorkArtifactAtomic,
  isReusable,
  isIncompatible,
  workArtifactPath,
  type FsLike,
  type WorkDigestArtifact,
  type FrozenWork,
  type CurrentCorpus,
} from "@/lib/synopsis-interest/digest-text-only-runner"
import {
  selectTextOnly,
  type DigestModelAdapter,
  type TextOnlyDigest,
} from "@/lib/synopsis-interest/digest-text-only"

// ── FS fake em memória (registra writes/renames p/ provar atomicidade) ──
function fakeFs(): FsLike & { store: Map<string, string>; events: string[] } {
  const store = new Map<string, string>()
  const events: string[] = []
  return {
    store, events,
    exists: (p) => store.has(p),
    readFile: (p) => { const v = store.get(p); if (v == null) throw new Error("ENOENT " + p); return v },
    writeFile: (p, c) => { store.set(p, c); events.push("write:" + p) },
    rename: (a, b) => { const v = store.get(a)!; store.delete(a); store.set(b, v); events.push("rename:" + a + "→" + b) },
    mkdirp: (p) => { events.push("mkdirp:" + p) },
  }
}

const DIGEST: TextOnlyDigest = {
  consensus: "c", divergence: "d", recurring_positives: ["p"], recurring_negatives: ["n"], narrative_traits: ["t"], content_warnings: [],
}
const okAdapter: DigestModelAdapter = { async generate() { return { raw: DIGEST, model: "claude-sonnet-4-6" } } }
const badSchemaAdapter: DigestModelAdapter = { async generate() { return { raw: { consensus: 123 }, model: "x" } } }
const throwAdapter: DigestModelAdapter = { async generate() { throw new Error("boom") } }

const T = (tag: string) => `${tag} ` + "y".repeat(50)

/** Constrói deps consistentes (frozen == corpus atual) p/ 1 obra com `reviews`. */
function setup(reviews: string[], adapter: DigestModelAdapter, over: Partial<Parameters<typeof runTextOnlyDigest>[0]> = {}) {
  const fs = fakeFs()
  const sel = selectTextOnly(reviews.map((t) => ({ text: t })))
  const frozen: FrozenWork = {
    workId: "w1",
    reviewCorpusSignature: "RC1",
    digestSelectionSignature: "DS1",
    digestSelectionNormalizedHashes: sel.map((s) => s.normalizedHash),
  }
  const current: CurrentCorpus = { reviewCorpusSignature: "RC1", digestSelectionSignature: "DS1", reviews: reviews.map((t) => ({ text: t })) }
  return {
    fs,
    deps: {
      baseDir: "/exp",
      base2Signature: "B2",
      base2r1Signature: "B2R1",
      scopeWorkIds: ["w1"],
      frozen: new Map([["w1", frozen]]),
      readCorpus: async () => current,
      adapter,
      fs,
      now: () => "2026-01-01T00:00:00.000Z",
      ...over,
    },
  }
}

describe("runner — caminhos com adapter falso", () => {
  it("sucesso: escreve artefato succeeded + assinaturas", async () => {
    const { fs, deps } = setup([T("a"), T("b")], okAdapter)
    const rep = await runTextOnlyDigest(deps)
    expect(rep.counts.succeeded).toBe(1)
    const art = readWorkArtifact(fs, "/exp", "w1")!
    expect(art.status).toBe("succeeded")
    expect(art.digest).toBeDefined()
    expect(art.digestOutputSignature).toBeDefined()
    expect(art.digestVersion).toBe("digest-text-only-v1")
    expect(art.promptVersion).toBe("digest-prompt-text-only-v1")
  })
  it("falha de schema ⇒ failed (sem digest, NÃO vira no_reviews)", async () => {
    const { fs, deps } = setup([T("a"), T("b")], badSchemaAdapter)
    const rep = await runTextOnlyDigest(deps)
    expect(rep.counts.failed).toBe(1)
    const art = readWorkArtifact(fs, "/exp", "w1")!
    expect(art.status).toBe("failed")
    expect(art.digest).toBeUndefined()
    expect(art.error).toContain("schema")
  })
  it("falha do adapter ⇒ failed", async () => {
    const { deps } = setup([T("a")], throwAdapter)
    const rep = await runTextOnlyDigest(deps)
    expect(rep.counts.failed).toBe(1)
    expect(rep.outcomes[0].reason).toBe("adapter_error")
  })
  it("input_changed: corpus atual diverge do congelado ⇒ não chama modelo", async () => {
    let called = 0
    const spy: DigestModelAdapter = { async generate() { called++; return { raw: DIGEST, model: "x" } } }
    const { deps } = setup([T("a")], spy)
    deps.readCorpus = async () => ({ reviewCorpusSignature: "DIFERENTE", digestSelectionSignature: "DS1", reviews: [{ text: T("a") }] })
    const rep = await runTextOnlyDigest(deps)
    expect(rep.counts.input_changed).toBe(1)
    expect(called).toBe(0)
  })
  it("output existente COMPATÍVEL ⇒ reused (retomada, não rechama modelo)", async () => {
    let called = 0
    const spy: DigestModelAdapter = { async generate() { called++; return { raw: DIGEST, model: "x" } } }
    const { fs, deps } = setup([T("a")], spy)
    await runTextOnlyDigest(deps) // 1ª geração
    expect(called).toBe(1)
    const rep2 = await runTextOnlyDigest({ ...deps, fs }) // 2ª: deve reusar
    expect(rep2.counts.reused).toBe(1)
    expect(called).toBe(1) // não chamou de novo
  })
  it("output existente INCOMPATÍVEL ⇒ conflict (NÃO sobrescreve)", async () => {
    const { fs, deps } = setup([T("a")], okAdapter)
    // grava um artefato com assinatura divergente
    const stale: WorkDigestArtifact = {
      workId: "w1", status: "succeeded", base2Signature: "B2", base2r1Signature: "B2R1",
      corpusPolicyVersion: "text-only-v1", selectionPolicyVersion: "x", reviewCorpusSignature: "RC1",
      digestSelectionSignature: "DS1", digestPromptCorpusSignature: "STALE_PC", digestVersion: "digest-text-only-v1",
      promptVersion: "x", model: "x", schemaVersion: "x", maxTokens: 2000, temperaturePolicy: "x", pricingVersion: "x",
      digestContractSignature: "STALE_CONTRACT", digestImplementationSignature: "STALE_IMPL", digestInputSignature: "STALE_INPUT",
      digest: DIGEST, digestOutputSignature: "old", createdAt: "t",
    }
    writeWorkArtifactAtomic(fs, "/exp", stale)
    const rep = await runTextOnlyDigest({ ...deps, fs })
    expect(rep.counts.conflict).toBe(1)
    // não sobrescrito
    expect(readWorkArtifact(fs, "/exp", "w1")!.digestContractSignature).toBe("STALE_CONTRACT")
  })
  it("cancelamento cooperativo ⇒ cancelled, sem chamar modelo", async () => {
    let called = 0
    const spy: DigestModelAdapter = { async generate() { called++; return { raw: DIGEST, model: "x" } } }
    const { deps } = setup([T("a")], spy)
    const rep = await runTextOnlyDigest({ ...deps, shouldStop: () => true })
    expect(rep.counts.cancelled).toBe(1)
    expect(called).toBe(0)
  })
  it("soft-cap futuro interrompe o lote", async () => {
    const { deps } = setup([T("a")], okAdapter)
    const rep = await runTextOnlyDigest({ ...deps, maxCostUsd: 0, estimateUsd: () => 1 })
    expect(rep.counts.stopped_by_cost).toBe(1)
  })
})

describe("runner — storage atômico + isolamento de produção", () => {
  it("escrita é atômica (temp → rename)", async () => {
    const { fs } = setup([T("a")], okAdapter)
    await runTextOnlyDigest(setup([T("a")], okAdapter, { fs }).deps)
    const wrote = fs.events.find((e) => e.startsWith("write:") && e.endsWith(".tmp"))
    const renamed = fs.events.find((e) => e.startsWith("rename:") && e.includes(".tmp→"))
    expect(wrote).toBeDefined()
    expect(renamed).toBeDefined()
  })
  it("escreve só no diretório experimental local (works/<id>.json), nunca em works.review_digest", async () => {
    const { fs, deps } = setup([T("a")], okAdapter)
    await runTextOnlyDigest(deps)
    expect(workArtifactPath("/exp")).toBe("/exp/digests-text-only-v1/works")
    for (const p of fs.store.keys()) expect(p.startsWith("/exp/digests-text-only-v1/works/")).toBe(true)
  })
  it("isReusable/isIncompatible: fail-closed pelas 4 assinaturas", () => {
    const s = { inputSig: "I", contractSig: "C", implSig: "M", promptCorpusSig: "P" }
    const good: WorkDigestArtifact = {
      workId: "w1", status: "succeeded", digestInputSignature: "I", digestContractSignature: "C",
      digestImplementationSignature: "M", digestPromptCorpusSignature: "P",
    } as WorkDigestArtifact
    expect(isReusable(good, s)).toBe(true)
    expect(isReusable({ ...good, status: "failed" }, s)).toBe(false)
    expect(isReusable({ ...good, digestInputSignature: "X" }, s)).toBe(false)
    expect(isReusable({ ...good, digestImplementationSignature: "X" }, s)).toBe(false)
    expect(isReusable({ ...good, digestPromptCorpusSignature: "X" }, s)).toBe(false)
    expect(isIncompatible({ ...good, digestContractSignature: "X" }, s)).toBe(true)
    expect(isIncompatible(good, s)).toBe(false)
  })
})
