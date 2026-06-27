import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Guard ARQUITETURAL (Plano 3 B2.2M §8). Varredura ESTÁTICA do código-fonte: o corpus
 * canônico de digest NUNCA pode tocar o store PESSOAL (`work_manual_reviews`), e planner/
 * executor/loaders precisam compartilhar o MESMO loader canônico.
 */

/**
 * Lê o CÓDIGO (sem comentários) — o guard mira uso real (imports, queries), não menções
 * em prosa. Remove blocos `/* *​/` e linhas `//…` (preservando `://` de URLs).
 */
function read(p: string): string {
  const raw = readFileSync(resolve(process.cwd(), p), "utf8")
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n")
}

const PERSONAL_STORE_MARKERS = [
  "work_manual_reviews",
  "readAllManualReviews",
  "getManualReviews",
  "saveManualReviews",
  "manual-reviews",
  "review-drafts-field",
]

describe("guard — corpus canônico não importa/consulta o store pessoal", () => {
  for (const file of [
    "lib/synopsis-interest/canonical-review-corpus.ts",
    "lib/synopsis-interest/digest-corpus.ts",
  ]) {
    it(`16. ${file} não referencia o store pessoal`, () => {
      const src = read(file)
      for (const marker of PERSONAL_STORE_MARKERS) {
        expect(src.includes(marker), `${file} não pode referenciar "${marker}"`).toBe(false)
      }
    })
  }

  it("digest-corpus consulta as DUAS fontes externas, nunca work_manual_reviews", () => {
    const src = read("lib/synopsis-interest/digest-corpus.ts")
    expect(src).toContain('from("work_reviews")')
    expect(src).toContain('from("work_external_reviews_manual")')
    expect(src.includes("work_manual_reviews")).toBe(false)
  })
})

describe("guard — planner/executor do golden são puros e compartilham o loader canônico", () => {
  it("20. golden-digest (planner+executor) não tem consulta própria a tabelas", () => {
    const src = read("lib/synopsis-interest/golden-digest.ts")
    expect(src.includes(".from(")).toBe(false)
    expect(src.includes("createAdminClient")).toBe(false)
    for (const marker of PERSONAL_STORE_MARKERS) {
      expect(src.includes(marker), `planner/executor não pode referenciar "${marker}"`).toBe(false)
    }
  })

  it("o ÚNICO loader que combina as duas fontes é readCanonicalReviewCorpus", () => {
    const src = read("lib/synopsis-interest/digest-corpus.ts")
    expect(src).toContain("buildCanonicalReviewCorpus")
    expect(src).toContain("export async function readCanonicalReviewCorpus")
    // planner-input e executor-input derivam do MESMO readCanonicalReviewCorpus
    expect(src).toContain("buildCanonicalDigestPlanItem")
    expect(src).toContain("readCanonicalDigestInput")
    const planFn = src.slice(src.indexOf("buildCanonicalDigestPlanItem"))
    expect(planFn).toContain("readCanonicalReviewCorpus")
  })
})

describe("guard — auto-resumo/digest de produção: corpus EXTERNO via loader, nunca o store PESSOAL (B2.2M-AUDIT §5)", () => {
  it("persist-reviews (auto) NÃO importa o loader canônico diretamente", () => {
    const src = read("lib/external/persist-reviews.ts")
    expect(src.includes("digest-corpus")).toBe(false)
    expect(src.includes("readCanonicalReviewCorpus")).toBe(false)
  })
  it("os gateways de produção delegam o corpus ao loader (resumo inclui manual EXTERNA) e nunca consultam o store PESSOAL", () => {
    const src = read("lib/orchestration/integrations/reviews.ts")
    // Resumo e digest delegam a leitura aos loaders centralizados de digest-corpus:
    // readSummaryReviewInputs (resumo, COM manual externa) e readCanonicalReviewCorpus (digest).
    expect(src).toContain("readSummaryReviewInputs")
    expect(src).toContain("readCanonicalReviewCorpus")
    // reviews.ts NÃO consulta as tabelas de review diretamente (centralizado no loader)…
    expect(src.includes('from("work_reviews")')).toBe(false)
    expect(src.includes('from("work_external_reviews_manual")')).toBe(false)
    // …e NUNCA o store PESSOAL — invariante crítica, inalterada.
    expect(src.includes("work_manual_reviews")).toBe(false)
  })
})

