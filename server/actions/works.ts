"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { workFormSchema, workFormBase, workStatusSchema } from "@/lib/validations/work.schema"
import type { WorkFormValues, WorkStatusValues } from "@/lib/validations/work.schema"
import { CRITERION_SLUGS } from "@/types/domain"
import {
  getPublicationStatusIdByName,
  getPersonalStatusIdByName,
  getPublicationStatusNameById,
  getPersonalStatusNameById,
  isFullyReadPersonalStatus,
} from "@/lib/constants/status-lookups"
import {
  chapterCeiling,
  chaptersForFullyRead,
  clampChaptersRead,
  promoteStatusForProgress,
} from "@/lib/reading/status-coherence"
import {
  dedupeSynopsisEntries,
  pickPrimarySynopsis,
  coverCandidates,
  pickPrimaryCover,
  splitSynopsesFromText,
} from "@/lib/work-derived"
import { markRecalcPending, recalculateScoresNow } from "@/server/recalc/queue"
import { changedInputs } from "@/lib/calculations/recalc-inputs"
import type { RecalcInput } from "@/lib/calculations/recalc-inputs"
import { recalculateForUser } from "@/server/recalc/user-recalc"
import { capturePredictionForFirstRating } from "./prediction-ledger"
import {
  resolvePredictionsForWork,
  markPredictionLabelChanged,
} from "@/lib/server/predictions/resolve-prediction"
import { markWorkAlignmentStale } from "@/server/queries/alignment"
import { duplicateKeys, foldTitle, isWeakDuplicateAlias } from "@/lib/title-match"
import { normalizeAlternativeTitles } from "@/lib/titles/alternative-titles"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { startUpdateJob, finishUpdateJob } from "@/lib/background/update-jobs"
import { fetchExternalData } from "./external"
import { buildCandidateFromExternalIds } from "@/lib/external/index"
import { hiatusFieldsFor } from "@/lib/external/hiatus-kind"
import type { MergedCandidate, ExternalSourceId, ExternalWorkData, ConflictField, SourcedReview } from "@/lib/external/types"
import { resolveOrCreateTags, scheduleTagEnrichment } from "@/lib/tags/ingest"
import { recomputeAdultAuto } from "@/lib/tags/adult-classify"
import { computeAdultContentBounds, clampAdultContentScore } from "@/lib/ai-evaluation/adult-content-rules"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { getSynopsisCanonicalOnCreate, getTagInferenceOnCreate, getGenerateAllOnCreate, ensureAdmin, ensurePermission, ensureSignedIn, getOwnerUserId, getSessionUserId } from "@/server/queries/current-user"
import {
  writeReadingState,
  mirrorOwnerState,
  canWriteSharedWorkRow,
  ensureReadingStateWriter,
  toDay,
  getPersonalStateReader,
} from "@/server/queries/user-work-state"
import type {
  ReadingStatePatch,
  TasteStatePatch,
  PersonalStatePatch,
} from "@/server/queries/user-work-state"
import { buildAutoRefreshPlan } from "@/lib/external/auto-refresh"
import { purgeWorksFromAllLists } from "@/server/queries/lists"
import { getScoresReader } from "@/server/queries/user-scores"
import { getSynopsisPredictionForWork } from "@/server/queries/synopsis-quality"
import { getWorkTagReviewCounts } from "@/server/queries/work-card-meta"
import { normalizeCoverSource, titleToSlug } from "@/lib/utils"
import { DEFAULT_PERSONAL_STATUS } from "@/lib/constants/criteria"
import { personalStatusNameOrDefault } from "@/lib/constants/status-lookups"
import { canRateReadingState } from "@/lib/reading-gate"

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

/**
 * Dispara consolidação de sinopses via Haiku em background. Só roda quando o
 * hash do conjunto de fontes mudou, evitando re-chamadas desnecessárias.
 * Falhas são swallowed — o consumer da sinopse usa fallback split+longest.
 */
function scheduleSynopsisConsolidation(workId: string) {
  after(async () => {
    try {
      // Consolidação canônica (Haiku) via o helper aguardável compartilhado — o
      // mesmo usado pela cascata generate_all. Gate por hash lá dentro.
      const { consolidateSynopsisForWork } = await import(
        "@/lib/ai-recommendation/consolidate-for-work"
      )
      const result = await consolidateSynopsisForWork(workId)
      if (result.status !== "done") return

      // DEFERIR (2a): o helper já marcou a previsão como stale. A recomputação LLM
      // fica sob gatilho (botão "Prever interesse" / backfill / cascata), NÃO eager
      // por-edição. Exceção: 1ª vez (obra sem nenhuma previsão) ainda prevê eager,
      // pra a obra nova nascer com ♥.
      const supabase = createAdminClient()
      const { count: predCount } = await supabase
        .from("synopsis_quality_predictions")
        .select("id", { count: "exact", head: true })
        .eq("work_id", workId)
      if (!predCount) {
        const { autoPredictSynopsisQuality } = await import(
          "@/lib/ai-evaluation/synopsis-quality-runner"
        )
        await autoPredictSynopsisQuality(workId)
      }
    } catch (err) {
      console.error("[scheduleSynopsisConsolidation] falhou:", err)
    }
  })
}

async function hasCompletedAiEvaluation(
  supabase: SupabaseAdminClient,
  workId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("ai_evaluations")
    .select("id")
    .eq("work_id", workId)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle()

  return Boolean(data)
}

async function upsertWorkExternalIds(
  supabase: SupabaseAdminClient,
  workId: string,
  externalIds: Record<string, string> | undefined
): Promise<void> {
  if (!externalIds) return
  const rows = Object.entries(externalIds)
    .filter(([source, id]) => source.trim().length > 0 && id != null && String(id).trim().length > 0)
    .map(([source, id]) => ({ work_id: workId, source: source.trim(), external_id: String(id).trim() }))
  if (rows.length === 0) return
  const { error } = await supabase
    .from("work_external_ids")
    .upsert(rows, { onConflict: "work_id,source" })
  if (error) {
    console.error("[upsertWorkExternalIds] failed:", error.message)
  }
}

export interface DuplicateWorkForForm {
  id: string
  title: string
  values: WorkFormValues
}

const DUPLICATE_WORK_SELECT = `
  *,
  category_scores(*),
  platform_ratings(*),
  work_tags(tag_id, tags(*)),
  work_genres(genre_id, genres(id, name, slug)),
  work_covers(id, url, source, is_primary, position),
  work_synopses(id, source, text, is_primary, position),
  work_external_ids(source, external_id, is_rejected)
`

function normalizePlatformName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function normalizeTextList(values: Array<string | null | undefined> = []) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== "string") continue
    const item = value.trim()
    const key = item.toLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function normalizeCatalogKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
}

type GenreCatalogEntry = {
  id: string | null
  tagId: string | null
  name: string
}

async function fetchGenreCatalog(supabase: SupabaseAdminClient): Promise<GenreCatalogEntry[]> {
  const { data, error } = await supabase
    .from("genres")
    .select("id, name")
    .limit(10000)

  if (error) throw new Error(`Erro ao validar gêneros: ${error.message}`)

  return (data ?? []).flatMap((row) => {
    const name = (row.name as string | null)?.trim()
    return name ? [{ id: (row.id as string) ?? null, tagId: null, name }] : []
  })
}

async function filterKnownGenres(supabase: SupabaseAdminClient, values: string[]) {
  const catalog = await fetchGenreCatalog(supabase)
  if (catalog.length === 0 && values.length > 0) {
    throw new Error("Nenhum gênero cadastrado foi encontrado para validar os dados.")
  }

  const byKey = new Map(catalog.map((genre) => [normalizeCatalogKey(genre.name), genre]))
  const seen = new Set<string>()
  const names: string[] = []
  const tagIds: string[] = []
  const genreIds: string[] = []

  for (const value of normalizeTextList(values)) {
    const genre = byKey.get(normalizeCatalogKey(value))
    if (!genre) continue
    const key = normalizeCatalogKey(genre.name)
    if (seen.has(key)) continue
    seen.add(key)
    names.push(genre.name)
    if (genre.tagId) tagIds.push(genre.tagId)
    if (genre.id) genreIds.push(genre.id)
  }

  return { names, tagIds, genreIds }
}

