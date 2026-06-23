/**
 * Plano 3 Fase B2.2Q — Contrato CONGELADO do digest experimental `text-only-v1`. PURO: sem banco,
 * sem rede, sem `server-only`, sem LLM (import sem efeito colateral). Define versões, prompt
 * `[Review N]` (0 metadados), schema Zod, e as três assinaturas (input/output/contract).
 *
 * NAMESPACE EXPERIMENTAL explícito — NÃO toca o pipeline de produção source-aware
 * (`consolidateReviewsDigestDetailed`, `ensureReviewDigest`, `persistReviewDigest`,
 * `works.review_digest*`). NÃO lê store pessoal/labels/status/scores/predictions/ranking.
 */

import { createHash } from "node:crypto"
import { z } from "zod"
import { REVIEW_CORPUS_POLICY_VERSION, normalizeReviewText, computeNormalizedTextHash, compareCanonicalText } from "@/lib/synopsis-interest/canonical-review-corpus"

// ── Versões CONGELADAS (§4) — NÃO reutilizar "digest-v1" (não distingue source-aware) ──
export const EXPERIMENT_DIGEST_VERSION = "digest-text-only-v1"
export const EXPERIMENT_DIGEST_PROMPT_VERSION = "digest-prompt-text-only-v1"
export const EXPERIMENT_DIGEST_SCHEMA_VERSION = "review-digest-schema-v1"
export const EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION = "normalized-text-js-code-unit-order-cap40-v1"
export const EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION = REVIEW_CORPUS_POLICY_VERSION // "text-only-v1"
export const EXPERIMENT_DIGEST_MODEL = "claude-sonnet-4-6"
export const EXPERIMENT_DIGEST_CAP = 40

// Parâmetros materiais do modelo (B2.2Q-fix §8) — explícitos e congelados.
export const EXPERIMENT_DIGEST_MAX_TOKENS = 2000
export const EXPERIMENT_DIGEST_TEMPERATURE = 0.2
/** Política de temperatura EXPLÍCITA (sonnet-4-6 aceita temperature com tool_use). */
export const EXPERIMENT_DIGEST_TEMPERATURE_POLICY = "explicit-0.2"
export const EXPERIMENT_DIGEST_PRICING_VERSION = "anthropic-sonnet-4-6-pricing-v1"

/** Versão da canonicalização do TEXTO enviado ao modelo (preserva caixa) — B2.2Q-fix §3/§11. */
export const PROMPT_TEXT_CANONICALIZATION_VERSION = "prompt-text-nfc-whitespace-preserve-case-v1"
/** Identidades explícitas de implementação (evita hash ingênuo de arquivo). */
export const ADAPTER_IMPLEMENTATION_VERSION = "anthropic-digest-adapter-v1"
export const STORAGE_CONTRACT_VERSION = "digest-storage-v1"
export const RUNNER_CONTRACT_VERSION = "digest-runner-v1"

const sha256 = (o: unknown): string => createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex")

/**
 * Canonicaliza o TEXTO efetivamente enviado ao modelo (B2.2Q-fix §3). PRESERVA caixa e pontuação;
 * só `trim` → NFC → colapso determinístico de whitespace (incl. quebras de linha) em 1 espaço.
 * NÃO reescreve/resume/traduz/corrige/lowercaseia/adiciona metadado. Mesma entrada ⇒ mesmos bytes.
 * (Distinta de `normalizeReviewText`, que lowercaseia e serve só p/ identidade/dedupe/assinaturas.)
 */
export function canonicalizeReviewPromptText(text: string): string {
  return (text ?? "").trim().normalize("NFC").replace(/\s+/g, " ")
}

// ── Prompt text-only (§7) ────────────────────────────────────────────────────

/** System prompt do digest experimental — descritivo, SEM fonte/nota/recomendação/predição. */
export const TEXT_ONLY_DIGEST_SYSTEM_PROMPT = [
  "Você destila um digest descritivo de um conjunto de reviews de uma obra.",
  "As reviews são apresentadas SOMENTE como texto, numeradas [Review N], sem fonte, nota, autor ou data.",
  "Não infira nem mencione fonte, plataforma, nota numérica, recomendação pessoal ou previsão de interesse.",
  "Produza apenas consensos, divergências, pontos positivos/negativos recorrentes, características narrativas",
  "percebidas e avisos de conteúdo recorrentes. Use a tool `submit_text_only_digest`.",
].join(" ")

/**
 * Monta o corpo `[Review N]` a partir dos textos JÁ selecionados e na ordem canônica. NÃO inclui
 * source/origin/nota/URL/id/idioma/data/contagem-por-fonte. Recebe SÓ strings de texto.
 */