describe("guard — script pilot2-base2r1 isolado (B2.2O-fix §10)", () => {
  const FORBIDDEN = [
    "work_manual_reviews",
    "human_label",
    "reading_status",
    "user_score",
    "synopsis_quality_predictions",
    "ranking",
    "review_digest",
  ]
  it("pilot2-base2r1.ts não referencia store pessoal/labels/scores/ranking/digest-substituto", () => {
    const src = read("scripts/pilot2-base2r1.ts")
    for (const marker of FORBIDDEN) {
      expect(src.includes(marker), `pilot2-base2r1.ts não pode referenciar "${marker}"`).toBe(false)
    }
  })
  it("pilot2-base2r1.ts só consome os loaders canônicos (2 fontes externas)", () => {
    const src = read("scripts/pilot2-base2r1.ts")
    expect(src).toContain("readScrapedExternalReviews")
    expect(src).toContain("readManuallyEnteredExternalReviews")
    expect(src).toContain("readCanonicalReviewCorpus")
    // não tem query própria a tabela de review
    expect(src.includes('.from("work_reviews")')).toBe(false)
    expect(src.includes('.from("work_external_reviews_manual")')).toBe(false)
  })
  it("o modo --verify NÃO contém nenhuma escrita de filesystem (zero writes)", () => {
    const src = read("scripts/pilot2-base2r1.ts")
    const start = src.indexOf("async function verify()")
    const end = src.indexOf("async function main(")
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const verifyBody = src.slice(start, end)
    for (const writer of ["writeFileSync", "renameSync", "mkdirSync", "rmSync", "atomicWrite"]) {
      expect(verifyBody.includes(writer), `verify() não pode chamar ${writer}`).toBe(false)
    }
  })
})

describe("guard — preflight pilot2-preflight isolado (B2.2P §9)", () => {
  const FORBIDDEN = [
    "work_manual_reviews",
    "human_label",
    "reading_status",
    "user_score",
    "synopsis_quality_predictions",
    "ranking",
    "candidate",
    "alignment",
    "predictions",
  ]
  it("pilot2-preflight.ts não referencia store pessoal/labels/scores/ranking/predictions", () => {
    const src = read("scripts/pilot2-preflight.ts")
    for (const marker of FORBIDDEN) {
      expect(src.includes(marker), `pilot2-preflight.ts não pode referenciar "${marker}"`).toBe(false)
    }
  })
  it("pilot2-preflight.ts lê SÓ colunas de digest de works + o snapshot frozen (não reconstrói corpus)", () => {
    const src = read("scripts/pilot2-preflight.ts")
    expect(src).toContain('.from("works")')
    expect(src).toContain("review_digest")
    // não consulta tabelas de review nem usa o digest como substituto do corpus
    expect(src.includes('from("work_reviews")')).toBe(false)
    expect(src.includes('from("work_external_reviews_manual")')).toBe(false)
    expect(src.includes("readCanonicalReviewCorpus")).toBe(false)
  })
  it("a lib pura do preflight não importa banco/server-only", () => {
    const src = read("lib/synopsis-interest/pilot2-preflight.ts")
    expect(src.includes("server-only")).toBe(false)
    expect(src.includes("createAdminClient")).toBe(false)
    expect(src.includes(".from(")).toBe(false)
  })
})

describe("guard — prompt text-only do digest experimental (B2.2P §6)", () => {
  it("o INPUT canônico do digest (readCanonicalDigestInput) é text-only: fonte uniforme + sem nota pessoal", () => {
    const src = read("lib/synopsis-interest/digest-corpus.ts")
    // fonte UNIFORME (sem fonte real no prompt) e userRating SEMPRE null (sem sinal pessoal)
    expect(src).toContain("EXPERIMENT_DIGEST_SOURCE")
    expect(src).toContain("userRating: null")
  })
  it("RESSALVA documentada: o prompt de PRODUÇÃO ([source #N]) é source-aware — NÃO é text-only", () => {
    // Guard de regressão: enquanto não existir um prompt [Review N] dedicado, o produtor de
    // produção permanece source-aware. Este teste fixa o fato (o preflight reporta como ressalva).
    const src = read("lib/ai-recommendation/review-summarizer.ts")
    expect(src.includes("[${r.source} #${i + 1}]")).toBe(true) // ainda source-aware (v0)
  })
})

