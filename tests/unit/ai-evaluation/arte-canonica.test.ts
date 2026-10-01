import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Arte CANÔNICA (v32): a mesma chamada dos 11 produz `art`, o apêndice sai do pool uma vez só, a
 * persistência é uma linha por avaliação e nada disso toca scoring.
 */

vi.mock("server-only", () => ({}))

const spies = vi.hoisted(() => ({ createLoggedMessage: vi.fn(), anotar: vi.fn(async () => {}) }))
vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {} }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: spies.createLoggedMessage,
  anotarPayloadRecusado: spies.anotar,
  getAnthropicClient: () => ({}),
}))
vi.mock("@/server/queries/ai-cache", () => ({ recordCacheEventAsync: vi.fn(), readAiCache: vi.fn(async () => null), writeAiCache: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("sem banco no teste")
  },
}))
vi.mock("@/lib/server/covers/fetch-cover-for-model", () => ({
  fetchCoverForModelWithStatus: vi.fn(async () => ({ image: null, status: "not_requested" })),
  isImageRelatedModelError: () => false,
}))

import { ART_CHANGE_EXPERIMENTAL, normalizarArte } from "@/lib/ai-evaluation/art-signal"
import { estadoDaArte, linhaDeArte } from "@/lib/ai-evaluation/art-persistence"
import {
  canonicalInputHash,
  canonicalInputHashV2,
  comApendiceDeArte,
  INSTRUCAO_APENDICE_ARTE,
  requestAiEvaluation,
  VARIANTE_V30,
} from "@/lib/ai-evaluation/service"
import type { AiEvaluationRequest } from "@/lib/ai-evaluation/service"
import type { SourcedReview } from "@/lib/external/types"
import { CRITERION_SLUGS } from "@/types/domain"

const rev = (text: string, source = "mangaupdates"): SourcedReview =>
  ({ source, sourceTitle: "Obra", matchScore: 0.95, text, textLength: text.length }) as SourcedReview
const termos = (i: number) => Array.from({ length: 8 }, (_, k) => `termo${i}x${k}`).join(" ")
const ENVIADA = rev(`About ${termos(0)}: the art is gorgeous and detailed.`)
const POOL = [
  ENVIADA,
  rev(`About ${termos(1)}: the art is beautiful, every panel shines.`, "comix"),
  rev(`About ${termos(2)}: lovely art and pretty colors throughout.`, "kitsu"),
  rev(`About ${termos(3)}: nothing about visuals, only plot and pacing here.`, "mangadex"),
]

let n = 0
const pedido = (extra: Partial<AiEvaluationRequest> = {}): AiEvaluationRequest =>
  ({
    workId: `00000000-0000-0000-0005-${String(++n).padStart(12, "0")}`,
    title: `Obra ${n}`,
    synopsis: "Sinopse.",
    genres: [],
    tags: [],
    sourcedReviews: [ENVIADA],
    platformRatings: [],
    externalContext: ["Contexto."],
    ...extra,
  }) as unknown as AiEvaluationRequest

const onze = () => ({
  summary: "Resumo válido.",
  confidence: 0.8,
  scores: CRITERION_SLUGS.map((criterion) => ({ criterion, score: 5, justification: "Faixa 4-6: presente." })),
})
const resposta = (input: unknown) => ({
  apiCallId: "call-canon",
  message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "submit_evaluation", input }] },
})