export function buildTextOnlyDigestPromptBody(orderedTexts: string[]): string {
  return orderedTexts.map((t, i) => `[Review ${i + 1}]\n${t}`).join("\n\n")
}

export function buildTextOnlyDigestPrompt(orderedTexts: string[]): { system: string; user: string } {
  const body = buildTextOnlyDigestPromptBody(orderedTexts)
  const user = `Destile o digest estruturado das ${orderedTexts.length} review(s) abaixo. Use a tool \`submit_text_only_digest\`.\n\n${body}`
  return { system: TEXT_ONLY_DIGEST_SYSTEM_PROMPT, user }
}

/** Hash do TEMPLATE do prompt (system + esqueleto), independente do conteúdo das reviews. */
export const PROMPT_TEMPLATE_HASH = sha256({
  promptVersion: EXPERIMENT_DIGEST_PROMPT_VERSION,
  system: TEXT_ONLY_DIGEST_SYSTEM_PROMPT,
  // esqueleto canônico de 2 itens (marca o formato [Review N] sem texto real)
  skeleton: buildTextOnlyDigestPromptBody(["{{TEXT_1}}", "{{TEXT_2}}"]),
})

// ── Schema de saída (§8) — descritivo, sem fonte/nota/score/recomendação/predição/label ──

export const textOnlyDigestSchema = z.object({
  consensus: z.string(),
  divergence: z.string(),
  recurring_positives: z.array(z.string()),
  recurring_negatives: z.array(z.string()),
  narrative_traits: z.array(z.string()),
  content_warnings: z.array(z.string()),
})
export type TextOnlyDigest = z.infer<typeof textOnlyDigestSchema>

/** JSON Schema da tool (espelha o Zod) — usado pelo adapter REAL (referenciado, não invocado). */
export const TEXT_ONLY_DIGEST_TOOL = {
  name: "submit_text_only_digest",
  description: "Digest descritivo text-only de um conjunto de reviews (sem fonte/nota/recomendação).",
  input_schema: {
    type: "object" as const,
    properties: {
      consensus: { type: "string" },
      divergence: { type: "string" },
      recurring_positives: { type: "array", items: { type: "string" } },
      recurring_negatives: { type: "array", items: { type: "string" } },
      narrative_traits: { type: "array", items: { type: "string" } },
      content_warnings: { type: "array", items: { type: "string" } },
    },
    required: ["consensus", "divergence", "recurring_positives", "recurring_negatives", "narrative_traits", "content_warnings"],
    additionalProperties: false,
  },
}

export const SCHEMA_HASH = sha256({ schemaVersion: EXPERIMENT_DIGEST_SCHEMA_VERSION, schema: TEXT_ONLY_DIGEST_TOOL.input_schema })

/** Canonicaliza o output validado (ordem de chaves fixa; arrays preservam a ordem do modelo). */
export function canonicalizeDigest(d: TextOnlyDigest): string {
  return JSON.stringify({
    consensus: d.consensus,
    divergence: d.divergence,
    recurring_positives: d.recurring_positives,
    recurring_negatives: d.recurring_negatives,
    narrative_traits: d.narrative_traits,
    content_warnings: d.content_warnings,
  })
}

export type ParseDigestResult = { ok: true; digest: TextOnlyDigest } | { ok: false; error: string }

/** Valida a resposta do modelo (Zod, fail-closed). Falha NÃO produz output parcial válido. */
export function parseDigestOutput(raw: unknown): ParseDigestResult {
  const r = textOnlyDigestSchema.safeParse(raw)
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }
  return { ok: true, digest: r.data }
}

// ── Assinaturas (§9) ──────────────────────────────────────────────────────────

/** Assinatura GLOBAL do contrato (independe de obra). Inclui canonicalização do prompt e
 * parâmetros materiais do modelo (B2.2Q-fix §11). */
export function computeDigestContractSignature(): string {
  return sha256({
    kind: "digest-contract",
    digestVersion: EXPERIMENT_DIGEST_VERSION,
    promptVersion: EXPERIMENT_DIGEST_PROMPT_VERSION,
    promptTemplateHash: PROMPT_TEMPLATE_HASH,
    schemaVersion: EXPERIMENT_DIGEST_SCHEMA_VERSION,
    schemaHash: SCHEMA_HASH,
    corpusPolicyVersion: EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
    selectionPolicyVersion: EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
    promptTextCanonicalizationVersion: PROMPT_TEXT_CANONICALIZATION_VERSION,
    model: EXPERIMENT_DIGEST_MODEL,
    maxTokens: EXPERIMENT_DIGEST_MAX_TOKENS,
    temperaturePolicy: EXPERIMENT_DIGEST_TEMPERATURE_POLICY,
  })
}