// As chaves de duplicata (normalização + descarte de alias genérico) moram em
// lib/title-match.ts, junto com a normalização da BUSCA. Divergir das duas era o
// que produzia "não acha em /catalog mas acusa duplicata em /catalog/new".
function getComparableNames(values: Pick<WorkFormValues, "title" | "original_title" | "alternative_titles">) {
  return duplicateKeys({
    title: values.title,
    original_title: values.original_title ?? "",
    alternative_titles: normalizeAlternativeTitles(values.alternative_titles ?? []),
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSavedComparableNames(work: any) {
  return duplicateKeys({
    title: work.title,
    original_title: work.original_title,
    alternative_titles: normalizeAlternativeTitles(work.alternative_titles ?? []),
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findMatchingWorkName(work: any, incomingNames: Set<string>) {
  const savedNames = getSavedComparableNames(work)
  return savedNames.find((name) => incomingNames.has(name)) ?? null
}

/**
 * O casamento de duplicata se apoia num nome FORTE (título/original) de PELO MENOS
 * UM dos lados? Só então a auto-cura (`absorbIncomingAliases`) reescreve a linha
 * existente.
 *
 * Casamento que existe só por alias-com-alias NÃO prova identidade — foi assim que
 * o fragmento "your majesty", que sobra de dezenas de títulos quebrados na vírgula,
 * fundiu duas obras distintas e ainda derramou o pacote de nomes de uma dentro da
 * outra (envenenamento PERMANENTE: depois disso a colisão passava a ser por título
 * exato e nenhuma retentativa saía). Ainda tratamos como possível duplicata e
 * bloqueamos o cadastro; só não mexemos no catálogo.
 */
function isStrongIdentityMatch(
  matchKey: string,
  existing: { title?: string | null; original_title?: string | null },
  incoming: { title?: string | null; original_title?: string | null },
): boolean {
  const strongKeys = [existing.title, existing.original_title, incoming.title, incoming.original_title]
    .map(foldTitle)
    .filter(Boolean)
  return strongKeys.includes(matchKey)
}

/**
 * Impressão digital das notas de plataforma, pro diff de materialidade do
 * `markRecalcPending` (elas viram `Nota.M` + `LogVotos`). Aceita as duas formas
 * — a linha do banco (`vote_count`) e a normalizada do form (`votes`) — e ordena,
 * porque a ordem das linhas não significa nada. `rating` nulo vira string vazia
 * e NÃO `Number(null) === 0`: "sem nota" e "nota zero" são estados diferentes.
 */
function platformRatingsDigest(
  rows:
    | ReadonlyArray<{
        platform: string
        rating?: number | string | null
        vote_count?: number | string | null
        votes?: number | string | null
      }>
    | null
    | undefined
): string {
  return (rows ?? [])
    .map((r) => {
      const rating = r.rating == null ? "" : String(Number(r.rating))
      const rawVotes = r.vote_count ?? r.votes
      const votes = rawVotes == null ? "0" : String(Number(rawVotes))
      return `${r.platform}:${rating}:${votes}`
    })
    .sort()
    .join("|")
}

function normalizePlatformRatings(
  platforms: Array<{ platform: string; rating?: number | null; votes?: number | null }>
) {
  const normalized = new Map<string, { platform: string; rating: number | null; votes: number }>()

  for (const item of platforms) {
    const platform = normalizePlatformName(item.platform)
    if (!platform) continue
    if (item.rating == null && (item.votes == null || item.votes <= 0)) continue

    normalized.set(platform, {
      platform,
      rating: item.rating ?? null,
      votes: item.votes ?? 0,
    })
  }

  return [...normalized.values()]
}

function normalizeExternalPlatformUpdates(
  platforms: Array<{ platform: string; rating?: number | null; votes?: number | null }>
) {
  const normalized = new Map<string, { platform: string; rating: number | null; votes: number | null }>()

  for (const item of platforms) {
    const platform = normalizePlatformName(item.platform)
    if (!platform) continue

    const hasRating = item.rating != null
    const hasVotes = item.votes != null && item.votes > 0
    if (!hasRating && !hasVotes) continue

    const current = normalized.get(platform)
    const rating = hasRating ? item.rating ?? null : current?.rating ?? null
    const votes = hasVotes ? item.votes ?? null : current?.votes ?? null
    normalized.set(platform, {
      platform,
      rating,
      votes,
    })
  }

  return [...normalized.values()]
}

// Resolves tag names to ids (creating missing tags via the shared ingestion
// helper) and schedules background classification (group/sub-group/cluster) for
// any newly-created tag. Drops names whose slug is empty.
async function upsertTagsBatch(
  supabase: SupabaseAdminClient,
  names: string[],
): Promise<string[]> {
  const { ids, createdIds } = await resolveOrCreateTags(supabase, names)
  scheduleTagEnrichment(createdIds)
  return ids
}

// Chunk pequeno o bastante pra caber num `in(...)` sem estourar a URL do
// PostgREST (uma obra pode ter ~200 tags).
const TAG_DELETE_CHUNK = 100

/**
 * Devolve `{ changed }` porque `work_tags` é feature do Ridge (os 3 sinais de
 * fit) e quem chama precisa saber se marca recálculo pendente. O diff já existia
 * aqui dentro por outro motivo (preservar a proveniência) — só não era contado.
 */
async function syncWorkTags(
  supabase: SupabaseAdminClient,
  workId: string,
  tags: string[]
): Promise<{ changed: boolean }> {
  const uniqueTagIds = [...new Set(await upsertTagsBatch(supabase, tags))]

  // DIFF, não delete-tudo-e-reinsere. O insert cru não carrega `source` nem
  // `confidence`, então recriar a linha APAGAVA a proveniência ("ai_inferred")
  // de toda tag que a obra manteve — bastava salvar o formulário uma vez pro
  // rodapé da aba Tags passar a dizer "0 por IA" (e a data de inferência virar
  // mentira). Medido em 2026-07-24: 26 das 42 obras no estado "rodou e 0 por
  // IA" eram isto, não inferência vazia.
  const { data: current } = await supabase
    .from("work_tags")
    .select("tag_id")
    .eq("work_id", workId)
  const existing = new Set((current ?? []).map((r) => r.tag_id as string))
  const keep = new Set(uniqueTagIds)

  const toRemove = [...existing].filter((id) => !keep.has(id))
  for (let i = 0; i < toRemove.length; i += TAG_DELETE_CHUNK) {
    const { error } = await supabase
      .from("work_tags")
      .delete()
      .eq("work_id", workId)
      .in("tag_id", toRemove.slice(i, i + TAG_DELETE_CHUNK))
    if (error) {
      console.error(`[syncWorkTags] delete work_tags failed (workId=${workId})`, error.message)
    }
  }

  const toAdd = uniqueTagIds.filter((id) => !existing.has(id))
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("work_tags")
      .upsert(
        toAdd.map((tag_id) => ({ work_id: workId, tag_id })),
        { onConflict: "work_id,tag_id", ignoreDuplicates: true }
      )
    if (error) {
      console.error(`[syncWorkTags] upsert work_tags failed (workId=${workId})`, error.message)
    }
  }
  // Tags mudaram → recomputa a classificação 18+ (monotônico; migração 161).
  await recomputeAdultAuto(supabase, workId)
  return { changed: toRemove.length > 0 || toAdd.length > 0 }
}

async function syncWorkGenres(
  supabase: SupabaseAdminClient,
  workId: string,
  genreIds: string[],
  mode: "replace" | "add"
) {
  if (mode === "replace") {
    const { error: deleteError } = await supabase.from("work_genres").delete().eq("work_id", workId)
    if (deleteError) return
  }
  if (genreIds.length === 0) return
  await supabase
    .from("work_genres")
    .upsert(
      genreIds.map((genre_id) => ({ work_id: workId, genre_id })),
      { onConflict: "work_id,genre_id", ignoreDuplicates: true }
    )
}

async function syncWorkCovers(
  supabase: SupabaseAdminClient,
  workId: string,
  covers: Array<{ url: string; source: string; isPrimary: boolean }> | undefined
): Promise<{ error: string | null }> {
  if (covers === undefined) return { error: null }
  // Replace all on save — the multi-pick UI is the authoritative source.
  // Esvazia primeiro pra evitar conflitos no UNIQUE (work_id, url) e no
  // índice parcial work_covers_one_primary quando o usuário reordena/altera
  // primária. Sequência DELETE → INSERT acontece em duas requisições, mas
  // pra esse fluxo single-user não tem race relevante.
  const { error: deleteError } = await supabase
    .from("work_covers")
    .delete()
    .eq("work_id", workId)
  if (deleteError) return { error: `Falha ao limpar capas: ${deleteError.message}` }

  if (covers.length === 0) return { error: null }

  const rows = covers.map((c, position) => ({
    work_id: workId,
    url: c.url,
    // O nome da fonte é digitado à mão desde que a lista suspensa saiu. O Zod só
    // limita o tamanho, então sem isto um "Meu Pinterest" passaria a validação e
    // quebraria o CHECK do banco — com as capas antigas JÁ apagadas acima.
    source: normalizeCoverSource(c.source),
    is_primary: c.isPrimary,
    position,
  }))
  // Normaliza is_primary defensivamente: força exatamente um primário (o
  // primeiro marcado, ou rows[0] se nenhum vier marcado). Sem isso, o índice
  // parcial work_covers_one_primary rejeita o INSERT.
  const firstPrimaryIdx = rows.findIndex((r) => r.is_primary)
  const canonicalPrimaryIdx = firstPrimaryIdx === -1 ? 0 : firstPrimaryIdx
  for (let i = 0; i < rows.length; i++) {
    rows[i].is_primary = i === canonicalPrimaryIdx
  }

  const { error } = await supabase.from("work_covers").insert(rows)
  if (error) {
    console.error("[syncWorkCovers] insert failed", error.message)
    return { error: `Falha ao salvar capas: ${error.message}` }
  }
  return { error: null }
}

/**
 * Lê as URLs de capa arquivadas de uma obra (migration 163).
 *
 * Fail-soft: erro devolve conjunto vazio. A pior consequência é uma capa
 * arquivada reaparecer — enquanto abortar a gravação inteira por causa disto
 * perderia a edição que o usuário acabou de fazer.
 */
async function getArchivedCoverUrls(
  supabase: SupabaseAdminClient,
  workId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("work_cover_archive")
    .select("url")
    .eq("work_id", workId)
  if (error) {
    console.error("[getArchivedCoverUrls] falhou:", error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.url as string))
}

/**
 * Persiste a lista de capas arquivadas do formulário (migration 163).
 *
 * Replace-all, igual a `syncWorkCovers`: o formulário é a fonte da verdade —
 * restaurar uma capa é simplesmente ela sumir desta lista.
 */
async function syncArchivedCovers(
  supabase: SupabaseAdminClient,
  workId: string,
  archived: Array<{ url: string; source?: string | null }> | undefined,
): Promise<{ error: string | null }> {
  if (archived === undefined) return { error: null }

  const { error: deleteError } = await supabase
    .from("work_cover_archive")
    .delete()
    .eq("work_id", workId)
  if (deleteError) return { error: `Falha ao limpar capas arquivadas: ${deleteError.message}` }

  if (archived.length === 0) return { error: null }

  // Dedup por URL: o UNIQUE (work_id, url) rejeitaria o INSERT INTEIRO — e as
  // arquivadas já teriam sido apagadas acima, desarquivando tudo em silêncio.
  const seen = new Set<string>()
  const rows: Array<{ work_id: string; url: string; source: string | null }> = []
  for (const entry of archived) {
    if (!entry.url || seen.has(entry.url)) continue
    seen.add(entry.url)
    rows.push({ work_id: workId, url: entry.url, source: entry.source || null })
  }
  if (rows.length === 0) return { error: null }

  const { error } = await supabase.from("work_cover_archive").insert(rows)
  if (error) return { error: `Falha ao salvar capas arquivadas: ${error.message}` }
  return { error: null }
}

/**
 * Upsert incremental para capas vindas do diálogo "Atualizar dados".
 * Preserva capas pré-existentes não citadas na lista (apenas marca primária=false
 * em todas as outras). Quando a URL já existe, só atualiza is_primary; quando
 * é nova, faz INSERT.
 */
async function syncExternalCovers(
  supabase: SupabaseAdminClient,
  workId: string,
  covers: Array<{ url: string; source: string; isPrimary: boolean }>
): Promise<{ error: string | null }> {
  if (covers.length === 0) return { error: null }

  // Capa arquivada (migration 163) não volta. Esta é a garantia de servidor: o
  // seletor do diálogo já não a oferece, mas quem grava é aqui — e "a capa que
  // eu apaguei voltou" é o tipo de bug que não levanta erro nenhum.
  const archivedUrls = await getArchivedCoverUrls(supabase, workId)
  const kept = archivedUrls.size > 0 ? covers.filter((c) => !archivedUrls.has(c.url)) : covers
  if (kept.length === 0) {
    // Tudo que veio está arquivado: não é erro, é o arquivamento funcionando.
    // Sair aqui PRESERVA as capas atuais — o delete abaixo as apagaria.
    return { error: null }
  }

  const normalizedPrimaryIdx = (() => {
    const idx = kept.findIndex((c) => c.isPrimary)
    return idx === -1 ? 0 : idx
  })()
  const primaryUrl = kept[normalizedPrimaryIdx].url

  // Replace mode: deleta todas as capas atuais da obra e insere a lista nova.
  // Antes era aditivo (mantinha capas não listadas), mas a UX de refresh +
  // refine espera que a seleção final do usuário SUBSTITUA o estado anterior.
  // Alinhado com syncWorkSynopses.
  const { error: deleteError } = await supabase
    .from("work_covers")
    .delete()
    .eq("work_id", workId)
  if (deleteError) return { error: `Falha ao limpar capas: ${deleteError.message}` }

  const rows = kept.map((cover, position) => ({
    work_id: workId,
    url: cover.url,
    source: cover.source,
    is_primary: cover.url === primaryUrl,
    position,
  }))
  const { error: insertError } = await supabase.from("work_covers").insert(rows)
  if (insertError) return { error: `Falha ao inserir capas: ${insertError.message}` }

  return { error: null }
}

function normalizeFormSynopses(values: Pick<WorkFormValues, "synopsis" | "synopses">) {
  const fromEntries = dedupeSynopsisEntries(values.synopses)
  if (fromEntries.length > 0) return fromEntries

  return splitSynopsesFromText(values.synopsis).map((text, index) => ({
    source: "manual",
    text,
    isPrimary: index === 0,
  }))
}

async function syncWorkSynopses(
  supabase: SupabaseAdminClient,
  workId: string,
  synopses: Array<{ source: string; text: string; isPrimary: boolean }> | undefined
): Promise<{ error: string | null }> {
  // undefined = o caller não controla sinopses; [] = o textarea foi esvaziado.
  if (!synopses) return { error: null }
  const normalizedSynopses = dedupeSynopsisEntries(synopses)

  const { error: deleteError } = await supabase
    .from("work_synopses")
    .delete()
    .eq("work_id", workId)
  if (deleteError) return { error: `Falha ao limpar sinopses: ${deleteError.message}` }

  if (normalizedSynopses.length === 0) return { error: null }

  const rows = normalizedSynopses.map((s, position) => ({
    work_id: workId,
    source: s.source,
    text: s.text,
    is_primary: s.isPrimary,
    position,
  }))
  const firstPrimaryIdx = rows.findIndex((r) => r.is_primary)
  const canonicalPrimaryIdx = firstPrimaryIdx === -1 ? 0 : firstPrimaryIdx
  for (let i = 0; i < rows.length; i++) {
    rows[i].is_primary = i === canonicalPrimaryIdx
  }

  const { error } = await supabase.from("work_synopses").insert(rows)
  if (error) {
    console.error("[syncWorkSynopses] insert failed", error.message)
    return { error: `Falha ao salvar sinopses: ${error.message}` }
  }
  return { error: null }
}

// Adds external genres/tags without deleting existing work_tags.
// Data entered manually (not returned by external search) is preserved.
async function syncWorkTagsPartial(
  supabase: SupabaseAdminClient,
  workId: string,
  tags: string[] | undefined,
  knownGenreIds: string[] = []
) {
  if (tags !== undefined) {
    const uniqueIdsToAdd = [...new Set(await upsertTagsBatch(supabase, tags))]
    if (uniqueIdsToAdd.length > 0) {
      const { data: existing } = await supabase
        .from("work_tags").select("tag_id").eq("work_id", workId)
      const existingSet = new Set<string>((existing ?? []).map((wt: { tag_id: string }) => wt.tag_id))

      const newEntries = uniqueIdsToAdd
        .filter((id) => !existingSet.has(id))
        .map((tag_id) => ({ work_id: workId, tag_id }))
      if (newEntries.length > 0) {
        const { error } = await supabase
          .from("work_tags")
          .upsert(newEntries, { onConflict: "work_id,tag_id", ignoreDuplicates: true })
        if (error) {
          console.error(`[syncWorkTagsPartial] upsert work_tags failed (workId=${workId})`, error.message)
        }
      }
    }
  }

  if (knownGenreIds.length > 0) {
    await syncWorkGenres(supabase, workId, knownGenreIds, "add")
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbWorkToFormValues(work: any): WorkFormValues {
  const scoreMap: Record<string, number> = {}
  for (const score of work.category_scores ?? []) {
    scoreMap[score.criterion_slug] = score.score
  }

  const getPlatform = (platform: string) =>
    (work.platform_ratings ?? []).find((p: { platform: string }) =>
      normalizePlatformName(p.platform).replace(/-/g, "") === normalizePlatformName(platform).replace(/-/g, "")
    )

  const mu = getPlatform("mangaupdates")
  const ap = getPlatform("animeplanet")
  const cmx = getPlatform("comick")
  const knownPlatforms = new Set(["mangaupdates", "animeplanet", "comick"])
  const extraPlatformRatings = (work.platform_ratings ?? [])
    .filter((p: { platform: string }) => !knownPlatforms.has(normalizePlatformName(p.platform).replace(/-/g, "")))
    .map((p: { platform: string; rating: number | null; vote_count: number | null }) => ({
      platform: p.platform,
      rating: p.rating ?? null,
      votes: p.vote_count ?? null,
    }))

  const tags = (work.work_tags ?? [])
    .map((wt: { tags?: { name?: string } | null }) => wt.tags?.name)
    .filter(Boolean) as string[]

  const genres = (work.work_genres ?? [])
    .map((wg: { genres?: { name?: string } | null }) => wg.genres?.name)
    .filter(Boolean) as string[]

  const covers = ((work.work_covers ?? []) as Array<{
    url?: string | null
    source?: string | null
    is_primary?: boolean | null
    position?: number | null
  }>)
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .flatMap((cover) => {
      if (!cover.url) return []
      return [{
        url: cover.url,
        source: cover.source ?? "manual",
        isPrimary: Boolean(cover.is_primary),
      }]
    })

  const synopses = dedupeSynopsisEntries(
    ((work.work_synopses ?? []) as Array<{
      source?: string | null
      text?: string | null
      is_primary?: boolean | null
      position?: number | null
    }>)
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .flatMap((synopsis) => {
        if (!synopsis.text) return []
        return [{
          source: synopsis.source ?? "manual",
          text: synopsis.text,
          isPrimary: Boolean(synopsis.is_primary),
        }]
      })
  )

  const externalIds = Object.fromEntries(
    ((work.work_external_ids ?? []) as Array<{
      source?: string | null
      external_id?: string | null
      is_rejected?: boolean | null
    }>)
      .filter((row) => row.source && row.external_id && !row.is_rejected)
      .map((row) => [row.source!, row.external_id!])
  )

  const criterionValues = Object.fromEntries(
    CRITERION_SLUGS.map((slug) => [slug, scoreMap[slug] ?? null])
  )

  // Base SEM a refine de year_end: carregar uma obra pra EDIÇÃO não pode lançar por
  // year_end < year — é justamente na edição que você corrige. A rejeição vale na
  // submissão (persistNewWork/updateWork usam o workFormSchema refinado).
  return workFormBase.parse({
    title: work.title,
    original_title: work.original_title ?? "",
    alternative_titles: work.alternative_titles ?? [],
    synopsis: pickPrimarySynopsis(work.work_synopses) ?? "",
    genres,
    tags,
    year: work.year ?? null,
    year_end: work.year_end ?? null,
    publication_status: getPublicationStatusNameById(work.publication_status_id) ?? "Unknown",
    personal_status: personalStatusNameOrDefault(work.personal_status_id),
    publication_status_id: work.publication_status_id ?? null,
    personal_status_id: work.personal_status_id ?? null,
    total_chapters: work.total_chapters ?? null,
    chapters_read: work.chapters_read ?? null,
    synopsis_quality: work.synopsis_quality ?? null,
    observation_adjustment: work.observation_adjustment ?? 0,
    user_score: work.user_score ?? null,
    post_story_score: work.post_story_score ?? null,
    post_fl_score: work.post_fl_score ?? null,
    post_ml_score: work.post_ml_score ?? null,
    post_character_development_score: work.post_character_development_score ?? null,
    post_pacing_score: work.post_pacing_score ?? null,
    post_art_visual_score: work.post_art_visual_score ?? null,
    post_impact_immersion_score: work.post_impact_immersion_score ?? null,
    post_originality_score: work.post_originality_score ?? null,
    observations: work.observations ?? "",
    cover_url: pickPrimaryCover(work.work_covers) ?? "",
    ai_eval_status: work.ai_eval_status ?? "pending",
    mu_rating: mu?.rating ?? null,
    mu_votes: mu?.vote_count ?? null,
    ap_rating: ap?.rating ?? null,
    ap_votes: ap?.vote_count ?? null,
    cmx_rating: cmx?.rating ?? null,
    cmx_votes: cmx?.vote_count ?? null,
    extra_platform_ratings: extraPlatformRatings,
    covers,
    synopses,
    external_ids: externalIds,
    ...criterionValues,
  })
}

export interface WorkPreview {
  workId: string
  title: string
  /** Candidatas de capa (ver MAX_COVER_CANDIDATES): a prévia cai pra próxima se a 1ª morrer. */
  coverUrls: string[]
  synopsis: string | null
  synopsisQuality: string | null
  /** True quando o Interesse manual foi APLICADO da previsão da IA (synopsis_quality_source = prediction_applied), não definido à mão. */
  synopsisFromPrediction: boolean
  /** Previsão IA de Interesse (♥..♥♥♥♥) — synopsis_quality_predictions. NULL se nunca prevista. */
  predictedSynopsisQuality: string | null
  /** True quando a previsão de Interesse ficou desatualizada (perfil/sinopse mudou). */
  predictedSynopsisStale: boolean
  publicationStatusId: number | null
  totalChapters: number | null
  observations: string | null
  year: number | null
  platformAvg: number | null
  totalVotes: number
  /** Conteúdo adulto (18+) efetivo — works.is_adult. Renderiza o chip 🔞 no hover. */
  isAdult: boolean
  /** Nota Prevista DE QUEM OLHA (após overlay per-usuário). NULL sem os 9 atributos IA / sem modelo. */
  expectedScore: number | null
  /** Prevista é estimativa (sem modelo ML) → marca `~`. */
  expectedIsStub: boolean
  /** Sua nota (user_score) — do espelho pessoal. NULL quando você ainda não avaliou. */
  userScore: number | null
}

export async function getWorkPreview(workId: string): Promise<WorkPreview | null> {
  const supabase = createAdminClient()
  // Predição de Interesse buscada em paralelo com a obra (round-trip único).
  const [{ data, error }, prediction] = await Promise.all([
    supabase
      .from("works")
      .select(`
        id, title, canonical_synopsis, is_adult,
        publication_status_id, total_chapters, year,
        work_covers(url, is_primary, position),
        work_synopses(source, text, is_primary, position),
        calculated_scores(platform_avg, total_votes, expected_score, expected_is_stub)
      `)
      .eq("id", workId)
      .maybeSingle(),
    getSynopsisPredictionForWork(workId),
  ])

  if (error || !data) return null

  // Nota Prevista é PESSOAL: a linha crua de `calculated_scores` é a do dono. Overlay troca os
  // campos pessoais (expected_score…) pelos de quem olha — ou null — mantendo platform_avg/votos.
  const scoresReader = await getScoresReader()
  const calcRaw = (data as {
    calculated_scores?:
      | { platform_avg?: number | null; total_votes?: number | null; expected_score?: number | null; expected_is_stub?: boolean | null }
      | null
  }).calculated_scores
  const calc = scoresReader.overlay(data.id as string, calcRaw)
  const covers = (data as { work_covers?: Parameters<typeof coverCandidates>[0] }).work_covers
  const synopses = (data as { work_synopses?: Parameters<typeof pickPrimarySynopsis>[0] }).work_synopses
  // Hover mostra a sinopse CANÔNICA (consolidada via IA) quando existe; cai na
  // primária das fontes enquanto a obra não passou pela consolidação.
  const canonicalSynopsis = ((data.canonical_synopsis as string | null) ?? "").trim()

  // Interesse ♥ e observações são PESSOAIS (Fatia 2a) — vêm do espelho de quem olha, não da
  // linha compartilhada de `works` (que é a do dono).
  const personal = await getPersonalStateReader()
  const state = personal.get(data.id as string)

  return {
    workId: data.id as string,
    title: data.title as string,
    coverUrls: coverCandidates(covers),
    synopsis: canonicalSynopsis || pickPrimarySynopsis(synopses),
    synopsisQuality: state.synopsisQuality,
    synopsisFromPrediction: state.synopsisQualitySource === "prediction_applied",
    predictedSynopsisQuality: prediction?.predictedQuality ?? null,
    predictedSynopsisStale: prediction?.stale ?? false,
    publicationStatusId: (data.publication_status_id as number | null) ?? null,
    totalChapters: (data.total_chapters as number | null) ?? null,
    observations: state.observations,
    year: (data.year as number | null) ?? null,
    platformAvg: calc?.platform_avg ?? null,
    totalVotes: calc?.total_votes ?? 0,
    isAdult: Boolean((data as { is_adult?: boolean | null }).is_adult),
    expectedScore: calc?.expected_score ?? null,
    expectedIsStub: calc?.expected_is_stub ?? false,
    userScore: state.userScore,
  }
}

/**
 * Contagem de tags + reviews úteis de UMA obra, para o hover do título.
 * Reusa a RPC agregada `work_card_counts` (mesma regra do /curation/works), então
 * os números batem com os cards da fila. Chamada sob demanda no hover (1 por obra).
 */
export async function getWorkHoverCounts(
  workId: string,
): Promise<{ tagCount: number; reviewCount: number }> {
  const counts = await getWorkTagReviewCounts([workId])
  return counts.get(workId) ?? { tagCount: 0, reviewCount: 0 }
}

/**
 * AUTO-CURA — grava na obra os nomes pelos quais ela acabou de ser reconhecida.
 *
 * A detecção de duplicata compara o pacote INTEIRO de aliases que veio da fonte
 * externa contra o título salvo. A busca não tem esse pacote: ela só olha os
 * nomes guardados na linha da obra. É daí que vinha o "não acha em /catalog mas
 * acusa duplicata em /catalog/new" — a duplicata enxerga um nome que a busca
 * nunca teve.
 *
 * Então, no exato momento em que descobrimos que aquele nome identifica a obra,
 * ele é persistido. O catálogo para de regredir sozinho: sem isto, o backfill
 * conserta o passado e obras novas voltam a divergir com o tempo.
 *
 * Não lança: é um efeito colateral oportunista, e falhar aqui não pode impedir
 * o usuário de resolver a duplicata que ele veio resolver.
 */
const MAX_ALTERNATIVE_TITLES = 40

async function absorbIncomingAliases(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  work: { id: string; title?: string | null; original_title?: string | null; alternative_titles?: string[] | null },
  incomingRawNames: string[],
): Promise<void> {
  try {
    // Chaves que a obra JÁ reconhece — inclui título e original, que não devem
    // virar alias redundante.
    const known = new Set(
      duplicateKeys({
        title: work.title,
        original_title: work.original_title,
        alternative_titles: work.alternative_titles,
      }),
    )
    // `duplicateKeys` descarta alias genérico ("Official", "English"…); os
    // já-salvos entram no known por fora pra não serem re-adicionados.
    for (const saved of work.alternative_titles ?? []) known.add(foldTitle(saved))

    const toAdd: string[] = []
    for (const raw of incomingRawNames) {
      const trimmed = (raw ?? "").trim()
      if (!trimmed) continue
      const key = foldTitle(trimmed)
      if (!key || known.has(key) || isWeakDuplicateAlias(key)) continue
      known.add(key)
      toAdd.push(trimmed)
    }
    if (!toAdd.length) return

    const next = normalizeAlternativeTitles([...(work.alternative_titles ?? []), ...toAdd]).slice(
      0,
      MAX_ALTERNATIVE_TITLES,
    )
    const { error } = await supabase
      .from("works")
      .update({ alternative_titles: next })
      .eq("id", work.id)
    if (error) {
      console.error("[auto-cura] falha gravando aliases:", error.message)
      return
    }
    // Sem isto o alias novo só ficaria buscável quando o cache expirasse.
    revalidateTag("works-slug-index", "max")
  } catch (error) {
    console.error("[auto-cura] erro inesperado:", error)
  }
}

export async function findDuplicateWorkByTitle(
  title: string,
  alternativeTitles: string[] = []
): Promise<DuplicateWorkForForm | null> {
  const normalizedTitle = title.trim()
  if (!normalizedTitle) return null
  const incomingNames = new Set(getComparableNames({
    title,
    original_title: "",
    alternative_titles: alternativeTitles,
  }))

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(DUPLICATE_WORK_SELECT)
    .ilike("title", normalizedTitle)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data && !error) {
    const { data: originalTitleMatch } = await supabase
      .from("works")
      .select(DUPLICATE_WORK_SELECT)
      .ilike("original_title", normalizedTitle)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (originalTitleMatch) {
      return {
        id: originalTitleMatch.id,
        title: originalTitleMatch.title,
        values: dbWorkToFormValues(originalTitleMatch),
      }
    }

    // Pagina: `.limit(1000)` estava a 94 obras de cortar em silêncio (906 hoje),
    // e o corte faria a duplicata passar batido — cria obra repetida.
    const allData = await fetchAllRows<Record<string, unknown>>(
      (from, to) => supabase.from("works").select(DUPLICATE_WORK_SELECT).range(from, to),
      "findDuplicateWorkByTitle",
    )
    const aliasMatch = allData
      .map((work) => ({ work, matchingName: findMatchingWorkName(work, incomingNames) }))
      .find((m) => m.matchingName)
    if (aliasMatch?.matchingName) {
      const matched = aliasMatch.work as {
        id: string
        title: string
        original_title?: string | null
        alternative_titles?: string[] | null
      }
      // Casou por um nome que veio de fora: grava, senão a busca segue sem ele —
      // mas só quando o casamento é por nome forte (título/original), nunca
      // alias-com-alias, que não prova identidade e envenenaria a linha.
      if (isStrongIdentityMatch(aliasMatch.matchingName, matched, { title: normalizedTitle })) {
        await absorbIncomingAliases(supabase, matched, [normalizedTitle, ...alternativeTitles])
      }
      return {
        id: matched.id,
        title: matched.title,
        values: dbWorkToFormValues(aliasMatch.work),
      }
    }
  }

  if (error || !data) return null

  return {
    id: data.id,
    title: data.title,
    values: dbWorkToFormValues(data),
  }
}

export async function findDuplicateWorkById(id: string): Promise<DuplicateWorkForForm | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(DUPLICATE_WORK_SELECT)
    .eq("id", id)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id,
    title: data.title,
    values: dbWorkToFormValues(data),
  }
}

/**
 * Insere a obra completa no banco (works + category_scores + platform_ratings + tags)
 * mas NÃO dispara o recálculo. Usado tanto pelo fluxo normal quanto pelo batch.
 */
export interface CreateWorkAiMeta {
  inputHash: string
  modelName: string
  promptVersion: string
  confidence: number | null
  summary?: string | null
}

/**
 * O estado PESSOAL que o form de obra carrega junto com os dados do catálogo.
 *
 * ⚠️ O form de criação/edição mistura duas coisas que não são a mesma: fato da OBRA (título,
 * ano, capítulos totais, sinopse) e estado de QUEM CADASTROU (status de leitura, capítulos
 * lidos, nota, ♥, observações, pós-leitura). Os primeiros vivem em `works` por direito; os
 * segundos só estão lá por herança do tempo em que o app tinha um usuário só.
 *
 * `createWork`/`updateWork` seguem gravando os dois em `works` (é a linha do dono), mas agora
 * espelham a parte pessoal em `user_work_state` — senão o espelho dele apodrece a cada obra
 * criada ou editada, e a Fase 2 não pode confiar nele como fonte.
 */
function personalPatchFromForm(data: WorkFormValues): PersonalStatePatch {
  return {
    personal_status_id:
      data.personal_status_id ?? getPersonalStatusIdByName(data.personal_status) ?? null,
    chapters_read: data.chapters_read ?? null,
    synopsis_quality: data.synopsis_quality ?? null,
    synopsis_quality_source: data.synopsis_quality != null ? "human_manual" : null,
    observation_adjustment: data.observation_adjustment,
    observations: data.observations ?? null,
    user_score: data.user_score ?? null,
    post_story_score: data.post_story_score ?? null,
    post_fl_score: data.post_fl_score ?? null,
    post_ml_score: data.post_ml_score ?? null,
    post_character_development_score: data.post_character_development_score ?? null,
    post_pacing_score: data.post_pacing_score ?? null,
    post_art_visual_score: data.post_art_visual_score ?? null,
    post_impact_immersion_score: data.post_impact_immersion_score ?? null,
    post_originality_score: data.post_originality_score ?? null,
  }
}

async function persistNewWork(
  values: WorkFormValues,
  aiMeta: CreateWorkAiMeta | undefined,
  /**
   * `skipAiCascade` — nada que queime token. É o caminho do Leitor FREE (Fatia 2b): ele pode
   * cadastrar uma obra que falta no catálogo, mas SÓ com o que a busca externa trouxe
   * (scraping das 8 fontes: título, capa, sinopse, capítulos — zero LLM). A sinopse canônica,
   * a inferência de tags e as 9 notas de atributo ficam PENDENTES pro Curador rodar.
   *
   * Sem esta opção, `createWorkPending` disparava a consolidação de sinopse por LLM (abaixo) —
   * ou seja, "pending" não era livre de IA. O nome mentia.
   *
   * 🔴 `creatorId` — QUEM está cadastrando. Não é decoração: o form de criação carrega, junto
   * do catálogo, o estado PESSOAL de quem preenche (status, capítulos, nota, ♥, pós-leitura).
   * Sem este argumento, esta função espelhava esse estado em `mirrorOwnerState(getOwnerUserId())`
   * — SEMPRE no dono, quem quer que estivesse cadastrando. Como `createWork` é aberto a qualquer
   * usuário logado (Fatia 2b/5), a Leitora cadastrando uma obra com "nota 9.5, cap. 12" gravava
   * a nota DELA na linha DELE — e `user_score` é o RÓTULO que treina o Ridge do dono. O modelo
   * dele passava a aprender o gosto dela. Sem erro, sem log; medido no banco antes de existir
   * este parâmetro (scripts/e2e/verify-create-ownership.mjs).
   */
  /**
   * `approvedByRole` — a obra já nasce validada? Vem do PAPEL de quem cria
   * (`ensurePermission("curate_ai")`), resolvido pelo chamador (migration 178).
   *
   * ⚠️ Explícito, e não derivado de `skipAiCascade`. Os dois hoje valem `isCurator`, mas
   * significam coisas diferentes — "pular a cascata paga" é decisão de CUSTO (o Flow B do
   * popup deixa até o curador pular) e "aprovada" é decisão de CONFIANÇA. Amarrar uma na
   * outra faria o curador que escolhe não gastar tokens criar obra não-aprovada.
   */
  opts: { skipAiCascade?: boolean; creatorId: string; approvedByRole: boolean },
): Promise<
  | { ok: true; workId: string }
  | { ok: false; error: Record<string, string[]> }
> {
  const parsed = workFormSchema.safeParse(values)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const data = parsed.data
  const supabase = createAdminClient()
  let knownGenres: Awaited<ReturnType<typeof filterKnownGenres>>
  try {
    knownGenres = await filterKnownGenres(supabase, data.genres ?? [])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { genres: [message] } }
  }

  const incomingNames = new Set(getComparableNames(data))
  // Pagina: um corte silencioso aqui deixaria passar duplicata e criaria obra
  // repetida no catálogo.
  const existingWorks = await fetchAllRows<{
    id: string
    title: string
    original_title: string | null
    alternative_titles: string[] | null
  }>(
    (from, to) =>
      supabase
        .from("works")
        .select("id, title, original_title, alternative_titles")
        .range(from, to),
    "createWork:duplicate",
  )

  const duplicate = existingWorks
    .map((work) => ({ work, matchingName: findMatchingWorkName(work, incomingNames) }))
    .find((match) => match.matchingName)

  if (duplicate?.matchingName) {
    // A obra existente foi reconhecida por um nome que veio do formulário (em
    // geral trazido pela fonte externa). Se ela não guarda esse nome, a busca
    // continuaria sem achá-la — e o usuário voltaria aqui pelo mesmo caminho.
    //
    // Só absorve quando o casamento veio de um nome forte (título/original) —
    // casamento alias-com-alias não prova identidade e não pode reescrever a linha.
    if (isStrongIdentityMatch(duplicate.matchingName, duplicate.work, data)) {
      await absorbIncomingAliases(supabase, duplicate.work, [
        data.title,
        data.original_title ?? "",
        ...(data.alternative_titles ?? []),
      ])
    }
    return {
      ok: false,
      error: {
        title: [
          `Já existe uma obra com esse título (${duplicate.matchingName}: ${duplicate.work.title})`,
        ],
      },
    }
  }

  // ⚠️ NENHUMA coluna pessoal no insert (FASE E). A obra que nasce aqui é CATÁLOGO — título,
  // ano, capítulos, status de publicação. Status de leitura, capítulos lidos, nota, ♥,
  // anotações e pós-leitura são de QUEM CADASTROU e vão pra `user_work_state`, logo abaixo.
  //
  // `works.personal_status_id` era NOT NULL sem default e por isso obrigava este insert a
  // inventar um valor; a mig 153 tirou o NOT NULL. As outras 4 NOT NULL têm default e se
  // resolvem sozinhas. As colunas ficam aí, nulas, até o `DROP` (§13.4).
  const { data: work, error } = await supabase
    .from("works")
    .insert({
      title: data.title,
      original_title: data.original_title ?? null,
      alternative_titles: normalizeAlternativeTitles(data.alternative_titles ?? []),
      year: data.year ?? null,
      year_end: data.year_end ?? null,
      publication_status_id:
        data.publication_status_id ?? getPublicationStatusIdByName(data.publication_status),
      // O texto do MU é fato da obra; o tipo de hiato sai dele AQUI, no servidor, nunca do
      // form. Ver `hiatusFieldsFor` — é ele que garante que obra fora de hiato não carrega
      // tipo de hiato, invariante que o CHECK da migration 183 também guarda.
      ...hiatusFieldsFor(data.publication_status_note, data.publication_status),
      total_chapters: data.total_chapters ?? null,
      ai_eval_status: "pending",
      approved: opts.approvedByRole,
      approved_at: opts.approvedByRole ? new Date().toISOString() : null,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: { _root: [error.message] } }

  const workId = work.id

  // O estado pessoal que nasceu junto com a obra é de QUEM CADASTROU — status, capítulos, nota,
  // ♥ e pós-leitura são dele, não da obra. Agora esta é a ÚNICA escrita dele.
  //
  // 🔴 Isto era `mirrorOwnerState(await getOwnerUserId(), ...)`: espelhava no DONO, quem quer que
  // estivesse cadastrando. A Leitora cadastrava com "nota 9.5" e a nota virava RÓTULO DE TREINO
  // do Ridge dele — enquanto ela ficava sem linha nenhuma, ou seja, perdia o próprio dado.
  //
  // Vai no cliente de SESSÃO de propósito. `mirrorOwnerState` usa service role, que IGNORA a
  // RLS — é por isso que um `user_id` errado ali virou dado errado em silêncio em vez de um
  // insert negado. Com o cliente de sessão, a política da mig 142 (`user_id = auth.uid()`)
  // torna este bug IMPOSSÍVEL de reescrever: escrever na linha de outra pessoa é negado pelo
  // Postgres.
  const mirror = await writeReadingState(opts.creatorId, [workId], personalPatchFromForm(data))
  if (mirror.error) return { ok: false, error: { _root: [mirror.error] } }

  // Create the AI evaluation row FIRST when AI justifications exist, so the
  // category_scores rows below can reference it with source="ai_accepted" +
  // ai_evaluation_id. Without this, scores produced by the AI search flow
  // get stamped as "manual" and lose their provenance.
  const aiJustifications = data.ai_justifications ?? {}
  const aiJustificationEntries = Object.entries(aiJustifications)
    .filter(([, justification]) => justification?.trim())

  let aiEvaluationId: string | null = null
  if (aiJustificationEntries.length > 0) {
    const { data: evaluation } = await supabase
      .from("ai_evaluations")
      .insert({
        work_id: workId,
        status: "completed",
        model_name: aiMeta?.modelName ?? "external-ai-criteria",
        prompt_version: aiMeta?.promptVersion ?? "external-import",
        summary: aiMeta?.summary?.trim() || "Notas e explicações geradas durante a busca externa do título.",
        confidence: aiMeta?.confidence ?? null,
        raw_response: { criteriaJustifications: aiJustifications },
        input_hash: aiMeta?.inputHash ?? null,
      })
      .select("id")
      .single()

    if (evaluation) {
      aiEvaluationId = evaluation.id
      await supabase.from("ai_evaluation_scores").insert(
        CRITERION_SLUGS.flatMap((slug) => {
          const score = data[slug as keyof WorkFormValues]
          const justification = aiJustifications[slug]
          if (score == null && !justification) return []
          return [{
            ai_evaluation_id: evaluation.id,
            criterion_slug: slug,
            suggested_score: score == null ? null : Number(score),
            accepted_score: score == null ? null : Number(score),
            was_accepted: score != null,
            was_edited: false,
            justification: justification ?? null,
          }]
        })
      )
    }
  }

  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = data[slug as keyof WorkFormValues]
    if (score == null) return []
    const hasAi = Boolean(aiJustifications[slug]?.trim()) && aiEvaluationId != null
    return [{
      work_id: workId,
      criterion_slug: slug,
      score: Number(score),
      source: hasAi ? ("ai_accepted" as const) : ("manual" as const),
      ai_evaluation_id: hasAi ? aiEvaluationId : null,
    }]
  })

  if (scores.length > 0) {
    await supabase.from("category_scores").insert(scores)
  }

  const platforms = normalizePlatformRatings([
    { platform: "mangaupdates", rating: data.mu_rating, votes: data.mu_votes },
    { platform: "animeplanet", rating: data.ap_rating, votes: data.ap_votes },
    { platform: "comick", rating: data.cmx_rating, votes: data.cmx_votes },
    ...(data.extra_platform_ratings ?? []).map((p) => ({
      platform: p.platform,
      rating: p.rating,
      votes: p.votes,
    })),
  ])

  if (platforms.length > 0) {
    const { error: platformError } = await supabase.from("platform_ratings").insert(
      platforms.map((p) => ({
        work_id: workId,
        platform: p.platform,
        rating: p.rating ?? null,
        vote_count: p.votes ?? 0,
      }))
    )
    if (platformError) return { ok: false, error: { _root: [platformError.message] } }
  }

  await syncWorkTags(supabase, workId, data.tags ?? [])
  await syncWorkGenres(supabase, workId, knownGenres.genreIds, "replace")
  const coversResult = await syncWorkCovers(supabase, workId, data.covers)
  if (coversResult.error) return { ok: false as const, error: { covers: [coversResult.error] } }
  const synopsesResult = await syncWorkSynopses(supabase, workId, normalizeFormSynopses(data))
  if (synopsesResult.error) return { ok: false as const, error: { synopses: [synopsesResult.error] } }
  // Gate por configuração: gerar a canônica na criação é opcional (toggle em
  // /curation/settings). Desligado, adia pra depois do save (painel/edição). Tolerante:
  // default true preserva o comportamento histórico.
  if (!opts?.skipAiCascade && (await getSynopsisCanonicalOnCreate(supabase))) {
    scheduleSynopsisConsolidation(workId)
  }
  await upsertWorkExternalIds(supabase, workId, data.external_ids)

  const hasScores = scores.length >= CRITERION_SLUGS.length
  await supabase
    .from("works")
    .update({
      ai_eval_status: hasScores ? "done" : aiEvaluationId ? "review_pending" : "pending",
    })
    .eq("id", workId)

  return { ok: true, workId }
}

// Sinaliza pro Next que tanto o path /favorites quanto o cache `getFavoritesSummary`
// estão desatualizados. Necessário em toda mutação que possa mexer em
// is_favorite/is_archived ou nos scores agregados pelo summary.
function revalidateFavorites() {
  revalidatePath("/favorites")
  // A visão "Sem grupo" é derivada de `favoritas − agrupadas`: favoritar/desfavoritar mexe no
  // primeiro termo, então ela tem que ser recalculada junto com o índice.
  revalidatePath("/favorites/ungrouped")
  revalidateTag("favorites-summary", "max")
}

/**
 * Desfavoritar TIRA a obra de todas as pastas do usuário. É o invariante "grupo ⊂ favoritos"
 * valendo nas duas direções.
 *
 * Antes, só a página da obra fazia isso (`unfavoriteWorkFromFolders`); o coração da tabela e o
 * lote não mexiam em `work_list_items`. Resultado: a obra saía dos favoritos e **continuava
 * listada no grupo** — o estado órfão "está na pasta mas não é favorita".
 *
 * ⚠️ É destrutivo e não tem volta: refavoritar NÃO devolve a obra ao grupo. Quem chama em lote
 * avisa antes (ver `countSelectedWorksInFolders`).
 *
 * O erro NÃO derruba a ação: o favorito em si já foi gravado, e falhar aqui só deixaria a
 * associação velha pra trás — melhor logar e seguir do que reverter um write que deu certo.
 */
async function purgeFoldersOnUnfavorite(ids: string[]) {
  const { error } = await purgeWorksFromAllLists(ids)
  if (error) console.error("[works] falha ao tirar obra(s) das pastas:", error)
}

export async function createWork(
  values: WorkFormValues,
  aiMeta?: CreateWorkAiMeta,
  externalReviews?: SourcedReview[],
  opts: { skipAiEnrichment?: boolean } = {},
) {
  // FATIA 2b — o Leitor free pode cadastrar uma obra que falta no catálogo, mas SEM QUEIMAR UM
  // TOKEN. A busca externa é scraping (grátis); a IA fica pendente pro Curador.
  const session = await ensureSignedIn()
  if (!session.ok) return { error: session.error }
  const perm = await ensurePermission("own_state")
  if (!perm.ok) return { error: perm.error }

  // Curador = quem pode curar o catálogo (rodar a IA, digitar notas). Todo o resto cria a obra
  // no modo pendente.
  const isCurator = (await ensurePermission("curate_ai")).ok

  // 🔴 O buraco que isto fecha: o form carrega as 9 NOTAS DE ATRIBUTO e as justificativas da
  // IA — e toda função exportada de um "use server" é um endpoint HTTP público. Sem esta
  // limpeza, um Leitor free postaria as notas que quisesse direto no CATÁLOGO, sem passar pela
  // IA e sem passar por você. Elas não são opinião dele: são fato da obra, e custam dinheiro.
  const safeValues: WorkFormValues = isCurator
    ? values
    : {
        ...values,
        ...Object.fromEntries(CRITERION_SLUGS.map((slug) => [slug, null])),
        ai_justifications: {},
      }

  const result = await persistNewWork(safeValues, isCurator ? aiMeta : undefined, {
    skipAiCascade: !isCurator,
    creatorId: session.userId,
    approvedByRole: isCurator,
  })
  if (!result.ok) return { error: result.error }
  // `skipAiEnrichment`: o usuário optou por salvar SEM o enriquecimento pago
  // (Flow B do popup de custo). Pula a inferência de tags (Haiku) e o resumo/
  // digest de reviews (Haiku/Sonnet). As reviews ainda são persistidas (exibição);
  // resumo/digest/tags podem ser gerados sob demanda depois. O scraping é grátis.
  //
  // Pro não-curador é FORÇADO: ele não escolhe gastar o saldo da Anthropic de outra pessoa.
  const skipAi = opts.skipAiEnrichment === true || !isCurator
  // Inferência de tags (Haiku) em background, SEQUENCIADA após as reviews E após o
  // resumo/digest (`awaitDigest: true` nos dois ramos abaixo) — o contexto de
  // leitores puxa tags que a sinopse omite (passada `--with-reviews` validada).
  // Sem esse await o digest (Sonnet, ~20s) era fire-and-forget e a inferência
  // SEMPRE o perdia: pagava-se o digest e as tags saíam só com o resumo.
  // Grava tags de alta confiança (source='ai_inferred'); se adicionou, marca
  // recalc pendente.
  const inferTagsForNewWork = async (workId: string) => {
    if (skipAi) return
    // Gate por configuração (toggle em /curation/settings). Desligado, a obra nasce sem
    // tags ai_inferred e você as gera depois. Default true preserva o histórico.
    if (!(await getTagInferenceOnCreate())) return
    // Lacuna #4: `inferAndPersistTagsForWork` lê `canonical_synopsis`; se a
    // consolidação (numa `after()` PARALELA) ainda não gravou, ela cai no fallback da
    // sinopse "mais longa" e infere do texto errado. Se a canônica-na-criação está
    // ligada, AGUARDA a consolidação antes de inferir — o single-flight dela dedupa
    // com a task de consolidação, então é um Haiku só. Desligada, não dispara nada: aí
    // o fallback pra sinopse mais longa é o comportamento correto.
    if (await getSynopsisCanonicalOnCreate()) {
      const { consolidateSynopsisForWork } = await import(
        "@/lib/ai-recommendation/consolidate-for-work"
      )
      await consolidateSynopsisForWork(workId)
    }
    const { inferAndPersistTagsForWork } = await import("@/lib/tags/auto-infer")
    const added = await inferAndPersistTagsForWork(workId)
    if (added > 0) await markRecalcPending("ai_inferred_tags_on_create")
  }

  // Descoberta do hid da Comix ANTES da aquisição de reviews. O `acquire` lê
  // `work_external_ids` uma única vez, no início; como a resolução da Comix mora
  // numa `after()` PARALELA (callbacks de `after()` não são fila — p-queue sem
  // opções = concurrency Infinity), o hid sempre chegava tarde e a Comix ficava
  // fora do 1º pool de reviews — logo, fora do resumo, do digest e das tags.
  //
  // Uma promise ÚNICA compartilhada pelas duas tasks: a de reviews espera por ela
  // antes de ler os ids; a de enriquecimento reusa o mesmo resultado em vez de
  // descobrir de novo (e, se o hid já foi persistido aqui, `resolveComixHidForWork`
  // curto-circuita direto pro enrich). Só a via barata/sidecar, com orçamento —
  // sem `COMIX_RENDER_URL` (prod hoje) é no-op imediato, comportamento idêntico.
  let comixHidPromise: Promise<boolean> | null = null
  const comixHidReady = () =>
    (comixHidPromise ??= import("@/server/comix/resolver").then((m) =>
      m.quickResolveComixHidForWork(result.workId),
    ))

  // Cascata "gerar todos os dados" (toggle /curation/settings, default off). Quando ligada,
  // a cascata (server/actions/generate-all.ts) faz a aquisição de reviews + tags +
  // resto em ordem — então pulamos aqui o fluxo leve de reviews/tags pra não
  // duplicar. Fica só o saveWorkReviews do Path B (persiste as reviews do eval).
  const generateAll = !skipAi && (await getGenerateAllOnCreate())

  if (externalReviews && externalReviews.length > 0) {
    // A avaliação (Path B) já buscou as reviews pra montar o prompt — reusa o
    // pool em vez de re-buscar na borda.
    //
    // TUDO em `after()`: o save agora aguarda resumo (Haiku) E digest (Sonnet) pra a
    // inferência de tags enxergar os dois — ~30s de IA que não podem segurar a
    // resposta do create. Antes o save era inline e já pendurava o resumo (~10s) na
    // resposta do usuário; sair da borda também devolve esse tempo.
    after(async () => {
      const { saveWorkReviews } = await import("@/lib/external/persist-reviews")
      // fromFreshEval: a obra acabou de ser avaliada com estas reviews ⇒ não marca
      // a avaliação como desatualizada (só atualiza o fingerprint do pool).
      await saveWorkReviews(result.workId, externalReviews, {
        fromFreshEval: true,
        skipPaidEnrichment: skipAi,
        awaitDigest: true,
      })
      if (!generateAll) await inferTagsForNewWork(result.workId)
    })
  } else if (!generateAll) {
    // Criada SEM avaliar: extrai + persiste reviews na borda, desacoplado da
    // avaliação, em background (`after()`). A obra passa a exibir reviews na
    // própria página sem esperar uma avaliação. No-op se não há IDs aceitos.
    // A inferência de tags roda DEPOIS, na MESMA task (reviews já persistidas).
    after(async () => {
      // Espera o hid da Comix (bounded) ANTES de ler os ids aceitos — senão a
      // Comix fica de fora deste pool e de tudo que é derivado dele.
      await comixHidReady()
      const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
      await acquireAndPersistWorkReviews(result.workId, {
        skipPaidEnrichment: skipAi,
        awaitDigest: true,
      })
      await inferTagsForNewWork(result.workId)
    })
  }

  // Resolve o hid da Comix na criação: a Comix não entra na busca multi-fonte
  // (precisa de browser real pro token), então a obra nasce sem hid e o app
  // nunca pegaria reviews de lá. Dispara a resolução escopada em background;
  // achado o hid, as reviews da Comix passam a fluir na próxima aquisição. Quando
  // a cascata está ligada, roda o resolve ANTES dela (na MESMA task) pra o hid já
  // estar presente no gate de fontes; a cascata termina em needs_authorization
  // (banner acionável na página da obra).
  after(async () => {
    // Mesma promise que a task de reviews aguarda: a descoberta barata roda UMA
    // vez. Se ela persistiu o hid, `resolveComixHidForWork` já entra pelo ramo
    // "resolved" e vai direto ao enrich, sem re-descobrir.
    await comixHidReady()
    const { resolveComixHidForWork } = await import("@/server/comix/resolver")
    await resolveComixHidForWork(result.workId)
    if (generateAll) {
      const { generateAllWorkData } = await import("@/server/actions/generate-all")
      await generateAllWorkData(result.workId)
    }
  })

  const slug = titleToSlug(values.title)

  // Recalc DEFERIDO (não-bloqueante): a obra recém-criada ainda não tem dados pra
  // uma Nota Prevista significativa (segue pra Avaliação IA) e adicionar um título
  // não-rotulado não muda o modelo global. Evita um recalc do catálogo inteiro a
  // cada create. A nota é preenchida no próximo recalc (auto ≥1h, "Recalcular
  // agora" ou o recalc do aceite da IA). Mesmo padrão que updateWork/createWorksBatch.
  await markRecalcPending("createWork")

  revalidatePath("/catalog")
  revalidatePath(`/catalog/${slug}`)
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  revalidateTag("score-color-thresholds", "max")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { id: result.workId, slug } }
}

/**
 * Versão "batch": insere a obra mas adia o recálculo para finalizePendingBatch().
 * Use quando for adicionar vários títulos em sequência.
 */
/**
 * Cadastra uma obra SEM gastar um token — o caminho do Leitor free (Fatia 2b).
 *
 * A regra que você definiu: o free pode criar obra nova, mas só com a BUSCA DE DADOS externa
 * (scraping das 8 fontes — não passa por `ensureAiConsumption`, não custa nada). O resto —
 * as 9 notas de atributo, a sinopse canônica, a inferência de tags — fica PENDENTE pro Curador
 * acionar. A obra nasce `ai_eval_status = "pending"` e cai na fila de /curation/works.
 *
 * ⚠️ O gate saiu de `ensureAdmin` para `own_state` + sessão. E o `skipAiCascade` não é
 * decoração: sem ele, esta função disparava a consolidação de sinopse por LLM em `after()` —
 * "pending" não era livre de IA, e o Leitor free estaria gastando o seu saldo da Anthropic
 * a cada obra cadastrada. Sem erro, sem log, direto na fatura.
 */
export async function createWorkPending(values: WorkFormValues) {
  const session = await ensureSignedIn()
  if (!session.ok) return { error: { _root: [session.error] } }
  const gate = await ensurePermission("own_state")
  if (!gate.ok) return { error: { _root: [gate.error] } }

  const isOwner = await canWriteSharedWorkRow(session.userId)
  // `curate_ai` e não `isOwner`: aprovar é decisão de PAPEL (migration 178), e `isOwner` responde
  // outra pergunta ("pode escrever na linha compartilhada"). Hoje coincidem; se um dia deixarem
  // de coincidir, o certo aqui é o papel.
  const isCurator = (await ensurePermission("curate_ai")).ok
  const result = await persistNewWork(values, undefined, {
    skipAiCascade: !isOwner,
    creatorId: session.userId,
    approvedByRole: isCurator,
  })
  if (!result.ok) return { error: result.error }

  revalidatePath("/catalog")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/catalog/new")
  revalidateFavorites()
  return { data: { id: result.workId } }
}

export interface CreateWorkBatchItem {
  values: WorkFormValues
  aiMeta?: CreateWorkAiMeta
  externalReviews?: SourcedReview[]
}

export async function createWorksBatch(
  items: Array<CreateWorkBatchItem | WorkFormValues>,
) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: { _root: [gate.error] } }
  // O estado pessoal do lote é de quem importou. ⚠️ `ensureAdmin()` NÃO diz que é o dono: um
  // segundo Curador passa nele e mesmo assim não pode herdar o estado pessoal de ninguém.
  const session = await ensureSignedIn()
  if (!session.ok) return { error: { _root: [session.error] } }
  if (items.length === 0) {
    return { error: { _root: ["Nenhuma obra para criar"] } }
  }

  const normalized: CreateWorkBatchItem[] = items.map((item) =>
    "values" in item ? item : { values: item }
  )

  const titleCounts = new Map<string, number>()
  for (const { values } of normalized) {
    for (const key of getComparableNames(values)) {
      titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
    }
  }

  const duplicatedTitle = [...titleCounts.entries()].find(([, count]) => count > 1)?.[0]
  if (duplicatedTitle) {
    return { error: { title: [`"${duplicatedTitle}" aparece mais de uma vez no lote`] } }
  }

  const created: Array<{ id: string; title: string }> = []
  const needEdgeReviews: string[] = []
  let saveWorkReviewsFn: typeof import("@/lib/external/persist-reviews").saveWorkReviews | null = null
  for (const { values, aiMeta, externalReviews } of normalized) {
    // O lote é `ensureAdmin()` lá em cima, então isto é sempre true hoje. Calculado mesmo assim,
    // e não fixado: se o gate do lote afrouxar um dia, `approved` acompanha em vez de mentir.
    const result = await persistNewWork(values, aiMeta, {
      creatorId: session.userId,
      approvedByRole: (await ensurePermission("curate_ai")).ok,
    })
    if (!result.ok) return { error: result.error, data: { created } }
    if (externalReviews && externalReviews.length > 0) {
      if (!saveWorkReviewsFn) {
        saveWorkReviewsFn = (await import("@/lib/external/persist-reviews")).saveWorkReviews
      }
      await saveWorkReviewsFn(result.workId, externalReviews)
    } else {
      needEdgeReviews.push(result.workId)
    }
    created.push({ id: result.workId, title: values.title })
  }

  // Paridade com createWork (que faz isso por obra): resolve o hid da Comix das
  // recém-criadas e extrai reviews na borda das que não vieram com pool. Um único
  // run "mop-up" do resolver (sem --work) evita N Chrome concorrentes no mesmo
  // userDataDir. Tudo em background.
  after(async () => {
    const { resolveComixHidsPending } = await import("@/server/comix/resolver")
    await resolveComixHidsPending(created.map((c) => c.id))
  })
  if (needEdgeReviews.length > 0) {
    after(async () => {
      const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
      for (const id of needEdgeReviews) await acquireAndPersistWorkReviews(id)
    })
  }

  // Recalc DEFERIDO (não-bloqueante): obras recém-criadas em lote ainda não têm
  // dados pra uma Nota Prevista significativa (vão direto pra Avaliação IA). Evita
  // um recalc global (re-treina o Ridge + recalcula ~todo o catálogo) a cada lote,
  // que só produziria uma nota sem sentido para essas obras. A Nota Prevista é
  // preenchida no próximo recalc (auto ≥1h, "Recalcular agora" ou o recalc do
  // aceite da IA). Mesmo padrão que updateWork usa.
  await markRecalcPending("createWorksBatch")

  revalidatePath("/catalog")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/catalog/new")
  revalidatePath("/ranking")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { created } }
}

