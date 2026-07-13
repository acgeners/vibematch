"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { ensureAdmin } from "@/server/queries/current-user"
import { TASTE_SCORE_KEYS } from "@/server/queries/pilot-taste"
import type { TasteScoreKey } from "@/server/queries/pilot-taste"

const ALLOWED = new Set<number>([2, 4, 6.5, 8, 10])

/**
 * Salva (upsert) as notas de gosto de UMA obra no piloto. O cliente manda o
 * estado completo da obra a cada mudança (autosave idempotente).
 */
export async function savePilotTaste(
  workId: string,
  scores: Partial<Record<TasteScoreKey, number | null>>,
  endingNa: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // `pilot_taste_scores` NÃO tem user_id: a tabela é GLOBAL. Enquanto for, escrever nela
  // é escrever no experimento do dono — logo, é curadoria, não dado pessoal.
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }

  if (!workId) return { ok: false, error: "workId ausente" }

  const row: Record<string, unknown> = {
    work_id: workId,
    ending_na: endingNa,
    updated_at: new Date().toISOString(),
  }
  for (const k of TASTE_SCORE_KEYS) {
    const v = scores[k]
    if (v != null && !ALLOWED.has(v)) {
      return { ok: false, error: `valor inválido em ${k}: ${v}` }
    }
    row[k] = v ?? null
  }

  const sb = createAdminClient()
  const { error } = await sb.from("pilot_taste_scores").upsert(row, { onConflict: "work_id" })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
