"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureReadingStateWriter, writeReadingState } from "@/server/queries/user-work-state"
import { ensurePermission } from "@/server/queries/current-user"
import { markRecalcPending } from "@/server/recalc/queue"
import { recalculateForUser } from "@/server/recalc/user-recalc"
import {
  getPersonalStatusIdByName,
  getPublicationStatusIdByName,
} from "@/lib/constants/status-lookups"
import {
  decodeContent,
  detectSource,
  parseExternalList,
  parseAniListList,
} from "@/lib/import/external-list/parsers"
import { fetchAniListUserMangaList } from "@/lib/external/anilist"
import {
  buildMatchContext,
  matchEntry,
  buildChanges,
  findTrgmCandidates,
  type DbWork,
  type MatchContext,
  type MatchOutcome,
} from "@/lib/import/external-list/matcher"
import type { PersonalStatus } from "@/types/domain"
import type {
  AnalyzeExternalListResult,
  CommitExternalListResult,
  ExternalListDecisions,
  ExternalListEntry,
  ExternalListSource,
  FieldChange,
  MatchPlan,
  ReconciliationBuckets,
} from "@/lib/import/external-list/types"
import { DEFAULT_PERSONAL_STATUS } from "@/lib/constants/criteria"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any

export interface ExternalListInput {
  filename: string
  // Vazio quando source === "anilist" (a lista vem da API, não de arquivo).
  contentBase64: string
  source?: ExternalListSource
  // Só para source === "anilist": nome de usuário público do AniList.
  username?: string
}

const FILE_TYPE: Record<ExternalListSource, string> = {
  myanimelist: "mal_json",
  mangaupdates: "mu_json",
  animeplanet: "mal_xml",
  anilist: "anilist_user",
  titles: "titles_paste",
  comix: "comix_xml",
}

async function resolveEntries(input: ExternalListInput): Promise<{
  source: ExternalListSource
  entries: ExternalListEntry[]
}> {
  // AniList: sem arquivo — busca a lista pública pela API.
  if (input.source === "anilist") {
    const username = input.username?.trim()
    if (!username) throw new Error("Informe seu nome de usuário do AniList.")
    const raw = await fetchAniListUserMangaList(username)
    if (raw === null) {
      throw new Error(
        "Não foi possível buscar a lista no AniList. Confira o nome de usuário e se a lista está pública."
      )
    }
    return { source: "anilist", entries: parseAniListList(raw) }
  }

  const text = decodeContent(input.contentBase64)
  const source = input.source ?? detectSource(text)
  if (!source) {
    throw new Error("Não foi possível detectar o formato do arquivo (MAL JSON, MangaUpdates JSON ou XML).")
  }
  return { source, entries: parseExternalList(text, source) }
}

// matchEntry (Jaccard em memória) + rede de segurança por pg_trgm para as que
// caíram como "novas" — evita criar duplicata quando o título diverge do salvo.
// Determinístico → analyze e commit classificam igual.
async function classifyEntry(
  supabase: AnySupabaseClient,
  entry: ExternalListEntry,
  ctx: MatchContext
): Promise<MatchOutcome> {
  const outcome = matchEntry(entry, ctx)
  if (outcome.kind !== "new") return outcome
  const candidates = await findTrgmCandidates(supabase, entry.title)
  if (candidates.length > 0) return { kind: "ambiguous", candidates }
  return { kind: "new" }
}