describe("guard — contrato/executor digest text-only-v1 isolado (B2.2Q-fix §14/§15)", () => {
  const TEXT_ONLY_FILES = [
    "lib/synopsis-interest/digest-text-only.ts",
    "lib/synopsis-interest/digest-text-only-runner.ts",
    "lib/synopsis-interest/digest-text-only-adapter.ts",
    "scripts/pilot2-digest-contract.ts",
  ]
  // stores PESSOAIS/derivados proibidos (bare "review_digest" é label de log no adapter ⇒ checado por coluna)
  const FORBIDDEN_STORES = [
    "work_manual_reviews", "human_label", "user_score", "reading_status",
    "predictions", "ranking", "candidate", "alignment", "review_summary",
  ]
  for (const f of TEXT_ONLY_FILES) {
    it(`${f} não acessa store proibido nem colunas works.review_digest*`, () => {
      const src = read(f)
      for (const marker of FORBIDDEN_STORES) {
        expect(src.includes(marker), `${f} não pode referenciar "${marker}"`).toBe(false)
      }
      // nunca persiste/lê o digest de produção
      expect(src.includes("review_digest_version"), `${f} não pode tocar works.review_digest_version`).toBe(false)
      expect(src.includes("review_digest_n"), `${f} não pode tocar works.review_digest_n`).toBe(false)
      expect(src.includes('.from("works")'), `${f} não pode escrever em works`).toBe(false)
    })
  }
  it("runner/contrato NÃO importam o executor de produção nem a Anthropic", () => {
    for (const f of ["lib/synopsis-interest/digest-text-only-runner.ts", "lib/synopsis-interest/digest-text-only.ts"]) {
      const src = read(f)
      for (const old of ["ensureReviewDigest", "persistReviewDigest", "consolidateReviewsDigestDetailed"]) {
        expect(src.includes(old), `${f} não pode chamar ${old}`).toBe(false)
      }
      expect(src.includes("createAdminClient")).toBe(false)
      expect(src.includes(".from(")).toBe(false)
      expect(src.includes("anthropic-client"), `${f} não importa o boundary Anthropic`).toBe(false)
      expect(src.includes("@anthropic-ai/sdk")).toBe(false)
    }
  })
  it("o adapter real carrega a Anthropic SÓ por import dinâmico (sem efeito colateral/rede no import)", () => {
    const src = read("lib/synopsis-interest/digest-text-only-adapter.ts")
    expect(src).toContain("createAnthropicDigestAdapter")
    expect(src).toContain("await import(") // boundary lazy
    // sem import estático do boundary/SDK no topo
    expect(src.includes('from "@/lib/ai/anthropic-client"')).toBe(false)
    expect(src.includes('from "@anthropic-ai/sdk"')).toBe(false)
    expect(src.includes("server-only")).toBe(false)
    // não recai no executor antigo nem persiste no banco
    for (const old of ["ensureReviewDigest", "persistReviewDigest", "consolidateReviewsDigestDetailed", "createAdminClient"]) {
      expect(src.includes(old)).toBe(false)
    }
  })
  it("o contrato/runner/adapter não importam server-only estático", () => {
    for (const f of TEXT_ONLY_FILES) expect(read(f).includes("server-only"), f).toBe(false)
  })
  it("o prompt experimental não contém tokens de metadado ([source/source:/origin:/rating:/userRating)", () => {
    const src = read("lib/synopsis-interest/digest-text-only.ts")
    for (const leak of ["[source", "source:", "origin:", "rating:", "userRating"]) {
      expect(src.includes(leak), `prompt não pode conter "${leak}"`).toBe(false)
    }
    expect(src).toContain("[Review ")
  })
})

describe("guard — comparador canônico locale-independente (B2.2R §9)", () => {
  // O caminho de ordenação de TEXTO do experimento NÃO pode depender de locale/ICU: a seleção das
  // ≤40 e a ordem do corpus/prompt têm de ser reprodutíveis em qualquer máquina. Proíbe
  // localeCompare/Intl.Collator no CÓDIGO (comentários são removidos por read()).
  for (const file of [
    "lib/synopsis-interest/canonical-review-corpus.ts",
    "lib/synopsis-interest/digest-text-only.ts",
  ]) {
    it(`${file} não usa localeCompare nem Intl.Collator (ordena por compareCanonicalText)`, () => {
      const src = read(file)
      expect(src.includes("localeCompare"), `${file} não pode usar localeCompare`).toBe(false)
      expect(src.includes("Intl.Collator"), `${file} não pode usar Intl.Collator`).toBe(false)
      expect(src).toContain("compareCanonicalText")
    })
  }
  it("a selectionPolicyVersion declara ordem por code-unit (não-locale)", () => {
    const src = read("lib/synopsis-interest/digest-text-only.ts")
    expect(src).toContain("normalized-text-js-code-unit-order-cap40-v1")
    expect(src.includes("normalized-text-order-cap40-v1\"")).toBe(false) // versão antiga aposentada
  })
})

describe("guard — Server Actions e gate", () => {
  it("6. as Server Actions executam o gate local", () => {
    const src = read("server/actions/external-manual-reviews.ts")
    expect(src).toContain("assertLocalExternalReviewEditorAllowed")
    // grava só no canal externo; nunca no store pessoal
    expect(src).toContain('from("work_external_reviews_manual")')
    expect(src.includes("work_manual_reviews")).toBe(false)
  })

  it("7. módulos CLIENT não tocam na service-role key", () => {
    for (const file of [
      "components/titles/external-manual-reviews-section.tsx",
      "components/titles/reviews-editor.tsx",
      "lib/validations/external-review.schema.ts",
    ]) {
      const src = read(file)
      expect(src.includes("SUPABASE_SERVICE_ROLE_KEY"), `${file} não pode citar a service key`).toBe(false)
      expect(src.includes("createAdminClient"), `${file} não pode criar admin client`).toBe(false)
    }
  })

  it("schema é client-safe (sem node:crypto)", () => {
    const src = read("lib/validations/external-review.schema.ts")
    expect(src.includes("node:crypto")).toBe(false)
    expect(src.includes("canonical-review-corpus")).toBe(false)
  })
})
