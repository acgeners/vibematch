/**
 * Constrói a CHAVE canônica de cache de um resultado de IA (plano §6).
 *
 * A chave inclui, quando relevante: operation, conteúdo canônico, model,
 * prompt_version, output_schema_version, parâmetros relevantes e feature flags.
 * Parâmetros que NÃO influenciam o output não devem ser passados.
 *
 * `null`, ausente e "" são distinguidos (ver canonicalize). A serialização é
 * determinística — a mesma entrada sempre gera o mesmo hash.
 *
 * Função PURA. Usa node:crypto (sha256); sem banco, sem Date, sem random.
 */

import { createHash } from "node:crypto"
import { canonicalize, stableStringify } from "./canonicalize"
import type { AiCacheKeyInput } from "./types"

/** Objeto canônico (pré-hash) — útil pra debug/teste de igualdade estrutural. */
export function buildCacheKeyObject(input: AiCacheKeyInput): Record<string, unknown> {
  return {
    operation: input.operation,
    model: input.model,
    // null e ausente são distinguidos: passamos null explicitamente quando
    // a versão não existe (canonicalize mantém null e omite undefined).
    prompt_version: input.promptVersion,
    output_schema_version: input.outputSchemaVersion,
    input: canonicalize(input.input),
    parameters: input.relevantParameters ? canonicalize(input.relevantParameters) : undefined,
    feature_flags: input.featureFlags ? canonicalize(input.featureFlags) : undefined,
  }
}

/** Hash sha256 (hex) da chave canônica. */
export function buildCacheKey(input: AiCacheKeyInput): string {
  const serialized = stableStringify(buildCacheKeyObject(input))
  return createHash("sha256").update(serialized).digest("hex")
}