/**
 * Conta quantas obras estão "pendentes de cálculo" — isto é, foram criadas
 * via createWorkPending e ainda não têm linha em calculated_scores.
 */
export async function getPendingBatchCount(): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, calculated_scores(id)")
    .eq("is_archived", false)
    .limit(2000)
  if (error) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pending = (data ?? []).filter((w: any) => !w.calculated_scores)
  return pending.length
}

/**
 * Finaliza o batch: dispara o recálculo orquestrado uma única vez (deduplicado).
 */
export async function finalizePendingBatch() {
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, calculated_scores(id)")
    .eq("is_archived", false)
    .limit(2000)
  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pending = (data ?? []).filter((w: any) => !w.calculated_scores).length

  const finalizeRecalc = await recalculateScoresNow()
  if (finalizeRecalc.status === "failed") throw new Error(finalizeRecalc.error)

  revalidatePath("/catalog")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/catalog/new")
  revalidatePath("/ranking")
  revalidatePath("/")
  revalidateFavorites()
  return { finalized: pending }
}

export async function updateWork(id: string, values: WorkFormValues, aiMeta?: CreateWorkAiMeta) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: { _root: [gate.error] } }
  const parsed = workFormSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data
  const supabase = createAdminClient()
  // `works_owner`: `user_score` aqui é a nota ANTERIOR do dono — ela alimenta o ledger de
  // previsões (`capturePredictionForFirstRating` / `resolvePredictionsForWork`). Lida de
  // `works` ela morre no `DROP`; lida da view, ela vem do espelho dele e sobrevive. O `title`
  // é catálogo e passa igual.
  // As colunas além de `title`/`user_score` existem só pro diff de materialidade
  // do `markRecalcPending` lá embaixo — são a MESMA linha, custo zero de query.
  const { data: existingWork } = await supabase
    .from("works_owner")
    .select(
      "title, user_score, original_title, year, year_end, publication_status_id, total_chapters, observation_adjustment, synopsis_quality",
    )
    .eq("id", id)
    .maybeSingle()
  const previousSlug = existingWork?.title ? titleToSlug(existingWork.title) : null
  const prevUserScore = (existingWork?.user_score as number | null | undefined) ?? null
  const nextSlug = titleToSlug(data.title)
  const titleSlugChanged = Boolean(previousSlug && nextSlug && previousSlug !== nextSlug)

  // Item 1 (alias de slug): ao renomear, guarda o slug ANTIGO em works.previous_slugs pra
  // getWorkBySlug redirecionar URLs antigas em vez de 404. Best-effort: se a coluna ainda não
  // existe (migration 162), a leitura falha → não grava, e o rename segue normal.
  let previousSlugsUpdate: string[] | undefined
  if (titleSlugChanged && previousSlug) {
    const { data: cur, error: readErr } = await supabase
      .from("works")
      .select("previous_slugs")
      .eq("id", id)
      .maybeSingle()
    if (!readErr && cur) {
      const existing = ((cur as { previous_slugs?: string[] | null }).previous_slugs ?? []) as string[]
      // Dedup e nunca lista o slug ATUAL como alias (ex.: rename A→B→A limpa o A).
      previousSlugsUpdate = Array.from(new Set([...existing, previousSlug])).filter((s) => s !== nextSlug)
    }
  }
  let knownGenres: Awaited<ReturnType<typeof filterKnownGenres>>
  try {
    knownGenres = await filterKnownGenres(supabase, data.genres ?? [])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: { genres: [message] } }
  }

  // ⚠️ Só CATÁLOGO (Fase E). A parte pessoal do form (status, capítulos, nota, ♥, anotações,
  // pós-leitura) vai pro espelho do dono logo abaixo — e SÓ pra lá.
  const { error } = await supabase
    .from("works")
    .update({
      title: data.title,
      original_title: data.original_title ?? null,
      alternative_titles: normalizeAlternativeTitles(data.alternative_titles ?? []),
      year: data.year ?? null,
      year_end: data.year_end ?? null,
      publication_status_id:
        getPublicationStatusIdByName(data.publication_status) ?? data.publication_status_id ?? null,
      total_chapters: data.total_chapters ?? null,
      ...(previousSlugsUpdate ? { previous_slugs: previousSlugsUpdate } : {}),
    })
    .eq("id", id)

  if (error) return { error: { _root: [error.message] } }

  // Espelha a parte pessoal do form (ver `personalPatchFromForm`) no estado de QUEM EDITA.
  // 🔴 Era `mirrorOwnerState(getOwnerUserId())`: com um 2º curador, a nota/♥/capítulos que ELE
  // preenchesse no form iam pra linha do DONO — mesma classe do bug fechado em `createWork`.
  // Com sessão (o form é interativo e o gate é ensureAdmin, então há sessão) vai no cliente de
  // sessão, RLS valendo; o fallback pro espelho do dono preserva qualquer caminho sem sessão.
  const editorId = await getSessionUserId()
  const personalMirror = editorId
    ? await writeReadingState(editorId, [id], personalPatchFromForm(data))
    : await mirrorOwnerState(await getOwnerUserId(), [id], personalPatchFromForm(data))
  if (personalMirror.error) return { error: { _root: [personalMirror.error] } }

  // Sincronizar notas por critério: upsert presentes, deletar removidos.
  // Preserva a origem AI quando o score não muda (mantém ai_accepted/ai_edited
  // + ai_evaluation_id). Se o score era AI e foi alterado pelo usuário, marca
  // como ai_edited preservando o ai_evaluation_id. Score novo ou que já era
  // manual permanece manual.
  const { data: existingScoreRows } = await supabase
    .from("category_scores")
    .select("criterion_slug, score, source, ai_evaluation_id")
    .eq("work_id", id)
  const existingByCriterion = new Map(
    (existingScoreRows ?? []).map((row) => [row.criterion_slug, row])
  )

  const aiJustifications = data.ai_justifications ?? {}
  const aiJustificationEntries = Object.entries(aiJustifications)
    .filter(([slug, justification]) =>
      CRITERION_SLUGS.includes(slug as (typeof CRITERION_SLUGS)[number]) &&
      justification?.trim() &&
      data[slug as keyof WorkFormValues] != null
    )

  let aiEvaluationId: string | null = null
  if (aiJustificationEntries.length > 0) {
    const { data: evaluation } = await supabase
      .from("ai_evaluations")
      .insert({
        work_id: id,
        status: "completed",
        model_name: aiMeta?.modelName ?? "external-ai-criteria",
        prompt_version: aiMeta?.promptVersion ?? "external-import-update",
        summary: aiMeta?.summary?.trim() || "Notas e explicações geradas durante a busca externa do título.",
        confidence: aiMeta?.confidence ?? null,
        raw_response: { criteriaJustifications: aiJustifications },
        input_hash: aiMeta?.inputHash ?? null,
      })
      .select("id")
      .single()

    if (evaluation) {
      aiEvaluationId = evaluation.id
      await supabase.from("ai_evaluation_scores").insert(
        aiJustificationEntries.map(([slug, justification]) => ({
          ai_evaluation_id: evaluation.id,
          criterion_slug: slug,
          suggested_score: Number(data[slug as keyof WorkFormValues]),
          accepted_score: Number(data[slug as keyof WorkFormValues]),
          was_accepted: true,
          was_edited: false,
          justification: justification.trim(),
        }))
      )
    }
  }

  const scores = CRITERION_SLUGS.flatMap((slug) => {
    const score = data[slug as keyof WorkFormValues]
    if (score == null) return []
    const numericScore = Number(score)
    const hasNewAi = aiEvaluationId != null && Boolean(aiJustifications[slug]?.trim())
    const prev = existingByCriterion.get(slug)
    const prevSource = prev?.source ?? null
    const wasAi = prevSource === "ai_accepted" || prevSource === "ai_edited"
    const sameValue = prev != null && Number(prev.score) === numericScore
    const source: "manual" | "ai_accepted" | "ai_edited" = wasAi
      ? hasNewAi
        ? "ai_accepted"
        : sameValue
          ? (prevSource as "ai_accepted" | "ai_edited")
          : "ai_edited"
      : hasNewAi
        ? "ai_accepted"
        : "manual"
    return [{
      work_id: id,
      criterion_slug: slug,
      score: numericScore,
      source,
      ai_evaluation_id: hasNewAi ? aiEvaluationId : wasAi ? prev?.ai_evaluation_id ?? null : null,
    }]
  })

  const slugsToDelete = CRITERION_SLUGS.filter((slug) => data[slug as keyof WorkFormValues] == null)
  if (slugsToDelete.length > 0) {
    await supabase
      .from("category_scores")
      .delete()
      .eq("work_id", id)
      .in("criterion_slug", slugsToDelete)
  }

  if (scores.length > 0) {
    await supabase
      .from("category_scores")
      .upsert(scores, { onConflict: "work_id,criterion_slug" })
  }

  // Estado anterior das plataformas — só pro diff. Precisa ser lido ANTES do
  // delete abaixo, e comparado por VALOR: o fluxo é delete-e-reinsere, então
  // "houve escrita" é sempre verdade e não diz nada sobre ter mudado.
  const { data: prevPlatformRows } = await supabase
    .from("platform_ratings")
    .select("platform, rating, vote_count")
    .eq("work_id", id)

  // Upsert plataformas
  const platforms = normalizePlatformRatings([
    { platform: "mangaupdates", rating: data.mu_rating, votes: data.mu_votes },
    { platform: "animeplanet", rating: data.ap_rating, votes: data.ap_votes },
    { platform: "comick", rating: data.cmx_rating, votes: data.cmx_votes },
    ...(data.extra_platform_ratings ?? []).map((p) => ({
      platform: p.platform,
      rating: p.rating,
      votes: p.votes,
    })),
  ])

  await supabase.from("platform_ratings").delete().eq("work_id", id)

  if (platforms.length > 0) {
    const { error: platformError } = await supabase
      .from("platform_ratings")
      .insert(
        platforms.map((p) => ({
          work_id: id,
          platform: p.platform,
          rating: p.rating ?? null,
          vote_count: p.votes ?? 0,
        }))
      )
    if (platformError) return { error: { _root: [platformError.message] } }
  }

  // Salvar tags. `work_tags` é feature (fit); `work_genres` NÃO — o recalc lê só
  // a primeira, por isso o resultado de `syncWorkGenres` não entra no diff.
  const tagSync = await syncWorkTags(supabase, id, data.tags ?? [])
  await syncWorkGenres(supabase, id, knownGenres.genreIds, "replace")
  // Arquivadas ANTES das ativas: se o insert das ativas falhar, o pior caso é uma
  // capa a mais no arquivo — e não uma capa arquivada que "desarquivou" sozinha.
  const archivedResult = await syncArchivedCovers(supabase, id, data.archived_covers)
  if (archivedResult.error) return { error: { covers: [archivedResult.error] } }
  // Defesa contra a lista incoerente: uma URL nas DUAS listas gravaria a capa e
  // a bloquearia ao mesmo tempo. Arquivada vence — é o lado recuperável: ela
  // aparece em "Arquivadas" com o botão de restaurar, em vez de virar uma capa
  // visível que o próximo "Atualizar dados" apaga sem explicação.
  const archivedUrlSet = new Set((data.archived_covers ?? []).map((a) => a.url))
  const activeCovers = data.covers?.filter((c) => !archivedUrlSet.has(c.url))
  const coversResult = await syncWorkCovers(supabase, id, activeCovers)
  if (coversResult.error) return { error: { covers: [coversResult.error] } }
  const synopsesResult = await syncWorkSynopses(supabase, id, normalizeFormSynopses(data))
  if (synopsesResult.error) return { error: { synopses: [synopsesResult.error] } }
  scheduleSynopsisConsolidation(id)
  await upsertWorkExternalIds(supabase, id, data.external_ids)

  // Atualizar status IA com base na cobertura de critérios
  const hasAllScores = scores.length >= CRITERION_SLUGS.length
  const hasCompletedEval =
    aiEvaluationId != null || (!hasAllScores && await hasCompletedAiEvaluation(supabase, id))
  await supabase
    .from("works")
    .update({ ai_eval_status: hasAllScores ? "done" : hasCompletedEval ? "review_pending" : "pending" })
    .eq("id", id)
    .neq("ai_eval_status", "skipped")

  // Editar a obra invalida o IA Rk (alignment_score) persistido — os atributos
  // que alimentam o re-rank mudaram. Marca como desatualizado (não recomputa;
  // re-rank é manual). No-op se a obra nunca foi rankeada.
  await markWorkAlignmentStale(id)

  // Validação prospectiva: se a obra ganhou a PRIMEIRA nota agora (null → valor),
  // congela a previsão de-registro (ainda pré-rótulo, pois o recalc é deferido).
  if (prevUserScore == null && data.user_score != null) {
    await capturePredictionForFirstRating(id, data.user_score)
  }

  // P1: resolve snapshots prospectivos (prediction_snapshots) com a nota real.
  // 1ª nota → resolve (imutável); edição → relabel (preserva a 1ª medição);
  // remoção → só carimba label_changed_at. Idempotente. Best-effort.
  if (data.user_score != null) {
    await resolvePredictionsForWork(id, data.user_score)
  } else if (prevUserScore != null) {
    await markPredictionLabelChanged(id)
  }

  // Editar a obra PODE mudar as features do Ridge global — e na maior parte das
  // vezes não muda: título, sinopse, capa, títulos alternativos, gêneros e
  // external ids não entram em nenhuma feature. Marca a base como pendente só
  // quando alguma entrada de `recalc-inputs.ts` de fato mudou de valor; quando
  // muda, a Nota Prevista atualiza no "Recalcular agora" ou no auto-recalc (≥1h).
  const ownerId = await getOwnerUserId()
  const editorIsOwner = (editorId ?? ownerId) === ownerId
  const changedForRecalc = changedInputs([
    ["original_title", existingWork?.original_title, data.original_title ?? null],
    ["year", existingWork?.year, data.year ?? null],
    ["year", existingWork?.year_end, data.year_end ?? null],
    [
      "publication_status",
      existingWork?.publication_status_id,
      getPublicationStatusIdByName(data.publication_status) ?? data.publication_status_id ?? null,
    ],
    ["total_chapters", existingWork?.total_chapters, data.total_chapters ?? null],
    // As 9 notas: `existingByCriterion` já estava em memória (é o que preserva a
    // proveniência AI). Conta remoção também — `slugsToDelete` some do vetor.
    [
      "category_scores",
      `${existingByCriterion.size}`,
      `${scores.length}`,
    ],
    ...scores.map(
      (row) =>
        [
          "category_scores",
          existingByCriterion.get(row.criterion_slug)?.score ?? null,
          row.score,
        ] as const,
    ),
    ["platform_ratings", platformRatingsDigest(prevPlatformRows), platformRatingsDigest(platforms)],
    ["work_tags", false, tagSync.changed],
    // Pessoais: só contam se quem editou for o dono — o `personalPatchFromForm`
    // vai pro espelho de QUEM EDITA, e o recalc global lê o do dono. Sem esta
    // guarda, um 2º curador salvando a ficha compararia a nota DELE com a DELE.
    ...(editorIsOwner
      ? ([
          ["user_score", existingWork?.user_score, data.user_score ?? null],
          [
            "observation_adjustment",
            existingWork?.observation_adjustment,
            data.observation_adjustment,
          ],
          ["synopsis_quality", existingWork?.synopsis_quality, data.synopsis_quality ?? null],
        ] as ReadonlyArray<readonly [RecalcInput, unknown, unknown]>)
      : []),
  ])
  await markRecalcPending("updateWork", { changed: changedForRecalc, actorId: editorId ?? ownerId })

  revalidatePath(`/catalog/${id}`)
  revalidatePath(`/catalog/${id}/edit`)
  if (previousSlug) {
    revalidatePath(`/catalog/${previousSlug}`)
    revalidatePath(`/catalog/${previousSlug}/edit`)
  }
  revalidatePath(`/catalog/${nextSlug}`)
  revalidatePath(`/catalog/${nextSlug}/edit`)
  revalidatePath("/catalog")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  revalidateTag("score-color-thresholds", "max")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { id, slug: nextSlug } }
}