/** Assinatura da IMPLEMENTAÇÃO executável (B2.2Q-fix §10) — identidade explícita das versões. */
export function computeDigestImplementationSignature(): string {
  return sha256({
    kind: "digest-implementation",
    digestContractSignature: computeDigestContractSignature(),
    adapterImplementationVersion: ADAPTER_IMPLEMENTATION_VERSION,
    model: EXPERIMENT_DIGEST_MODEL,
    maxTokens: EXPERIMENT_DIGEST_MAX_TOKENS,
    temperaturePolicy: EXPERIMENT_DIGEST_TEMPERATURE_POLICY,
    pricingVersion: EXPERIMENT_DIGEST_PRICING_VERSION,
    schemaHash: SCHEMA_HASH,
    promptTemplateHash: PROMPT_TEMPLATE_HASH,
    storageContractVersion: STORAGE_CONTRACT_VERSION,
    runnerContractVersion: RUNNER_CONTRACT_VERSION,
  })
}

export interface DigestInputSignatureArgs {
  workId: string
  base2r1Signature: string
  reviewCorpusSignature: string
  digestSelectionSignature: string
  /** Assinatura do corpus EXATO de prompt (caixa preservada) — B2.2Q-fix §5. */
  digestPromptCorpusSignature: string
  /** Assinatura global do contrato (vincula prompt/schema/params do modelo). */
  digestContractSignature: string
}

/** Assinatura por obra do INPUT — vincula obra + base-2r1 + corpus/seleção + corpus EXATO de
 * prompt + contrato. SEM timestamps nem reviewIds. */
export function computeDigestInputSignature(args: DigestInputSignatureArgs): string {
  return sha256({
    kind: "digest-input",
    workId: args.workId,
    base2r1Signature: args.base2r1Signature,
    reviewCorpusSignature: args.reviewCorpusSignature,
    digestSelectionSignature: args.digestSelectionSignature,
    digestPromptCorpusSignature: args.digestPromptCorpusSignature,
    digestContractSignature: args.digestContractSignature,
    corpusPolicyVersion: EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
    selectionPolicyVersion: EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
    promptVersion: EXPERIMENT_DIGEST_PROMPT_VERSION,
    digestVersion: EXPERIMENT_DIGEST_VERSION,
    model: EXPERIMENT_DIGEST_MODEL,
    schemaVersion: EXPERIMENT_DIGEST_SCHEMA_VERSION,
  })
}

/** Assinatura do OUTPUT — vincula o inputSignature ao output validado/canonicalizado. */
export function computeDigestOutputSignature(digestInputSignature: string, digest: TextOnlyDigest): string {
  return sha256({ kind: "digest-output", digestInputSignature, output: canonicalizeDigest(digest) })
}

// ── Seleção das ≤40 (§6) — text-only puro, ordem por texto normalizado ─────────

export interface SelectedReviewText {
  /** Texto CANÔNICO de prompt (caixa preservada) efetivamente enviado ao modelo. */
  promptText: string
  /** Hash do texto NORMALIZADO (lowercase) — trava na seleção congelada do base-2r1. */
  normalizedHash: string
}

/**
 * Seleção determinística text-only a partir das reviews canônicas (já úteis). Dedup por texto
 * NORMALIZADO (lowercase), ordem por texto normalizado, `cap`. Representante de cada grupo de
 * duplicatas = MENOR `canonicalizeReviewPromptText` lexicográfico (regra text-only, SEM
 * source/origin/reviewId/data/ordem-DB). Retorna o texto de prompt (caixa preservada) + o hash
 * normalizado (invariante ao representante ⇒ casa com `digestSelectionNormalizedHashes` congelado).
 */
export function selectTextOnly(reviews: Array<{ text: string }>, cap = EXPERIMENT_DIGEST_CAP): SelectedReviewText[] {
  const groups = new Map<string, string[]>() // normalizado → textos de prompt canônicos do grupo
  for (const r of reviews) {
    const norm = normalizeReviewText(r.text)
    if (!norm) continue
    const canon = canonicalizeReviewPromptText(r.text)
    const g = groups.get(norm)
    if (g) g.push(canon)
    else groups.set(norm, [canon])
  }
  // Ordem dos grupos por texto NORMALIZADO via `compareCanonicalText` (code-unit UTF-16,
  // locale-independente; NÃO `localeCompare`/`Intl.Collator`) — casa com a ordem congelada do
  // base-2r1 (canonical-review-corpus). Representante = MENOR texto canônico pelo MESMO comparador
  // (determinístico/reprodutível): SEM source/origin/reviewId/data/ordem-DB.
  return [...groups.keys()]
    .sort(compareCanonicalText)
    .slice(0, cap)
    .map((norm) => {
      const promptText = [...groups.get(norm)!].sort(compareCanonicalText)[0] // menor lexicográfico (code-unit)
      return { promptText, normalizedHash: computeNormalizedTextHash(promptText) }
    })
}