// ── Analyze ──────────────────────────────────────────────────────────
export async function analyzeExternalListImport(
  input: ExternalListInput
): Promise<{ error?: string; data?: AnalyzeExternalListResult }> {
  // Multi-user (Bloco 02): o import é de QUEM ESTÁ LOGADO — a lista, as notas e o
  // status vão pro estado pessoal de quem importa; o que é catálogo (obra criada)
  // é compartilhado. Mesmo gate do resto do estado pessoal (sessão + own_state).
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: gate.error }
  try {
    const { source, entries } = await resolveEntries(input)
    const supabase = createAdminClient()
    const ctx = await buildMatchContext(supabase, gate.userId)

    const buckets: ReconciliationBuckets = {
      autoUpdate: [],
      conflicts: [],
      ambiguous: [],
      creates: [],
      unchangedCount: 0,
    }

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex]
      const outcome = await classifyEntry(supabase, entry, ctx)

      if (outcome.kind === "new") {
        buckets.creates.push({ entryIndex, entry })
        continue
      }
      if (outcome.kind === "ambiguous") {
        buckets.ambiguous.push({ entryIndex, entry, candidates: outcome.candidates })
        continue
      }

      const changes = buildChanges(entry, outcome.work)
      if (changes.length === 0) {
        buckets.unchangedCount++
        continue
      }
      const plan: MatchPlan = {
        entryIndex,
        workId: outcome.work.id,
        workTitle: outcome.work.title,
        entryTitle: entry.title,
        matchedBy: outcome.matchedBy,
        score: Math.round(outcome.score * 100) / 100,
        changes,
      }
      if (changes.some((c) => c.kind === "conflict")) buckets.conflicts.push(plan)
      else buckets.autoUpdate.push(plan)
    }

    return { data: { source, entryCount: entries.length, buckets } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Commit ───────────────────────────────────────────────────────────
interface ResolvedSet {
  personal_status?: PersonalStatus
  user_score?: number
  chapters_read?: number
}

function resolveSet(
  changes: FieldChange[],
  conflictChoice: Partial<Record<FieldChange["field"], "local" | "imported">> | undefined
): ResolvedSet {
  const set: ResolvedSet = {}
  for (const c of changes) {
    const take = c.kind === "fill" || conflictChoice?.[c.field] === "imported"
    if (!take) continue
    if (c.field === "personal_status") set.personal_status = c.imported as PersonalStatus
    else if (c.field === "user_score") set.user_score = c.imported as number
    else set.chapters_read = c.imported as number
  }
  return set
}

async function applyUpdate(
  userId: string,
  workId: string,
  set: ResolvedSet
): Promise<boolean> {
  const update: Record<string, unknown> = {}
  if (set.personal_status != null) update.personal_status_id = getPersonalStatusIdByName(set.personal_status)
  if (set.user_score != null) update.user_score = set.user_score
  if (set.chapters_read != null) update.chapters_read = set.chapters_read
  if (Object.keys(update).length === 0) return false

  // Importar a lista do MAL/AniList traz NOTA e capítulos — dado pessoal, e em massa. Vai pro
  // estado de QUEM IMPORTOU, pelo cliente de sessão (RLS valendo — estamos numa request).
  const write = await writeReadingState(userId, [workId], update)
  if (write.error) throw new Error(write.error)
  return true
}

async function createWorkFromEntry(
  supabase: AnySupabaseClient,
  userId: string,
  entry: ExternalListEntry,
  /**
   * Papel de quem importa (migration 178). ⚠️ Este é o SEGUNDO caminho que insere em `works`, e
   * ele não passa por `createWork`: monta a linha na mão e nunca viu `ensurePermission`. Sem
   * este argumento toda obra importada nasceria não-aprovada — inclusive as do próprio curador,
   * que importa a lista dele e veria 300 obras marcadas como pendentes de aprovação.
   */
  approvedByRole: boolean
): Promise<string> {
  const personal = {
    personal_status_id: getPersonalStatusIdByName(entry.personalStatus ?? DEFAULT_PERSONAL_STATUS),
    user_score: entry.userScore ?? null,
    chapters_read: entry.chaptersRead ?? null,
  }
  // Só CATÁLOGO (Fase E) — o estado pessoal da entrada importada vai pro espelho, abaixo.
  const { data, error } = await supabase
    .from("works")
    .insert({
      title: entry.title,
      publication_status_id: getPublicationStatusIdByName("Unknown"),
      ai_eval_status: "pending",
      approved: approvedByRole,
      approved_at: approvedByRole ? new Date().toISOString() : null,
    })
    .select("id")
    .single()
  if (error) throw new Error(error.message)

  const write = await writeReadingState(userId, [data.id], personal)
  if (write.error) throw new Error(write.error)

  return data.id
}

async function upsertExternalId(
  supabase: AnySupabaseClient,
  workId: string,
  entry: ExternalListEntry
): Promise<void> {
  if (!entry.externalId) return
  await supabase
    .from("work_external_ids")
    .upsert(
      { work_id: workId, source: entry.source, external_id: entry.externalId },
      { onConflict: "work_id,source" }
    )
}

async function recordRow(
  supabase: AnySupabaseClient,
  importId: string,
  entry: ExternalListEntry,
  status: string,
  workId: string | null
): Promise<void> {
  await supabase.from("import_rows").insert({
    import_id: importId,
    row_index: 0,
    raw_data: entry as unknown as Record<string, unknown>,
    status,
    work_id: workId,
  })
}

export async function commitExternalListImport(
  input: ExternalListInput,
  decisions: ExternalListDecisions
): Promise<{ error?: string; data?: CommitExternalListResult }> {
  try {
    const gate = await ensureReadingStateWriter()
    if (!gate.ok) return { error: gate.error }
    // Mesma pergunta que `createWork` faz (migration 178): obra importada por curador já nasce
    // aprovada; a de qualquer outro papel espera revisão. Resolvido UMA vez para o lote inteiro.
    const approvedByRole = (await ensurePermission("curate_ai")).ok
    const { source, entries } = await resolveEntries(input)
    const supabase = createAdminClient()
    const ctx = await buildMatchContext(supabase, gate.userId)

    const { data: importRecord, error: importError } = await supabase
      .from("imports")
      .insert({
        user_id: gate.userId,
        filename: input.filename,
        file_type: FILE_TYPE[source],
        status: "processing",
        total_rows: entries.length,
        raw_metadata: { source },
      })
      .select("id")
      .single()
    if (importError) return { error: importError.message }
    const importId: string = importRecord.id

    const result: CommitExternalListResult = {
      importId,
      updatedCount: 0,
      createdCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errors: [],
      createdWorkIds: [],
    }

    const skipCreates = new Set(decisions.skipCreates ?? [])

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex]
      try {
        const outcome = await classifyEntry(supabase, entry, ctx)

        if (outcome.kind === "matched") {
          const set = resolveSet(buildChanges(entry, outcome.work), decisions.conflicts?.[entryIndex])
          const changed = await applyUpdate(gate.userId, outcome.work.id, set)
          await upsertExternalId(supabase, outcome.work.id, entry)
          if (changed) {
            result.updatedCount++
            await recordRow(supabase, importId, entry, "updated", outcome.work.id)
          } else {
            result.skippedCount++
          }
          continue
        }

        if (outcome.kind === "ambiguous") {
          const decision = decisions.ambiguous?.[entryIndex] ?? { action: "skip" as const }
          if (decision.action === "match") {
            const work = ctx.worksById.get(decision.workId) as DbWork | undefined
            if (!work) {
              result.skippedCount++
              continue
            }
            // Match confirmado manualmente: só preenche campos vazios (não sobrescreve).
            const fills = buildChanges(entry, work).filter((c) => c.kind === "fill")
            const changed = await applyUpdate(gate.userId, work.id, resolveSet(fills, undefined))
            await upsertExternalId(supabase, work.id, entry)
            if (changed) {
              result.updatedCount++
              await recordRow(supabase, importId, entry, "updated", work.id)
            } else {
              result.skippedCount++
            }
          } else if (decision.action === "create") {
            const workId = await createWorkFromEntry(supabase, gate.userId, entry, approvedByRole)
            await upsertExternalId(supabase, workId, entry)
            result.createdCount++
            result.createdWorkIds.push(workId)
            await recordRow(supabase, importId, entry, "imported", workId)
          } else {
            result.skippedCount++
          }
          continue
        }

        // new
        if (skipCreates.has(entryIndex)) {
          result.skippedCount++
          continue
        }
        const workId = await createWorkFromEntry(supabase, gate.userId, entry, approvedByRole)
        await upsertExternalId(supabase, workId, entry)
        result.createdCount++
        result.createdWorkIds.push(workId)
        await recordRow(supabase, importId, entry, "imported", workId)
      } catch (err) {
        result.errorCount++
        result.errors.push(`${entry.title}: ${err instanceof Error ? err.message : String(err)}`)
        await recordRow(supabase, importId, entry, "error", null)
      }
    }

    await supabase
      .from("imports")
      .update({
        status: "completed",
        imported_count: result.createdCount,
        updated_count: result.updatedCount,
        skipped_count: result.skippedCount,
        error_count: result.errorCount,
        completed_at: new Date().toISOString(),
      })
      .eq("id", importId)

    if (result.createdCount > 0 || result.updatedCount > 0) {
      if (gate.isOwner) {
        await markRecalcPending("external-list-import")
      } else {
        // Obra criada muda o CATÁLOGO (recalc global continua devido); as notas
        // importadas mudam o modelo PESSOAL de quem importou.
        if (result.createdCount > 0) await markRecalcPending("external-list-import")
        after(async () => {
          try {
            await recalculateForUser(gate.userId)
          } catch (err) {
            console.error("[commitExternalListImport] recalc do usuário falhou:", err)
          }
        })
      }
    }

    revalidatePath("/titles")
    revalidatePath("/")
    revalidatePath("/ranking")
    revalidatePath("/ai-evaluation")
    revalidatePath("/fila-recomendacao")
    revalidatePath("/import")
    revalidateTag("ai-eval-tab-counts", "max")

    return { data: result }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