/**
 * O curador decide sobre uma obra criada por não-curador (migration 178).
 *
 * `aprovar` → `approved = true`, carimba `approved_at`, o badge some.
 * `rejeitar` → ARQUIVA em vez de apagar. Reversível (`unarchiveWork` já existe), tira do
 *   ranking/recomendações/estatísticas, e não destrói o que a pessoa cadastrou — apagar seria
 *   irreversível num banco cujo backup é semanal. `approved` fica false: a obra não passou.
 *
 * ⚠️ `approved` NÃO é campo de formulário e não pode virar um. Toda função exportada daqui é
 * endpoint HTTP público; se a coluna entrasse no `workFormSchema`, qualquer pessoa faria POST
 * de `approved: true` na própria obra. Este é o único caminho de escrita, e ele é `ensureAdmin`.
 */
export async function setWorkApproval(id: string, aprovar: boolean) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()

  const { error } = await supabase
    .from("works")
    .update(
      aprovar
        ? { approved: true, approved_at: new Date().toISOString() }
        : { approved: false, approved_at: null, is_archived: true },
    )
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath(`/catalog/${id}`)
  revalidatePath("/catalog")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/")
  revalidateFavorites()
  return { data: null }
}

export async function archiveWork(id: string) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("works")
    .update({ is_archived: true })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/catalog")
  revalidateTag("works-slug-index", "max")
  revalidateTag("score-color-thresholds", "max")
  revalidatePath("/")
  revalidateFavorites()
  return { data: null }
}