/**
 * Assinatura do CORPUS EXATO de prompt (B2.2Q-fix §4) — depende SÓ de `corpusPolicyVersion` +
 * `promptVersion` + a lista ordenada dos textos EXATOS após `canonicalizeReviewPromptText`. Muda
 * com caixa/pontuação/whitespace/quebra/ordem/quantidade. NÃO depende de id/source/origin/URL/
 * autor/idioma/data/ordem-DB.
 */
export function computeDigestPromptCorpusSignature(promptTexts: string[]): string {
  return sha256({
    kind: "digest-prompt-corpus",
    corpusPolicyVersion: EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
    promptVersion: EXPERIMENT_DIGEST_PROMPT_VERSION,
    promptTexts,
  })
}

// ── Validação do input congelado (§5) ─────────────────────────────────────────

export interface FrozenWorkInput {
  reviewCorpusSignature: string
  digestSelectionSignature: string
  digestSelectionNormalizedHashes: string[]
}
export interface CurrentWorkInput {
  reviewCorpusSignature: string
  digestSelectionSignature: string
  selectedNormalizedHashes: string[]
}
export type FrozenInputCheck = { ok: true } | { ok: false; reason: "input_changed"; detail: string }

/** Confirma que o estado ATUAL bate com o base-2r1 congelado (assinaturas + hashes selecionados).
 * Diferença ⇒ `input_changed` (NÃO chamar o modelo). */
export function checkFrozenInput(frozen: FrozenWorkInput, current: CurrentWorkInput): FrozenInputCheck {
  if (frozen.reviewCorpusSignature !== current.reviewCorpusSignature) return { ok: false, reason: "input_changed", detail: "reviewCorpusSignature" }
  if (frozen.digestSelectionSignature !== current.digestSelectionSignature) return { ok: false, reason: "input_changed", detail: "digestSelectionSignature" }
  const a = frozen.digestSelectionNormalizedHashes
  const b = current.selectedNormalizedHashes
  if (a.length !== b.length || a.some((h, i) => h !== b[i])) return { ok: false, reason: "input_changed", detail: "selectionNormalizedHashes" }
  return { ok: true }
}

// ── Adapter do modelo (§11) — interface injetável; REAL referenciado, não invocado ──

export interface DigestModelInput {
  system: string
  user: string
  model: string
}
export interface DigestModelTokenUsage {
  inputTokens: number
  outputTokens: number
}
export interface DigestModelOutput {
  raw: unknown // input bruto da tool (validado depois por Zod)
  model: string
  usage?: DigestModelTokenUsage
}
export interface DigestModelAdapter {
  generate(input: DigestModelInput): Promise<DigestModelOutput>
}

/**
 * Monta o REQUEST do modelo (params Anthropic) de forma PURA — objeto simples, sem importar o SDK.
 * Usa model/maxTokens/temperature/tool/schema congelados. Testável sem rede.
 */
export function buildDigestModelRequest(input: DigestModelInput): {
  model: string
  max_tokens: number
  temperature: number
  system: string
  messages: Array<{ role: "user"; content: string }>
  tools: Array<typeof TEXT_ONLY_DIGEST_TOOL>
  tool_choice: { type: "tool"; name: string }
} {
  return {
    model: input.model,
    max_tokens: EXPERIMENT_DIGEST_MAX_TOKENS,
    temperature: EXPERIMENT_DIGEST_TEMPERATURE,
    system: input.system,
    messages: [{ role: "user", content: input.user }],
    tools: [TEXT_ONLY_DIGEST_TOOL],
    tool_choice: { type: "tool", name: TEXT_ONLY_DIGEST_TOOL.name },
  }
}

/** Extrai o input bruto da tool `submit_text_only_digest` de uma message-like. Ausência ⇒ null. */
export function extractDigestToolInput(message: { content?: Array<{ type?: string; name?: string; input?: unknown }> } | null | undefined): unknown | null {
  const block = message?.content?.find((b) => b?.type === "tool_use" && b?.name === TEXT_ONLY_DIGEST_TOOL.name)
  return block ? (block.input ?? null) : null
}
