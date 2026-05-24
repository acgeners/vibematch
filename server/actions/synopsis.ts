"use server"

import { consolidateSynopsisDetailed } from "@/lib/ai-recommendation/synopsis-consolidator"

export interface CanonicalSynopsisPreviewResult {
  canonical?: string
  error?: string
}

export async function previewCanonicalSynopsis(
  blocks: string[],
): Promise<CanonicalSynopsisPreviewResult> {
  const status = await consolidateSynopsisDetailed(blocks, {})
  if (status.kind === "ok") return { canonical: status.result.canonical }
  if (status.kind === "skipped") {
    if (status.reason === "no_content")
      return { error: "Nenhum bloco de sinopse com conteúdo suficiente para consolidar." }
    return { error: "Anthropic API key não configurada." }
  }
  return { error: status.error }
}