export async function unarchiveWork(id: string) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("works")
    .update({ is_archived: false })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath(`/catalog/${id}`)
  revalidatePath("/catalog")
  revalidateTag("works-slug-index", "max")
  revalidateTag("score-color-thresholds", "max")
  revalidateFavorites()
  return { data: null }
}

/**
 * Override HUMANO da classificação 18+ (migração 161). É a garantia contra erro
 * da IA/tag: vence o `adult_auto`. Curadoria — `is_adult` mora na linha
 * compartilhada de `works`, então só o dono (ensureAdmin). Valores:
 *   true  → força 18+   | false → força limpo | null → volta ao automático.
 */
export async function setAdultOverride(id: string, value: boolean | null) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase.from("works").update({ adult_override: value }).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(`/catalog/${id}`)
  revalidatePath("/catalog")
  revalidatePath("/")
  return { data: null }
}

/**
 * Recalcula o piso/teto de `adult_content` (adult-content-rules.ts) com as tags
 * ATUAIS da obra e ajusta a nota persistida se estiver fora da faixa — a versão
 * "por obra, sob demanda" do que `scripts/adult-content-retroactive-bounds.ts`
 * faz em lote. Alimenta a fila de drift em /curation/settings (getAdultBoundsDriftQueue).
 */