beforeEach(() => {
  spies.createLoggedMessage.mockReset()
  spies.anotar.mockReset()
  spies.anotar.mockImplementation(async () => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("o pool vira apêndice UMA vez, antes da chave e do prompt", () => {
  it("comApendiceDeArte escolhe só as reviews de arte que NÃO foram enviadas, e tira o pool do request", () => {
    const r = comApendiceDeArte(pedido({ artEvidencePool: POOL }))
    expect(r.artEvidencePool).toBeUndefined()
    expect(r.artAppendix?.map((a) => a.source)).toEqual(["comix", "kitsu"])
    expect(r.sourcedReviews).toEqual([ENVIADA]) // as reviews dos 11 não mudam
  })

  it("sem pool não há apêndice; na v30 nunca há apêndice", () => {
    expect(comApendiceDeArte(pedido()).artAppendix).toBeUndefined()
    expect(comApendiceDeArte(pedido({ artEvidencePool: POOL }), VARIANTE_V30).artAppendix).toBeUndefined()
  })

  it("o apêndice entra nas DUAS chaves de cache; o pool cru não", () => {
    const sem = comApendiceDeArte(pedido())
    const com = { ...sem, artAppendix: comApendiceDeArte({ ...sem, artEvidencePool: POOL }).artAppendix }
    expect(canonicalInputHash(com)).not.toBe(canonicalInputHash(sem))
    expect(canonicalInputHashV2(com)).not.toBe(canonicalInputHashV2(sem))
  })

  it("requestAiEvaluation: o prompt enviado traz o apêndice, a citação A… é aceita e a resposta carrega o apêndice", async () => {
    const art = {
      judging_reviews: [
        { review_id: "R1", stance: "positive" },
        { review_id: "A1", stance: "positive" },
        { review_id: "A2", stance: "positive" },
      ],
      quality_signal: "ABOVE_AVERAGE",
      quality_evidence: [{ review_id: "A1", excerpt: "the art is beautiful, every panel shines" }],
      change_signal: "NO_CLEAR_SIGNAL",
      change_evidence: [],
      justification: "Elogio consistente.",
    }
    spies.createLoggedMessage.mockResolvedValueOnce(resposta({ ...onze(), art }))
    const r = await requestAiEvaluation(pedido({ artEvidencePool: POOL }))
    const params = spies.createLoggedMessage.mock.calls[0][1] as { messages: Array<{ content: Array<{ type: string; text?: string }> }> }
    const prompt = params.messages[0].content.find((c) => c.type === "text")!.text!
    expect(prompt).toContain(INSTRUCAO_APENDICE_ARTE)
    expect(prompt).toContain("===== INÍCIO REVIEW A1 ")
    expect(r.promptVersion).toBe("v32")
    expect(r.art?.status).toBe("rated")
    expect(r.art?.quality_evidence.map((e) => e.review_id)).toEqual(["A1"])
    expect(r.artAppendix?.map((a) => a.id)).toEqual(["A1", "A2"])
  })
})

describe("mudança é EXPERIMENTAL — a marca viaja com o dado", () => {
  const REVIEWS = [{ id: "R1", text: "The art got noticeably worse after chapter 40." }]
  it("todo resultado de Arte carrega change_experimental = true, inclusive inválido", () => {
    expect(ART_CHANGE_EXPERIMENTAL).toBe(true)
    expect(normalizarArte(undefined, REVIEWS).change_experimental).toBe(true)
    const a = normalizarArte(
      {
        judging_reviews: [],
        quality_signal: "INCONCLUSIVE",
        quality_evidence: [],
        change_signal: "PROBLEMATIC_CHANGE",
        change_direction: "WORSENED",
        change_evidence: [{ review_id: "R1", excerpt: "art got noticeably worse after chapter 40" }],
        justification: "",
      },
      REVIEWS,
    )
    expect(a.change_signal).toBe("PROBLEMATIC_CHANGE")
    expect(a.change_experimental).toBe(true)
  })
})

describe("persistência: uma linha por avaliação", () => {
  const REVIEWS = Array.from({ length: 6 }, (_, i) => ({ id: `R${i + 1}`, text: `Review ${i}: the art is beautiful and detailed.` }))
  const rated = normalizarArte(
    {
      judging_reviews: [1, 2, 3, 4, 5].map((i) => ({ review_id: `R${i}`, stance: i === 5 ? "competent" : "positive" })),
      quality_signal: "ABOVE_AVERAGE",
      quality_evidence: [{ review_id: "R1", excerpt: "the art is beautiful and detailed" }],
      change_signal: "NO_CLEAR_SIGNAL",
      change_evidence: [],
      justification: "Elogio.",
    },
    REVIEWS,
  )

  it("rated: status, rótulo, força, contagens e evidências vão para colunas próprias", () => {
    const l = linhaDeArte({ aiEvaluationId: "ev-1", workId: "w-1", art: rated, apendice: [] })
    expect(l).toMatchObject({
      ai_evaluation_id: "ev-1",
      work_id: "w-1",
      signal_version: "art4",
      status: "rated",
      quality_signal: "ABOVE_AVERAGE",
      quality_strength: "MEDIUM",
      judging_count: 5,
      positive_count: 4,
      competent_count: 1,
      change_signal: "NO_CLEAR_SIGNAL",
      change_direction: null,
      change_strength: null,
      change_experimental: true,
    })
    expect(l.quality_agreement).toBeCloseTo(0.8)
    expect(l.judging_count).toBe(l.positive_count + l.negative_count + l.competent_count + l.mixed_count)
  })

  it("o apêndice que foi ao prompt fica em `normalization` (as citações A… apontam para ele)", () => {
    const l = linhaDeArte({
      aiEvaluationId: "ev-2",
      workId: "w-1",
      art: rated,
      apendice: [{ id: "A1", source: "comix", trecho: "The art is stunning.", julga: true, mudanca: false }],
    })
    expect(l.normalization.apendice).toEqual([{ id: "A1", source: "comix", trecho: "The art is stunning." }])
  })

  it("abstained e invalid são estados distintos — e sem linha é NÃO AVALIADA, nunca abstained", () => {
    expect(estadoDaArte(linhaDeArte({ aiEvaluationId: "e", workId: "w", art: normalizarArte(undefined, REVIEWS), apendice: [] }))).toBe("invalid")
    const abst = normalizarArte({ ...{ judging_reviews: [], quality_evidence: [], change_signal: "NO_CLEAR_SIGNAL", change_evidence: [], justification: "" }, quality_signal: "INCONCLUSIVE" }, REVIEWS)
    expect(estadoDaArte(linhaDeArte({ aiEvaluationId: "e", workId: "w", art: abst, apendice: [] }))).toBe("abstained")
    expect(estadoDaArte(null)).toBe("nao_avaliada")
    expect(estadoDaArte(undefined)).toBe("nao_avaliada")
  })
})

// ── migration 201 ─────────────────────────────────────────────────────────────────────────────

const MIGRATIONS = "supabase/migrations"
const arquivo201 = readdirSync(MIGRATIONS).find((f) => f.startsWith("201_"))!
const SQL = readFileSync(join(MIGRATIONS, arquivo201), "utf8")
const semComentarios = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")

describe("migration 201", () => {
  it("cria a tabela presa a ai_evaluations por FK com CASCADE, uma linha por avaliação", () => {
    expect(semComentarios).toMatch(/ai_evaluation_id\s+uuid primary key references public\.ai_evaluations\(id\) on delete cascade/)
  })
  it("trava no banco o que o validador garante: contagens, força × direção, status × qualidade, mudança experimental", () => {
    for (const c of ["ai_evaluation_art_contagens_somam", "ai_evaluation_art_forca_so_com_direcao", "ai_evaluation_art_status_segue_qualidade", "ai_evaluation_art_direcao_so_com_mudanca"])
      expect(semComentarios).toContain(c)
    expect(semComentarios).toMatch(/change_experimental boolean not null default true check \(change_experimental\)/)
  })
  it("liga RLS e NÃO faz backfill nem mexe em outra tabela", () => {
    expect(semComentarios).toMatch(/alter table public\.ai_evaluation_art enable row level security/)
    expect(semComentarios).not.toMatch(/\binsert\b|\bupdate\b|\bdelete from\b/i)
    const alterados = [...semComentarios.matchAll(/alter table\s+public\.(\w+)/gi)].map((m) => m[1])
    expect(new Set(alterados)).toEqual(new Set(["ai_evaluation_art"]))
  })
})

// ── gravação no caminho principal ────────────────────────────────────────────────────────────

describe("server/actions/ai.ts grava a Arte DEPOIS dos 11 e em modo fail-soft", () => {
  const src = readFileSync("server/actions/ai.ts", "utf8")
  const ini = src.indexOf("export async function triggerAiEvaluation")
  const corpo = src.slice(ini, src.indexOf("\nexport async function", ini + 10))
  it("passa o pool inteiro como evidência de Arte", () => {
    expect(corpo).toMatch(/artEvidencePool:\s*promptPool/)
  })
  it("o insert da Arte vem depois das notas e da conclusão da avaliação, e o erro dele NÃO aborta", () => {
    const iNotas = corpo.indexOf('from("ai_evaluation_scores").insert')
    const iConclui = corpo.indexOf("completedPatch")
    const iArte = corpo.indexOf('from("ai_evaluation_art")')
    expect(iNotas).toBeGreaterThan(0)
    expect(iArte).toBeGreaterThan(iNotas)
    expect(iArte).toBeGreaterThan(iConclui)
    const bloco = corpo.slice(iArte, corpo.indexOf("\n    }\n", iArte))
    expect(bloco).toContain("console.error")
    expect(bloco).not.toMatch(/\bthrow\b|return \{ error/)
  })
})

// ── nada de scoring ──────────────────────────────────────────────────────────────────────────

describe("Arte NÃO entra no scoring", () => {
  const ARQUIVOS = [
    ...readdirSync("lib/calculations").filter((f) => f.endsWith(".ts")).map((f) => `lib/calculations/${f}`),
    ...readdirSync("lib/ml").filter((f) => f.endsWith(".ts")).map((f) => `lib/ml/${f}`),
    "server/actions/calculations.ts",
    "server/queries/recalc-works.ts",
  ]
  it("nenhum arquivo de cálculo lê ai_evaluation_art nem o resultado de Arte", () => {
    for (const f of ARQUIVOS) expect(readFileSync(f, "utf8"), f).not.toMatch(/ai_evaluation_art|art-signal|art-persistence|quality_signal/)
  })
})
