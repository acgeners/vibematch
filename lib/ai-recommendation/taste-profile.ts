import "server-only"
import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { MODEL, PROMPT_VERSION } from "./service"
import type { RatedWorkInput, TasteProfilePayload, TasteProfileRow } from "./types"

export const MIN_WORKS_FOR_FULL_PROFILE = 10
export const MIN_WORKS_FOR_ANY_PROFILE = 5

export function computeInputHash(works: RatedWorkInput[]): string {
  const canonical = works
    .map((w) => ({
      id: w.id,
      manualScore: w.manualScore,
      postScores: Object.fromEntries(
        Object.entries(w.postScores)
          .filter(([, v]) => v != null)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      categoryScores: Object.fromEntries(
        Object.entries(w.categoryScores)
          .filter(([, v]) => v != null)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      tags: [...w.tags].map((t) => `${t.group ?? ""}::${t.name}`).sort(),
      personalStatus: w.personalStatus ?? null,
      synopsisLen: w.synopsis?.length ?? 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const payload = JSON.stringify({
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    works: canonical,
  })
  return createHash("sha256").update(payload).digest("hex")
}

function rowToTasteProfile(row: Record<string, unknown>): TasteProfileRow {
  return {
    id: row.id as string,
    version: row.version as number,
    is_current: row.is_current as boolean,
    is_stub: row.is_stub as boolean,
    n_works_used: row.n_works_used as number,
    input_hash: row.input_hash as string,
    model_name: row.model_name as string,
    prompt_version: row.prompt_version as string,
    profile: row.profile as TasteProfilePayload,
    raw_response: row.raw_response,
    created_at: row.created_at as string,
  }
}

export async function loadCurrentTasteProfile(): Promise<TasteProfileRow | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("taste_profile")
    .select("*")
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error("[taste-profile] erro lendo perfil atual:", error)
    return null
  }
  if (!data) return null
  return rowToTasteProfile(data as Record<string, unknown>)
}

async function nextVersion(): Promise<number> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("taste_profile")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  const current = (data?.version as number | undefined) ?? 0
  return current + 1
}

async function markAllProfilesAsStale(): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from("taste_profile")
    .update({ is_current: false })
    .eq("is_current", true)
}

export interface InsertTasteProfileArgs {
  profile: TasteProfilePayload
  nWorks: number
  inputHash: string
  isStub: boolean
  modelName: string
  promptVersion: string
  rawResponse: unknown
}

export async function insertNewTasteProfile(
  args: InsertTasteProfileArgs,
): Promise<TasteProfileRow> {
  await markAllProfilesAsStale()
  const supabase = createAdminClient()
  const version = await nextVersion()
  const { data, error } = await supabase
    .from("taste_profile")
    .insert({
      version,
      is_current: true,
      is_stub: args.isStub,
      n_works_used: args.nWorks,
      input_hash: args.inputHash,
      model_name: args.modelName,
      prompt_version: args.promptVersion,
      profile: args.profile,
      raw_response: args.rawResponse,
    })
    .select("*")
    .single()
  if (error || !data) {
    throw new Error(`Erro persistindo perfil de gosto: ${error?.message ?? "desconhecido"}`)
  }
  return rowToTasteProfile(data as Record<string, unknown>)
}

/**
 * Perfil mínimo quando o usuário ainda não avaliou obras suficientes pra uma
 * análise IA fiável. Não chama Claude — apenas declara baixa confiança.
 */
export function buildStubProfile(nWorks: number): TasteProfilePayload {
  return {
    loved_tags: [],
    avoided_tags: [],
    loved_themes: [],
    avoided_themes: [],
    criterion_preferences: {},
    narrative_patterns: [],
    summary:
      nWorks === 0
        ? "Você ainda não avaliou obras com nota pessoal. Avalie alguns títulos pra eu identificar seu gosto."
        : `Apenas ${nWorks} obra(s) avaliada(s) — abaixo do mínimo (${MIN_WORKS_FOR_FULL_PROFILE}) pra uma análise rica. Avalie mais títulos pra refinar o perfil.`,
  }
}