function toAdultScoreTier(v: string | null | undefined): "label" | "explicit" | null {
  return v === "label" || v === "explicit" ? v : null
}

export async function applyAdultContentBoundsClamp(workId: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  const supabase = createAdminClient()

  const [{ data: wt }, { data: wg }, { data: cs }] = await Promise.all([
    supabase.from("work_tags").select("tags(name, tag_group_id, adult_score_tier)").eq("work_id", workId),
    supabase.from("work_genres").select("genres(name)").eq("work_id", workId),
    supabase
      .from("category_scores")
      .select("id, score")
      .eq("work_id", workId)
      .eq("criterion_slug", "adult_content")
      .maybeSingle(),
  ])
  if (!cs) return { ok: false, error: "obra sem nota adult_content" }

  const tags = ((wt ?? []) as unknown as Array<{
    tags: { name: string; tag_group_id: string | null; adult_score_tier: string | null } | null
  }>)
    .map((r) => r.tags)
    .filter((t): t is { name: string; tag_group_id: string | null; adult_score_tier: string | null } => !!t)
    .map((t) => ({
      name: t.name,
      group: t.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[t.tag_group_id] ?? null) : null,
      scoreTier: toAdultScoreTier(t.adult_score_tier),
    }))
  const genres = ((wg ?? []) as unknown as Array<{ genres: { name: string } | null }>)
    .map((r) => r.genres?.name)
    .filter((n): n is string => Boolean(n))

  const bounds = computeAdultContentBounds({ tags, genres })
  const oldScore = Number(cs.score)
  const newScore = clampAdultContentScore(oldScore, bounds)
  if (newScore === oldScore) return { ok: true }

  const { error } = await supabase.from("category_scores").update({ score: newScore }).eq("id", cs.id)
  if (error) return { ok: false, error: error.message }
  await markRecalcPending("adult-content-bounds-clamp")
  revalidatePath(`/catalog/${workId}`)
  revalidatePath("/curation/settings")
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Estado de LEITURA — FATIA 1 (PLANO-MULTIUSER-FASE2.md §13)
//
// Estes 4 writers eram `ensureAdmin()`, e TINHAM que ser: as colunas moram na linha
// compartilhada de `works`, então um Leitor marcando um capítulo estaria escrevendo no
// catálogo de todo mundo. Era isso que fazia do Leitor um espectador — sem poder favoritar
// nem marcar um capítulo. Agora o estado tem casa própria (`user_work_state`), e o gate pode
// ser o verbo certo: `own_state` (que o Leitor tem).
//
// A regra, em uma linha: **`user_work_state` sempre; `works` só se for o DONO.**
// Ver `server/queries/user-work-state.ts` pro porquê inteiro — e pro que acontece se alguém
// "simplificar" isso para um dual-write incondicional.
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * O gate (`ensureReadingStateWriter`) mora em `server/queries/user-work-state.ts` — o mesmo
 * módulo do writer. O Interesse ♥ enxuto (`setSynopsisQualityAction`, em synopsis-quality.ts)
 * usa exatamente este gate, e um gate duplicado é um gate que diverge.
 */

/**
 * Aplica o patch nos DOIS lugares, na ordem certa: primeiro o dado de quem clicou
 * (`user_work_state`), depois — e só se ele for o dono — o espelho compartilhado (`works`).
 * Se o espelho falhar, o estado pessoal já está salvo; o inverso perderia o clique.
 */
async function applyReadingState(
  gate: { userId: string; isOwner: boolean },
  workIds: string[],
  patch: ReadingStatePatch,
): Promise<{ error: string | null }> {
  // FASE E: uma escrita, um destino. O `if (gate.isOwner)` que espelhava o mesmo `patch` em
  // `works` saiu — a linha compartilhada não guarda mais estado pessoal de ninguém, nem do dono.
  // Ele lê do espelho desde a Fase D, então este segundo write não tinha mais leitor.
  return writeReadingState(gate.userId, workIds, patch)
}

export async function toggleFavorite(id: string, isFavorite: boolean) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: gate.error }

  const { error } = await applyReadingState(gate, [id], { is_favorite: isFavorite })
  if (error) return { error }
  if (!isFavorite) await purgeFoldersOnUnfavorite([id])

  revalidatePath(`/catalog/${id}`)
  revalidatePath("/catalog")
  revalidatePath("/ranking")
  revalidatePath("/favorites")
  revalidateTag("works-slug-index", "max")
  revalidateFavorites()
  return { data: null }
}

export async function setFavoriteMany(ids: string[], isFavorite: boolean) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: gate.error }
  const filtered = Array.from(new Set(ids.filter(Boolean)))
  if (filtered.length === 0) return { data: { count: 0 } }

  const { error } = await applyReadingState(gate, filtered, { is_favorite: isFavorite })
  if (error) return { error }
  if (!isFavorite) await purgeFoldersOnUnfavorite(filtered)

  revalidatePath("/catalog")
  revalidatePath("/ranking")
  revalidatePath("/favorites")
  revalidateTag("works-slug-index", "max")
  revalidateFavorites()
  return { data: { count: filtered.length } }
}

/**
 * Escrita ENXUTA do progresso de leitura, disparada in-loco pelo card da /reading
 * (stepper − / + e "Marcar até o último"). Grava só `chapters_read` (+ carimba
 * `last_read_at` quando o número CRESCE) — nada de nota, status ou pós-leitura, ao
 * contrário do `updateWorkStatus` completo. Sem recalc: `chapters_read` não é feature
 * do Ridge (o modelo usa `total_chapters`, não o quanto VOCÊ leu).
 *
 * Vai por `applyReadingState` → `user_work_state` (cliente de sessão): o dado é de quem
 * clicou, e a RLS da mig 142 barra escrever na linha de outra pessoa.
 *
 * Aplica as regras de `lib/reading/status-coherence.ts` do lado do progresso — teto no total
 * conhecido e promoção de "não comecei" pra "Reading". O campo digitável da faixa (que aceita
 * qualquer número) e o fato de server action ser endpoint público fazem disto obrigação, não
 * conveniência: o clamp do cliente é conforto, este aqui é a regra.
 *
 * ⚠️ `clampToTotal: false` existe pra UM caso REAL: a `/reading` marca "até o último lançado",
 * que vem da checagem externa (`latestExternal`) e legitimamente PASSA de `works.total_chapters`
 * quando o catálogo está defasado — é o cenário do capítulo agregado velho. Com o teto ligado ali,
 * "Marcar até o 132" gravaria 120 em silêncio, com o botão dizendo 132.
 */
export async function setChaptersRead(
  id: string,
  chaptersRead: number,
  opts: { clampToTotal?: boolean } = {},
) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: gate.error }

  const clampToTotal = opts.clampToTotal ?? true
  const raw = Math.floor(Number(chaptersRead))
  if (!Number.isFinite(raw) || raw < 0) return { error: "Número de capítulos inválido." }

  const supabase = createAdminClient()

  // Duas leituras minúsculas (1 coluna do catálogo + 2 do espelho de quem escreve). Poderiam
  // virar uma só com um embed, mas embed em `user_work_state` traria a linha inteira — e o
  // egress deste projeto morre exatamente assim (ver o cabeçalho do CLAUDE.md).
  const [{ data: work }, { data: current }] = await Promise.all([
    supabase.from("works").select("total_chapters").eq("id", id).maybeSingle(),
    // Estado atual DE QUEM ESCREVE (mora em user_work_state pra todo mundo desde a Fase E),
    // pra decidir o carimbo de `last_read_at`: só marca "li agora" quando o número avança —
    // corrigir um typo pra baixo não deve mexer na data de última leitura.
    supabase
      .from("user_work_state")
      .select("chapters_read, personal_status_id")
      .eq("user_id", gate.userId)
      .eq("work_id", id)
      .maybeSingle(),
  ])

  const total = (work?.total_chapters as number | null | undefined) ?? null
  const prev = (current?.chapters_read as number | null | undefined) ?? null
  // Teto = o maior entre o total do catálogo e o que já estava gravado: limitar o que a pessoa
  // digitou agora é correção, mas nunca às custas de progresso real já registrado.
  const { value: n, clamped } = clampChaptersRead(raw, clampToTotal ? chapterCeiling(total, prev) : null)

  const grew = prev == null || n > prev

  // "Não comecei" com capítulo lido é estado contraditório: quem marca progresso está lendo.
  // Trigger "chapters" — quem escolhe o status é a outra action, e lá a direção é outra.
  const promoted = promoteStatusForProgress(
    { personalStatus: (current?.personal_status_id as number | null | undefined) ?? null, chaptersRead: n },
    "chapters",
  )
  const promotedId = promoted ? getPersonalStatusIdByName(promoted) : null

  const patch: ReadingStatePatch = {
    chapters_read: n,
    ...(grew ? { last_read_at: new Date().toISOString().slice(0, 10) } : {}),
    ...(promotedId != null ? { personal_status_id: promotedId } : {}),
  }

  const { error } = await applyReadingState(gate, [id], patch)
  if (error) return { error }

  revalidatePath("/reading")
  revalidatePath("/catalog")
  revalidatePath("/catalog/[id]", "page")
  revalidatePath("/ranking")
  revalidatePath("/")
  revalidateFavorites()
  return {
    data: {
      chaptersRead: n,
      /** true ⇒ o pedido passava do total; a UI explica em vez de engolir o número digitado. */
      clamped,
      /** Nome do status novo quando a escrita promoveu a obra, senão null (a UI dá refresh). */
      promotedStatus: promotedId != null ? promoted : null,
    },
  }
}

/**
 * O estado de GOSTO (FATIA 2a): nota, anotações, interesse ♥ e as 8 pós-leitura.
 *
 * Até a Fatia 1 estes campos eram RECUSADOS para quem não é o dono — moravam só na linha
 * compartilhada de `works`, e aceitá-los teria sobrescrito a nota dele. Agora eles têm casa
 * própria em `user_work_state` e qualquer usuário logado pode avaliar.
 *
 * ⚠️ O que NÃO mudou, e é o coração da fatia: o **scoring continua lendo `works`**. O Ridge, a
 * chance, o viés de atributo, o ledger e o perfil de gosto treinam com os RÓTULOS DO DONO — e
 * `works` é onde eles moram. Por isso `works` só é escrita quando quem avalia é ele: se a nota
 * da Leitora entrasse ali, o modelo DELE passaria a aprender o gosto DELA, e a Nota Prevista de
 * 878 obras mudaria sem que ninguém tivesse pedido nada.
 *
 * Dividido em DOIS blocos porque o gate de leitura (lib/reading-gate.ts) só vale para um deles:
 * `notesPatchFrom` é PRÉ-leitura (o interesse ♥ é justamente a opinião sobre a sinopse de quem
 * ainda não leu) e passa sempre; `ratingPatchFrom` é pós-leitura e só passa com leitura
 * suficiente. Juntar os dois num patch só bloquearia as anotações de toda obra não-lida.
 */
function notesPatchFrom(data: WorkStatusValues): TasteStatePatch {
  return {
    observations: data.observations ?? null,
    observation_adjustment: data.observation_adjustment,
    synopsis_quality: data.synopsis_quality ?? null,
    // Proveniência (Plano 3): valor vindo do form = informado/aceito pelo usuário.
    synopsis_quality_source: data.synopsis_quality != null ? "human_manual" : null,
  }
}

function ratingPatchFrom(data: WorkStatusValues): TasteStatePatch {
  return {
    user_score: data.user_score ?? null,
    post_story_score: data.post_story_score ?? null,
    post_fl_score: data.post_fl_score ?? null,
    post_ml_score: data.post_ml_score ?? null,
    post_character_development_score: data.post_character_development_score ?? null,
    post_pacing_score: data.post_pacing_score ?? null,
    post_art_visual_score: data.post_art_visual_score ?? null,
    post_impact_immersion_score: data.post_impact_immersion_score ?? null,
    post_originality_score: data.post_originality_score ?? null,
  }
}

export async function updateWorkStatus(id: string, values: WorkStatusValues) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: { _root: [gate.error] } }
  const parsed = workStatusSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const data = parsed.data

  // "Não comecei" com capítulo lido é contradição → promove pra "Reading". Trigger "status"
  // porque aqui o usuário submeteu o form inteiro: nesse sentido a regra só vale pro status
  // DEFAULT (ver a nota de direção em lib/reading/status-coherence.ts — promover um "Untracked"
  // escolhido à mão tornaria impossível destrackear uma obra já lida). Espelha o auto-switch do
  // WorkStatusForm e fecha os caminhos que não passam por ele (a action é endpoint público).
  // O id é resolvido do nome mais abaixo (getPersonalStatusIdByName).
  const promoted = promoteStatusForProgress(
    { personalStatus: data.personal_status, chaptersRead: data.chapters_read },
    "status",
  )
  if (promoted) {
    data.personal_status = promoted as typeof data.personal_status
    data.personal_status_id = null
  }

  const supabase = createAdminClient()

  // O estado ATUAL do DONO (e, pra ele, a `user_score` anterior que o ledger de previsões usa).
  // Vem da view: é o espelho dele, não a linha compartilhada — que vai perder estas colunas.
  // Literal de propósito: o client do Supabase tipa o retorno a partir da STRING do select —
  // montá-la com template/`join()` devolve `ParserError`.
  const { data: sharedRow } = await supabase
    .from("works_owner")
    .select(
      `personal_status_id, chapters_read, last_read_at, total_chapters,
       user_score, observation_adjustment, observations, synopsis_quality,
       post_story_score, post_fl_score, post_ml_score, post_character_development_score,
       post_pacing_score, post_art_visual_score, post_impact_immersion_score,
       post_originality_score`,
    )
    .eq("id", id)
    .single()

  // ⚠️ O estado ANTERIOR tem que ser o DE QUEM ESTÁ ESCREVENDO. As regras de data abaixo
  // ("o capítulo cresceu?", "saiu de Want to Read?") dependem dele — com o estado do dono, a
  // Leitora que marca o capítulo 3 numa obra em que ele está no 200 não teria a data
  // carimbada, porque "não cresceu". Certo, e sem erro nenhum: só a data errada.
  let current: {
    personal_status_id: number | null
    chapters_read: number | null
    last_read_at: string | null
  } | null

  if (gate.isOwner) {
    current = sharedRow
      ? {
          personal_status_id: sharedRow.personal_status_id as number | null,
          chapters_read: sharedRow.chapters_read as number | null,
          last_read_at: toDay(sharedRow.last_read_at as string | null),
        }
      : null
  } else {
    const { data: own } = await supabase
      .from("user_work_state")
      .select("personal_status_id, chapters_read, last_read_at")
      .eq("user_id", gate.userId)
      .eq("work_id", id)
      .maybeSingle()
    current = own
      ? {
          personal_status_id: own.personal_status_id as number | null,
          chapters_read: own.chapters_read as number | null,
          last_read_at: toDay(own.last_read_at as string | null),
        }
      : null
  }

  // Só do DONO: é a nota DELE que o ledger de previsões resolve e que o Ridge treina.
  const prevUserScore = (sharedRow?.user_score as number | null | undefined) ?? null

  // Coerência do progresso, aplicada ao que vai ser GRAVADO (lib/reading/status-coherence.ts).
  // O total é do catálogo, então serve pra todo mundo — `works_owner` só personaliza as colunas
  // pessoais. Ordem importa: as duas correções entram ANTES de `chaptersGrew`/`nextLastReadAt`,
  // pra completar até o fim contar como leitura que avançou (e carimbar a data).
  const catalogTotal = (sharedRow?.total_chapters as number | null | undefined) ?? null
  if (data.chapters_read != null) {
    // `chapterCeiling` e não `catalogTotal` cru: quem já marcou 132 numa obra cujo catálogo diz
    // 120 (via "marcar até o último lançado" da /reading) não pode perder 12 capítulos só por
    // salvar o status. O teto limita o que foi digitado agora, não o que já estava lá.
    const ceiling = chapterCeiling(catalogTotal, current?.chapters_read ?? null)
    data.chapters_read = clampChaptersRead(data.chapters_read, ceiling).value
  }
  const completedChapters = chaptersForFullyRead({
    personalStatus: data.personal_status,
    chaptersRead: data.chapters_read,
    totalChapters: catalogTotal,
  })
  if (completedChapters != null) data.chapters_read = completedChapters

  const currentStatusName = current
    ? getPersonalStatusNameById(current.personal_status_id)
    : null
  const newStatus = data.personal_status
  const today = new Date().toISOString().slice(0, 10)
  const currentLastRead = current?.last_read_at ?? null
  const userTouchedDate =
    data.last_read_at !== undefined && (data.last_read_at ?? null) !== currentLastRead
  const chaptersGrew =
    data.chapters_read != null &&
    data.chapters_read > 0 &&
    (current?.chapters_read == null || data.chapters_read > current.chapters_read)

  let nextLastReadAt: string | null
  if (newStatus === DEFAULT_PERSONAL_STATUS) {
    nextLastReadAt = null
  } else if (userTouchedDate) {
    nextLastReadAt = data.last_read_at ?? null
  } else if (currentStatusName === DEFAULT_PERSONAL_STATUS || chaptersGrew) {
    nextLastReadAt = today
  } else {
    nextLastReadAt = currentLastRead
  }

  const readingState: ReadingStatePatch = {
    personal_status_id:
      getPersonalStatusIdByName(data.personal_status) ?? data.personal_status_id ?? null,
    chapters_read: data.chapters_read ?? null,
    last_read_at: nextLastReadAt,
  }
  // ── "Só avalia quem leu" (lib/reading-gate.ts), aplicada ao estado RESULTANTE do save.
  //
  // O gate existia só como visibilidade no cliente — e server action é endpoint público, então
  // ele não era regra nenhuma: a nota chegava aqui igual e `tastePatchFrom` a regravava. Pior,
  // o próprio form RECALCULA `user_score` dos `post_*` a cada render, inclusive com as seções
  // escondidas: bastava salvar o status de uma obra "Untracked" pra a nota voltar pro banco.
  //
  // Sem leitura suficiente, o bloco de AVALIAÇÃO é omitido do patch — o upsert do PostgREST só
  // escreve as colunas presentes, então o que já está gravado fica INTACTO. É de propósito:
  // apagar a nota aqui destruiria um rótulo do Ridge por causa de um clique de status. Quem
  // avisa da inconsistência é a UI (PostReadingFlow).
  const canRate = canRateReadingState({
    personalStatus: readingState.personal_status_id,
    chaptersRead: readingState.chapters_read,
    totalChapters: (sharedRow?.total_chapters as number | null | undefined) ?? null,
  })
  const personalState: PersonalStatePatch = {
    ...readingState,
    ...notesPatchFrom(data),
    ...(canRate ? ratingPatchFrom(data) : {}),
  }

  // ── Não-dono: TUDO dela (acompanhamento + gosto) vai pra `user_work_state`. `works` NÃO é
  // tocada — nem a nota, nem as observações. É o que impede a nota dela de virar o rótulo que
  // treina o modelo DELE.
  if (!gate.isOwner) {
    const write = await writeReadingState(gate.userId, [id], personalState)
    if (write.error) return { error: { _root: [write.error] } }

    // O MODELO DELA (Fatia 2b). Sem prediction ledger e sem `formula_config`: aquilo mede e
    // calibra o modelo do DONO. Aqui só recalculamos os scores DELA, em `user_calculated_scores`.
    //
    // Vai em `after()`: é Ridge em TS puro (zero IA, zero dinheiro), mas são ~880 obras — não é
    // trabalho pra segurar a resposta do clique. Best-effort: se falhar, o pior que acontece é
    // a Nota Prevista dela ficar uma avaliação atrasada, e o próximo save conserta.
    after(async () => {
      try {
        await recalculateForUser(gate.userId)
      } catch (err) {
        console.error("[updateWorkStatus] recalc do usuário falhou:", err)
      }
    })

    revalidatePath("/catalog/[id]", "page")
    revalidatePath("/catalog")
    revalidatePath("/ranking")
    revalidatePath("/reading")
    revalidatePath("/")
    revalidateFavorites()
    return { data: { id } }
  }

  // ── Dono: MESMO destino que qualquer outra pessoa (Fase E). O `update` em `works` que existia
  // aqui gravava o mesmo `personalState` que a linha abaixo já grava no espelho — inclusive a
  // nota que treina o Ridge, que desde a Fase B é lida do espelho. Era uma cópia sem leitor.
  const mirror = await writeReadingState(gate.userId, [id], personalState)
  if (mirror.error) return { error: { _root: [mirror.error] } }

  // O ledger de previsões só tem o que fazer quando a NOTA de fato mudou no banco. Sem leitura
  // suficiente o bloco de avaliação nem entrou no patch (ver `canRate` acima): a nota gravada
  // continua a de antes, e resolver/relabelar aqui mediria uma mudança que não aconteceu — o
  // ramo `markPredictionLabelChanged` chegaria a carimbar "rótulo removido" numa nota intacta.
  if (canRate) {
    // Validação prospectiva: primeira nota (null → valor) → congela a previsão
    // de-registro antes do recalc deferido incluir o rótulo.
    if (prevUserScore == null && data.user_score != null) {
      await capturePredictionForFirstRating(id, data.user_score)
    }

    // P1: resolve snapshots prospectivos (prediction_snapshots) com a nota real.
    // 1ª nota → resolve (imutável); edição → relabel (preserva a 1ª medição);
    // remoção → só carimba label_changed_at. Idempotente. Best-effort.
    if (data.user_score != null) {
      await resolvePredictionsForWork(id, data.user_score)
    } else if (prevUserScore != null) {
      await markPredictionLabelChanged(id)
    }
  }

  // Diff, não "houve save". O form do Meu Status grava status, capítulos, a data,
  // as observações e as 8 `post_*` — nenhuma delas é feature nem rótulo. Só três
  // colunas do patch movem número, e o estado anterior das três já veio no
  // `sharedRow` lido lá em cima: o diff aqui não custa uma query a mais.
  //
  // A checagem é `in personalState` porque o patch é PARCIAL: sem leitura
  // suficiente, `ratingPatchFrom` nem entra (ver `canRate`), a nota gravada
  // continua a de antes — e comparar contra um campo ausente diria "virou null".
  const changedInputsFromStatus = changedInputs(
    (
      [
        ["user_score", "user_score"],
        ["observation_adjustment", "observation_adjustment"],
        ["synopsis_quality", "synopsis_quality"],
      ] as const
    )
      .filter(([column]) => column in personalState)
      .map(
        ([column, input]) =>
          [
            input,
            sharedRow?.[column as keyof typeof sharedRow] ?? null,
            personalState[column as keyof PersonalStatePatch] ?? null,
          ] as const,
      ),
  )
  await markRecalcPending("updateWorkStatus", { changed: changedInputsFromStatus })

  revalidatePath("/catalog/[id]", "page")
  revalidatePath("/catalog")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidateTag("tags-catalog", "max")
  revalidatePath("/reading")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { id } }
}

/**
 * Troca o status de leitura (personal_status) de VÁRIAS obras de uma vez —
 * action enxuta pra aba "Untracked" do /curation/works e pro atalho da faixa da página da obra.
 * Ao contrário de `updateWorkStatus` (form completo), não toca notas nem observações; de
 * capítulos só mexe pra manter a coerência de "Finished" (ver abaixo).
 */
export async function setReadingStatusForWorks(ids: string[], status: string) {
  const gate = await ensureReadingStateWriter()
  if (!gate.ok) return { error: gate.error }
  const cleanIds = [...new Set((ids ?? []).filter(Boolean))]
  if (cleanIds.length === 0) return { error: "Nenhuma obra selecionada." }
  const statusId = getPersonalStatusIdByName(status)
  if (statusId == null) return { error: `Status de leitura inválido: ${status}` }

  const supabase = createAdminClient()

  const { error } = await applyReadingState(gate, cleanIds, { personal_status_id: statusId })
  if (error) return { error }

  // "Finished" = leu a obra INTEIRA, então os capítulos acompanham. Sem isto, o atalho da faixa
  // (que só grava o status) deixa "Finished com 6/26" — o estado que abriu esta mudança. É a
  // mesma regra que o WorkStatusForm já aplicava, só que ali ela morava num useEffect e valia
  // apenas pra quem passasse pelo diálogo.
  //
  // Escreve em grupos por total: um patch só não serve, cada obra tem o seu. E NÃO carimba
  // `last_read_at` de propósito — marcar 50 obras antigas como lidas em lote não é "li hoje", e
  // a data alimenta as bandas de ritmo da /reading (lib/reading/pace-bands.ts).
  let syncedChapters = 0
  if (isFullyReadPersonalStatus(statusId)) {
    const idsByTotal = new Map<number, string[]>()
    // Fatia em 500: `select().in()` corta em 1000 linhas SEM AVISO, e um lote grande viraria
    // "sincronizei tudo" tendo sincronizado os primeiros mil.
    for (let i = 0; i < cleanIds.length; i += 500) {
      const chunk = cleanIds.slice(i, i + 500)
      const { data: rows } = await supabase
        .from("works")
        .select("id, total_chapters")
        .in("id", chunk)
      for (const row of rows ?? []) {
        const total = Number(row.total_chapters)
        if (!Number.isFinite(total) || total <= 0) continue
        const bucket = idsByTotal.get(total)
        if (bucket) bucket.push(row.id as string)
        else idsByTotal.set(total, [row.id as string])
      }
    }
    for (const [total, ids] of idsByTotal) {
      const { error: chaptersError } = await applyReadingState(gate, ids, { chapters_read: total })
      // Falha aqui não desfaz o status: ele é o que a pessoa pediu, os capítulos são o
      // arredondamento. Reportar o erro cancelaria uma escrita que deu certo.
      if (chaptersError) console.error("[setReadingStatusForWorks] capítulos:", chaptersError)
      else syncedChapters += ids.length
    }
  }

  // Recalc NÃO é marcado aqui, de propósito: esta action só grava `personal_status_id`
  // e `chapters_read` (o `chapters_read = total` do ramo "Finished" é o arredondamento
  // do status, não o `total_chapters` do catálogo). Nenhuma das duas colunas é feature
  // do Ridge nem rótulo — ver `lib/calculations/recalc-inputs.ts`. Marcava antes, e
  // 100% dos disparos eram inócuos: badge aceso, recálculo devolvendo os mesmos números.

  revalidatePath("/reading")
  revalidatePath("/curation/works")
  revalidatePath("/my-ai-scores")
  revalidateTag("ai-eval-tab-counts", "max")
  revalidatePath("/catalog")
  // A própria página da obra: desde os controles rápidos da faixa (status/♥), esta action é
  // chamada de DENTRO dela — sem isto o badge voltaria ao valor antigo no refresh.
  revalidatePath("/catalog/[id]", "page")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/ranking")
  revalidatePath("/")
  revalidateFavorites()
  return { data: { updated: cleanIds.length, syncedChapters } }
}

/**
 * Corrige o STATUS DE PUBLICAÇÃO de uma obra — a saída oferecida pelo aviso de coerência
 * ("marquei Finished, mas o catálogo diz Ongoing porque a obra terminou e ninguém atualizou").
 *
 * É catálogo, não estado pessoal: a linha é COMPARTILHADA, então o gate é `ensureAdmin` — quem
 * não for curador vê só as opções pessoais no aviso.
 *
 * Escreve `publication_status_id` e mais nada. NÃO carimba `data_refreshed_at`: isso significa
 * "os dados vieram de fonte externa agora", e aqui quem sabe é a pessoa, não a fonte.
 */
export async function setPublicationStatusForWork(id: string, status: string) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }

  const statusId = getPublicationStatusIdByName(status)
  if (statusId == null) return { error: `Status de publicação inválido: ${status}` }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("works")
    .update({ publication_status_id: statusId })
    .eq("id", id)
  if (error) return { error: error.message }

  revalidatePath("/catalog/[id]", "page")
  revalidatePath("/catalog")
  revalidatePath("/ranking")
  revalidatePath("/reading")
  revalidateFavorites()
  return { data: { publicationStatusId: statusId } }
}

export async function deleteWork(id: string) {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  const supabase = createAdminClient()
  const { error } = await supabase.from("works").delete().eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/catalog")
  revalidateTag("works-slug-index", "max")
  revalidatePath("/")
  revalidateFavorites()
  return { data: null }
}

export interface ExternalWorkUpdate {
  title?: string
  originalTitle?: string | null
  alternativeTitles?: string[]
  synopsis?: string | null
  coverUrl?: string | null
  /** Lista completa de capas escolhidas no multipick. Quando presente, faz upsert
   *  preservando capas existentes não listadas (apenas troca primária). Tem
   *  precedência sobre coverUrl. */
  covers?: Array<{ url: string; source: string; isPrimary: boolean }>
  /** URLs que estavam arquivadas (migration 163) e o usuário restaurou no diálogo.
   *  O server tira do `work_cover_archive` ANTES do syncExternalCovers, senão o
   *  filtro de arquivadas as barraria de novo e o restaurar não pegaria. Devem
   *  também constar em `covers` pra serem de fato inseridas. */
  restoredCoverUrls?: string[]
  /** Idem capas, mas para sinopses (chave: texto). */
  synopses?: Array<{ text: string; source: string; isPrimary: boolean }>
  publicationStatus?: string | null
  totalChapters?: number | null
  genres?: string[]
  tags?: string[]
  platformRatings?: Array<{ platform: string; rating?: number | null; votes?: number | null }>
  externalIds?: Record<string, string>
  /**
   * "Status in Country of Origin" cru do MangaUpdates → `works.publication_status_note`, e
   * daí `works.hiatus_kind` (migration 183).
   *
   * 🔴 Isto ERA `observations`, e o lugar estava errado. `observations` mora em
   * `user_work_state` desde a Fase F — é anotação PESSOAL do leitor —, então "Atualizar
   * dados" gravava um fato da obra na linha de quem clicou, e só quando o campo estava
   * vazio. Medido nas 97 obras em hiato: o texto da fonte convivia com anotação da curadora
   * na mesma string ("Hiatus since 11/20/2025 ⏎ Sem explicação do motivo ⏎ S4: 52 Chapters").
   *
   * ⚠️ Sem a condição "só se estiver vazio" que o client aplicava: aqui o dono é a FONTE, e
   * uma nota nova sobrescreve a velha, como todo o resto do catálogo neste caminho.
   */
  publicationStatusNote?: string | null
}

export async function updateWorkExternalData(
  id: string,
  updates: ExternalWorkUpdate,
  opts: { acquireReviews?: boolean } = {},
) {
  // `updates` vem ESCOLHIDO PELO CLIENTE (capa, sinopse, resolução de conflito) — é
  // curadoria pura. Só o Curador. O Assinante entra por `autoRefreshWorkData`, onde
  // quem monta o payload é o servidor.
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  return doUpdateWorkExternalData(id, updates, opts)
}

/** Núcleo da gravação, SEM gate. Não exportado (ver nota em doRefreshWorkExternalData). */
async function doUpdateWorkExternalData(
  id: string,
  updates: ExternalWorkUpdate,
  opts: { acquireReviews?: boolean } = {},
) {
  try {
    const supabase = createAdminClient()
    const { data: existingWork } = await supabase
      .from("works")
      // `publication_status_id` entra porque a nota de status precisa saber se a obra está em
      // hiato para virar `hiatus_kind`, e o caller pode mandar a nota sem mandar o status.
      .select("title, publication_status_id")
      .eq("id", id)
      .maybeSingle()
    const previousSlug = existingWork?.title ? titleToSlug(existingWork.title) : null
    const knownGenres = updates.genres !== undefined
      ? await filterKnownGenres(supabase, updates.genres)
      : null

    const workFields: Record<string, unknown> = {}
    if (updates.title !== undefined) workFields.title = updates.title
    if (updates.originalTitle !== undefined) workFields.original_title = updates.originalTitle ?? null
    if (updates.alternativeTitles !== undefined) {
      workFields.alternative_titles = normalizeAlternativeTitles(updates.alternativeTitles)
    }
    if (updates.publicationStatus !== undefined) {
      workFields.publication_status_id = getPublicationStatusIdByName(updates.publicationStatus)
    }
    if (updates.totalChapters !== undefined) workFields.total_chapters = updates.totalChapters ?? null

    // ⚠️ Depende do STATUS, então precisa dele mesmo quando o caller não o mandou — senão uma
    // atualização que só traz a nota classificaria contra `undefined` e zeraria o tipo de
    // hiato de uma obra que segue em hiato. Cai pro status já gravado nesse caso.
    if (updates.publicationStatusNote !== undefined) {
      const statusName = updates.publicationStatus !== undefined
        ? updates.publicationStatus
        : getPublicationStatusNameById(existingWork?.publication_status_id ?? null)
      Object.assign(workFields, hiatusFieldsFor(updates.publicationStatusNote, statusName))
    }

    // "Atualizar dados" sempre carimba o timestamp de refresh de dados —
    // separado de updated_at (que o trigger toca em qualquer edição da linha).
    workFields.data_refreshed_at = new Date().toISOString()

    const { error } = await supabase.from("works").update(workFields).eq("id", id)
    if (error) return { error: error.message }

    // ✅ Este caminho voltou a ser 100% CATÁLOGO. Ele escrevia `observations` — a única coluna
    // pessoal que tocava — para guardar o "Status in Country of Origin" do MU; hoje esse texto
    // tem coluna própria em `works` (`publication_status_note`, acima). A anotação do leitor
    // segue sendo dele, e "Atualizar dados" não a sobrescreve mais.

    // Desarquivar ANTES de gravar capas: o usuário restaurou estas no diálogo, e o
    // filtro do syncExternalCovers barra tudo que ainda está no arquivo. Some daqui
    // primeiro pra a capa restaurada passar. Só as que voltam mesmo (o cliente já
    // manda a interseção com o que foi de fato incluído).
    if (updates.restoredCoverUrls?.length) {
      const { error: unarchiveError } = await supabase
        .from("work_cover_archive")
        .delete()
        .eq("work_id", id)
        .in("url", updates.restoredCoverUrls)
      if (unarchiveError) return { error: `Falha ao restaurar capas: ${unarchiveError.message}` }
    }

    // Capas: se vier o array `covers` (multipick), upserta cada uma preservando
    // capas existentes que não estão na lista (só zera primária delas). Caso
    // contrário, cai no fallback de `coverUrl` único.
    if (updates.covers !== undefined) {
      const result = await syncExternalCovers(supabase, id, updates.covers)
      if (result.error) return { error: result.error }
    } else if (typeof updates.coverUrl === "string" && updates.coverUrl.trim().length > 0) {
      const result = await syncExternalCovers(supabase, id, [
        { url: updates.coverUrl, source: "manual", isPrimary: true },
      ])
      if (result.error) return { error: result.error }
    }

    let synopsesTouched = false
    if (updates.synopses !== undefined) {
      const result = await syncWorkSynopses(supabase, id, updates.synopses)
      if (result.error) return { error: result.error }
      synopsesTouched = true
    } else if (typeof updates.synopsis === "string" && updates.synopsis.trim().length > 0) {
      const result = await syncWorkSynopses(supabase, id, [
        { source: "manual", text: updates.synopsis, isPrimary: true },
      ])
      if (result.error) return { error: result.error }
      synopsesTouched = true
    }
    if (synopsesTouched) scheduleSynopsisConsolidation(id)

    if (updates.platformRatings?.length) {
      const platforms = normalizeExternalPlatformUpdates(updates.platformRatings)
      if (platforms.length > 0) {
        const platformNames = platforms.map((p) => p.platform)
        const { data: existingRatings, error: existingRatingsError } = await supabase
          .from("platform_ratings")
          .select("platform, rating, vote_count")
          .eq("work_id", id)
          .in("platform", platformNames)

        if (existingRatingsError) return { error: existingRatingsError.message }

        const existingByPlatform = new Map(
          (existingRatings ?? []).map((p) => [normalizePlatformName(p.platform), p])
        )

        const rows = platforms.map((p) => {
          const existing = existingByPlatform.get(p.platform)
          return {
            work_id: id,
            platform: p.platform,
            rating: p.rating ?? existing?.rating ?? null,
            vote_count: p.votes ?? existing?.vote_count ?? 0,
          }
        })

        const { error: platformError } = await supabase
          .from("platform_ratings")
          .upsert(rows, { onConflict: "work_id,platform" })

        if (platformError) return { error: platformError.message }
      }
    }

    if (updates.tags !== undefined || knownGenres) {
      await syncWorkTagsPartial(
        supabase,
        id,
        updates.tags,
        knownGenres?.genreIds ?? []
      )
    }

    await upsertWorkExternalIds(supabase, id, updates.externalIds)

    // Aquisição na BORDA: colhe + persiste reviews das fontes confirmadas agora
    // (opt-in — só o fluxo de "atualizar dados" pede; o enrich em massa NÃO, pra
    // não scrapar N obras) + enrich do Comix (capa/sinopse/rating) se um hid foi
    // (re)vinculado. Roda em background (`after()`), sem bloquear a resposta. Como o
    // Mangago é lento (~60s), registramos um JOB running→done (`update-jobs`, em
    // memória) pra a página da obra dar feedback visual de que terminou
    // (`UpdateProgressWatcher`) em vez de o usuário recarregar às cegas. Best-effort.
    const needsComixEnrich = Boolean(updates.externalIds?.comix?.trim())
    if (opts.acquireReviews || needsComixEnrich) {
      startUpdateJob(id)
      after(async () => {
        let reviewsAdded: number | undefined
        try {
          const countReviews = async (): Promise<number> =>
            (await supabase
              .from("work_reviews")
              .select("id", { count: "exact", head: true })
              .eq("work_id", id)).count ?? 0
          const before = opts.acquireReviews ? await countReviews() : 0
          const tasks: Array<Promise<unknown>> = []
          if (opts.acquireReviews) {
            const { acquireAndPersistWorkReviews } = await import("@/lib/external/acquire-reviews")
            tasks.push(acquireAndPersistWorkReviews(id))
          }
          if (needsComixEnrich) {
            const { resolveComixDataResilient } = await import("@/server/comix/resolver")
            tasks.push(resolveComixDataResilient(id))
          }
          await Promise.allSettled(tasks)
          if (opts.acquireReviews) reviewsAdded = Math.max(0, (await countReviews()) - before)
        } finally {
          finishUpdateJob(id, { reviewsAdded })
        }
      })
    }

    // "Atualizar dados" mexe em ratings/sinopse/tags que alimentam o re-rank →
    // invalida o IA Rk (alignment_score) persistido. Marca como desatualizado
    // (não recomputa; re-rank é manual). No-op se a obra nunca foi rankeada.
    await markWorkAlignmentStale(id)

    await markRecalcPending("updateWorkExternalData")
    const nextSlug = titleToSlug(
      typeof updates.title === "string" && updates.title.trim()
        ? updates.title
        : existingWork?.title ?? ""
    )
    revalidatePath(`/catalog/${id}`)
    if (previousSlug) {
      revalidatePath(`/catalog/${previousSlug}`)
      revalidatePath(`/catalog/${previousSlug}/edit`)
    }
    revalidatePath(`/catalog/${nextSlug}`)
    revalidatePath(`/catalog/${nextSlug}/edit`)
    revalidatePath("/catalog")
    revalidateTag("works-slug-index", "max")
    revalidatePath("/")
    return { data: { id, slug: nextSlug } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[updateWorkExternalData] Uncaught error:", message)
    return { error: message }
  }
}

// ============================================================================
// Refresh external data using persisted IDs (no title search, no AI evaluation)
// ============================================================================

export type RefreshWorkExternalDataResult =
  | { ok: true; data: ExternalWorkData; conflicts: ConflictField[]; sources: ExternalSourceId[] }
  | { ok: false; reason: "NO_IDS" | "ALL_404" | "FORBIDDEN"; message?: string }

function buildCandidateFromStoredIds(
  work: { title: string; original_title: string | null; alternative_titles: string[] | null },
  rows: Array<{ source: string; external_id: string }>
): MergedCandidate {
  return buildCandidateFromExternalIds({
    title: work.title,
    originalTitle: work.original_title ?? undefined,
    alternativeTitles: work.alternative_titles ?? [],
  }, Object.fromEntries(rows.map((row) => [row.source, row.external_id])) as Partial<Record<ExternalSourceId, string>>)
}

export async function refreshWorkExternalData(workId: string): Promise<RefreshWorkExternalDataResult> {
  // Re-hidrata a obra do catálogo compartilhado a partir das fontes externas
  // (sobrescreve capa/sinopse/notas de plataforma) → curadoria, não leitura.
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, reason: "FORBIDDEN", message: gate.error }
  return doRefreshWorkExternalData(workId)
}

/**
 * Núcleo do refresh, SEM gate. NÃO é exportado de propósito: num arquivo "use server",
 * export = endpoint HTTP público. Os dois chamadores (o fluxo do Curador e o
 * automático do Assinante) põem o gate ANTES de chegar aqui.
 */
async function doRefreshWorkExternalData(workId: string): Promise<RefreshWorkExternalDataResult> {
  const supabase = createAdminClient()

  const { data: work, error: workError } = await supabase
    .from("works")
    .select("title, original_title, alternative_titles")
    .eq("id", workId)
    .single()
  if (workError || !work) {
    return { ok: false, reason: "NO_IDS", message: workError?.message }
  }

  const { data: idRows } = await supabase
    .from("work_external_ids")
    .select("source, external_id, is_rejected")
    .eq("work_id", workId)
    .not("external_id", "is", null)
    .eq("is_rejected", false)

  if (!idRows || idRows.length === 0) {
    console.log(`[refreshWorkExternalData] no stored IDs for work=${workId}, falling back to search`)
    return { ok: false, reason: "NO_IDS" }
  }

  const candidate = buildCandidateFromStoredIds(work, idRows)
  console.log(`[refreshWorkExternalData] work=${workId} sources=${candidate.sources.join(",")}`)

  try {
    const result = await fetchExternalData(candidate)
    const acceptedSources = result.data.externalIds ? Object.keys(result.data.externalIds) : []
    if (acceptedSources.length === 0) {
      return { ok: false, reason: "ALL_404" }
    }
    return { ok: true, data: result.data, conflicts: result.conflicts, sources: candidate.sources }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[refreshWorkExternalData] fetch failed:", message)
    return { ok: false, reason: "ALL_404", message }
  }
}

export type AutoRefreshWorkResult =
  | { ok: true; updatedFields: string[]; skippedConflicts: string[]; sources: ExternalSourceId[] }
  | { ok: false; error: string }

/**
 * Atualização AUTOMÁTICA de uma obra — o caminho do ASSINANTE.
 *
 * Segurança está na ASSINATURA: o cliente manda só o `workId`. Quem busca nas fontes,
 * funde e grava é o servidor. Não existe payload de conteúdo pra ele forjar — é a
 * diferença essencial pra `updateWorkExternalData`, que recebe o que o cliente
 * escolheu e por isso continua exclusiva do Curador.
 *
 * O que grava está em `buildAutoRefreshPlan` (função pura, testada): só o que
 * ENVELHECE (status, capítulos, notas de plataforma, tags, IDs), nunca o que é
 * ESCOLHA (título, sinopse e capa primárias). Campo em conflito com o que está salvo
 * é PULADO — sem humano pra decidir, preservar o que o Curador deixou é o certo.
 *
 * `acquireReviews: false` de propósito: colher reviews dispara o digest (Sonnet) na
 * chave do dono. Enquanto não houver rate-limit por usuário (o P0 do PLANO-FREE-PAGO
 * §6), um clique do Assinante NÃO pode custar LLM. Reviews seguem só com o Curador.
 */
export async function autoRefreshWorkData(workId: string): Promise<AutoRefreshWorkResult> {
  const gate = await ensurePermission("refresh_work")
  if (!gate.ok) return { ok: false, error: gate.error }
  if (!workId) return { ok: false, error: "Obra não informada." }

  const refreshed = await doRefreshWorkExternalData(workId)
  if (!refreshed.ok) {
    const message =
      refreshed.reason === "NO_IDS"
        ? "Esta obra ainda não tem fontes externas vinculadas — só o Curador consegue vinculá-las."
        : (refreshed.message ?? "As fontes externas não responderam. Tente de novo mais tarde.")
    return { ok: false, error: message }
  }

  const plan = buildAutoRefreshPlan(refreshed.data, refreshed.conflicts)
  if (Object.keys(plan.updates).length === 0) {
    return { ok: true, updatedFields: [], skippedConflicts: plan.skippedConflicts, sources: refreshed.sources }
  }

  const result = await doUpdateWorkExternalData(workId, plan.updates, { acquireReviews: false })
  if (result?.error) return { ok: false, error: result.error }

  return {
    ok: true,
    updatedFields: Object.keys(plan.updates),
    skippedConflicts: plan.skippedConflicts,
    sources: refreshed.sources,
  }
}
