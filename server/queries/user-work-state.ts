import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { createUserClient } from "@/lib/supabase/user"
import { getCurrentUserId, getOwnerUserId } from "./current-user"
import type { SynopsisQuality, SynopsisQualitySource } from "@/types/domain"

// ═══════════════════════════════════════════════════════════════════════════════════════
// Estado de LEITURA per-usuário — FATIA 1 (PLANO-MULTIUSER-FASE2.md §13)
//
// Este arquivo é o ÚNICO lugar que responde às duas perguntas da fatia:
//   1. de onde vem o estado de leitura de quem está olhando?   (get)
//   2. para onde vai o estado de leitura de quem está clicando? (write)
// Espalhar essas respostas seria repetir 8 vezes uma decisão que erra em silêncio.
//
// ── O modelo ───────────────────────────────────────────────────────────────────────────
//
// As 4 colunas (`is_favorite`, `personal_status_id`, `chapters_read`, `last_read_at`) moram
// na linha COMPARTILHADA de `works`. Não existe "obra do fulano" — existe uma obra com lugar
// para UM leitor. Logo, o estado que está em `works` é o do DONO (o singleton).
//
//   LEITURA   dono      → `works`            (fonte de verdade hoje — ver o porquê abaixo)
//             os demais → `user_work_state`  (as próprias linhas, SEM fallback)
//
//   ESCRITA   todos     → `user_work_state`  (sempre; cliente de SESSÃO, a RLS vale)
//             dono      → `works` também     (mantém o espelho compartilhado de pé)
//
// ⚠️ Por que o DONO ainda lê de `works`, e não do espelho. Oito writers escrevem essas
// colunas, não quatro: além de `toggleFavorite`/`setFavoriteMany`/`updateWorkStatus`/
// `setReadingStatusForWorks` (que esta fatia converte), também `createWork`, `updateWork`,
// `addWorksToList` (marca favorito ao pôr num grupo) e o **import de CSV**
// (`lib/import/processor.ts` grava `personal_status_id`/`chapters_read` em massa). Esses
// quatro são caminhos de CURADORIA e continuam gravando direto em `works` nesta fatia.
//
// Se o espelho fosse a fonte do dono, um import de planilha atualizaria `works` e a /leitura
// dele mostraria os capítulos ANTIGOS — sem erro e sem log, o modo de falha que este projeto
// já pagou caro. Lendo `works`, o dono é imune: para ele, nada muda. O espelho existe pra
// (a) servir os OUTROS usuários e (b) ficar quente para o dia do `DROP COLUMN` (§13.4), que
// exige rewire dos 8 e um re-backfill antes — `scripts/rebackfill-user-work-state.mjs`.
//
// Consequência boa: pro dono (o caso comum) a leitura não custa NENHUMA query nova — o
// estado já vem na linha de `works` que a página buscou de qualquer jeito.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** As 8 notas pós-leitura ("Como foi pra você"). */
export const POST_READING_COLUMNS = [
  "post_story_score",
  "post_fl_score",
  "post_ml_score",
  "post_character_development_score",
  "post_pacing_score",
  "post_art_visual_score",
  "post_impact_immersion_score",
  "post_originality_score",
] as const

export type PostReadingColumn = (typeof POST_READING_COLUMNS)[number]

export interface PersonalWorkState {
  // ── Acompanhamento (Fatia 1)
  isFavorite: boolean
  personalStatusId: number | null
  chaptersRead: number | null
  /** Dia (YYYY-MM-DD) — normalizado. Ver `toDay()`. */
  lastReadAt: string | null

  // ── Gosto (Fatia 2a): a nota, as anotações, o interesse e a pós-leitura.
  //
  // ⚠️ O SCORING NÃO LÊ DAQUI. O Ridge, a chance, o viés de atributo, o ledger e o perfil de
  // gosto continuam lendo `works` — porque lá moram os RÓTULOS DO DONO, que é com o que o
  // modelo dele foi treinado. Trocar aquelas leituras por estas faria o modelo treinar com o
  // dado de quem abriu a página: notas erradas, sem erro e sem log. Ver §13.3 do plano.
  userScore: number | null
  observations: string | null
  observationAdjustment: number
  synopsisQuality: SynopsisQuality | null
  synopsisQualitySource: SynopsisQualitySource | null
  synopsisQualityPredictionId: string | null
  synopsisInterestSkipped: boolean
  postScores: Record<PostReadingColumn, number | null>
}

const EMPTY_POST_SCORES = Object.fromEntries(
  POST_READING_COLUMNS.map((c) => [c, null]),
) as Record<PostReadingColumn, number | null>

export const EMPTY_PERSONAL_STATE: PersonalWorkState = {
  isFavorite: false,
  personalStatusId: null,
  chaptersRead: null,
  lastReadAt: null,
  userScore: null,
  observations: null,
  observationAdjustment: 0,
  synopsisQuality: null,
  synopsisQualitySource: null,
  synopsisQualityPredictionId: null,
  synopsisInterestSkipped: false,
  postScores: EMPTY_POST_SCORES,
}

/** As colunas pessoais, como vêm de uma linha de `works` (ou do espelho — os nomes batem). */
export interface WorkReadingColumns {
  is_favorite?: boolean | null
  personal_status_id?: number | null
  chapters_read?: number | null
  last_read_at?: string | null
  user_score?: number | null
  observations?: string | null
  observation_adjustment?: number | null
  synopsis_quality?: SynopsisQuality | string | null
  synopsis_quality_source?: SynopsisQualitySource | string | null
  synopsis_quality_prediction_id?: string | null
  synopsis_interest_skipped?: boolean | null
  post_story_score?: number | null
  post_fl_score?: number | null
  post_ml_score?: number | null
  post_character_development_score?: number | null
  post_pacing_score?: number | null
  post_art_visual_score?: number | null
  post_impact_immersion_score?: number | null
  post_originality_score?: number | null
}

/** As 12 colunas de gosto, para os `select` (a Fatia 2a). */
export const TASTE_COLUMNS = [
  "user_score",
  "observations",
  "observation_adjustment",
  "synopsis_quality",
  "synopsis_quality_source",
  "synopsis_quality_prediction_id",
  "synopsis_interest_skipped",
  ...POST_READING_COLUMNS,
] as const

/** As 4 de acompanhamento (Fatia 1) + as 12 de gosto (Fatia 2a). */
export const PERSONAL_COLUMNS = [
  "is_favorite",
  "personal_status_id",
  "chapters_read",
  "last_read_at",
  ...TASTE_COLUMNS,
] as const

/**
 * ⚠️ Os dois lados têm TIPOS diferentes: `works.last_read_at` é **date** ("2025-02-03") e
 * `user_work_state.last_read_at` é **timestamptz** (assim nasceu na mig 138) — a mesma data
 * volta da API como "2025-02-03T00:00:00+00:00".
 *
 * Não é cosmético: meia-noite UTC, formatada no fuso do Brasil (UTC-3), é o DIA ANTERIOR. Sem
 * esta normalização, trocar a fonte de leitura empurraria toda "última leitura" um dia pra
 * trás — em silêncio, e só para quem lê do espelho. Cortar em 10 caracteres serve aos dois
 * formatos e devolve exatamente o que `works.last_read_at` sempre devolveu.
 */
export function toDay(value: string | null | undefined): string | null {
  return value == null ? null : String(value).slice(0, 10)
}

function stateFromMirrorRow(row: WorkReadingColumns): PersonalWorkState {
  const postScores = Object.fromEntries(
    POST_READING_COLUMNS.map((c) => [c, (row[c] as number | null | undefined) ?? null]),
  ) as Record<PostReadingColumn, number | null>

  return {
    isFavorite: Boolean(row.is_favorite ?? false),
    personalStatusId: row.personal_status_id ?? null,
    chaptersRead: row.chapters_read ?? null,
    lastReadAt: toDay(row.last_read_at),
    userScore: row.user_score ?? null,
    observations: row.observations ?? null,
    observationAdjustment: Number(row.observation_adjustment ?? 0),
    synopsisQuality: (row.synopsis_quality as SynopsisQuality | null) ?? null,
    synopsisQualitySource: (row.synopsis_quality_source as SynopsisQualitySource | null) ?? null,
    synopsisQualityPredictionId: row.synopsis_quality_prediction_id ?? null,
    synopsisInterestSkipped: Boolean(row.synopsis_interest_skipped ?? false),
    postScores,
  }
}

/** Alias público (o nome citado na mig 143 e no script de backfill). */
export const personalStateFromRow = stateFromMirrorRow

const PAGE = 1000

export interface PersonalStateReader {
  userId: string
  /** true = as colunas de `works` são o estado DESTE usuário. */
  isOwner: boolean
  /**
   * Estado de leitura do usuário atual para uma obra.
   *
   * `workRow` são as colunas de `works` que a página já buscou. Para o DONO elas SÃO o
   * estado dele (fonte de verdade). Para qualquer outro usuário elas são o estado do DONO
   * e por isso são **ignoradas** — sem fallback, é o que impede a Leitora de ver os
   * favoritos e os capítulos dele como se fossem dela.
   */
  get(workId: string, workRow?: WorkReadingColumns | null): PersonalWorkState
}

/**
 * Leitor do estado pessoal do usuário da requisição. Memoizado por request (React `cache`):
 * uma página que renderiza tabela + KPIs + cards paga uma query só.
 *
 * Sem sessão (anônimo) → `getCurrentUserId()` cai no singleton, ou seja, o visitante segue
 * vendo o app pelos olhos do dono. É o comportamento de hoje e é intencional (o catálogo é
 * compartilhado por design); esta fatia não o muda. Quem ganha estado próprio é quem LOGA.
 */
export const getPersonalStateReader = cache(async (): Promise<PersonalStateReader> => {
  const [userId, ownerId] = await Promise.all([getCurrentUserId(), getOwnerUserId()])
  const isOwner = userId === ownerId

  if (isOwner) {
    // Dono: zero queries. O estado dele já está na linha de `works`.
    return {
      userId,
      isOwner: true,
      get: (_workId, workRow) => (workRow ? stateFromMirrorRow(workRow) : EMPTY_PERSONAL_STATE),
    }
  }

  const byWorkId = await loadUserWorkState(userId)
  return {
    userId,
    isOwner: false,
    // `workRow` deliberadamente ignorado: é o estado do DONO.
    get: (workId) => byWorkId.get(workId) ?? EMPTY_PERSONAL_STATE,
  }
})

/** Todas as linhas de estado de um usuário, paginadas. */
async function loadUserWorkState(userId: string): Promise<Map<string, PersonalWorkState>> {
  const supabase = createAdminClient()
  const byWorkId = new Map<string, PersonalWorkState>()

  // ⚠️ Paginado: o `select` corta em 1000 linhas SEM AVISAR. São 882 obras hoje — abaixo do
  // teto, mas o dia em que passarem, um select cru devolveria um recorte e a página diria,
  // convicta, que as obras 1001+ não têm estado nenhum.
  // Literal de propósito: o client do Supabase tipa o retorno a partir da STRING do select —
  // montá-la com `join()` devolve `ParserError` em vez das colunas. Se mexer em
  // PERSONAL_COLUMNS, mexa aqui também.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("user_work_state")
      .select(
        `work_id, is_favorite, personal_status_id, chapters_read, last_read_at,
         user_score, observations, observation_adjustment,
         synopsis_quality, synopsis_quality_source, synopsis_quality_prediction_id,
         synopsis_interest_skipped,
         post_story_score, post_fl_score, post_ml_score, post_character_development_score,
         post_pacing_score, post_art_visual_score, post_impact_immersion_score,
         post_originality_score`,
      )
      .eq("user_id", userId)
      .order("work_id", { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw new Error(`user_work_state: ${error.message}`)
    if (!data?.length) break
    for (const row of data) {
      byWorkId.set(row.work_id as string, stateFromMirrorRow(row as WorkReadingColumns))
    }
    if (data.length < PAGE) break
  }

  return byWorkId
}

/**
 * Ids das obras do usuário atual que casam com um filtro de estado pessoal.
 *
 * `null` = "não filtre por id" — é o que o DONO recebe, porque para ele o filtro continua
 * sendo aplicado nas colunas de `works`, em SQL, como sempre foi (mesma query, mesmo plano,
 * zero regressão). Para os demais, o filtro só pode sair de `user_work_state`; lista vazia
 * significa "nenhuma obra casa" e o caller precisa forçar resultado vazio — NÃO ignorar o
 * filtro (ignorar vazaria o catálogo inteiro como se fosse tudo favorito dela).
 */
export async function resolvePersonalFilterIds(filter: {
  personalStatusIds?: number[] | null
  onlyFavorites?: boolean
  /** Interesse ♥ manual (`synopsis_quality`) — Fatia 2a. */
  synopsisQualities?: string[] | null
}): Promise<string[] | null> {
  const { personalStatusIds, onlyFavorites, synopsisQualities } = filter
  const wantsStatus = personalStatusIds != null && personalStatusIds.length > 0
  const wantsInterest = synopsisQualities != null && synopsisQualities.length > 0
  if (!wantsStatus && !onlyFavorites && !wantsInterest) return null

  const reader = await getPersonalStateReader()
  if (reader.isOwner) return null

  const supabase = createAdminClient()
  const ids: string[] = []

  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("user_work_state")
      .select("work_id")
      .eq("user_id", reader.userId)
      .order("work_id", { ascending: true })
      .range(from, from + PAGE - 1)

    if (wantsStatus) query = query.in("personal_status_id", personalStatusIds)
    if (onlyFavorites) query = query.eq("is_favorite", true)
    if (wantsInterest) query = query.in("synopsis_quality", synopsisQualities)

    const { data, error } = await query
    if (error) throw new Error(`user_work_state: ${error.message}`)
    if (!data?.length) break
    ids.push(...data.map((r) => r.work_id as string))
    if (data.length < PAGE) break
  }

  return ids
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ESCRITA
//
// ⚠️ Isto NÃO é uma server action (o arquivo não tem "use server") — é chamado de DENTRO
// delas. Toda função exportada de um arquivo "use server" vira um endpoint HTTP público, e
// um writer de estado que aceita `userId` como argumento seria um "escreva na linha de quem
// você quiser". O `userId` aqui vem sempre de `ensureSignedIn()`, no call site.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Acompanhamento (Fatia 1). */
export type ReadingStatePatch = Partial<{
  is_favorite: boolean
  personal_status_id: number | null
  chapters_read: number | null
  last_read_at: string | null
}>

/** Gosto (Fatia 2a): nota, anotações, interesse ♥ e as 8 pós-leitura. */
export type TasteStatePatch = Partial<{
  user_score: number | null
  observations: string | null
  observation_adjustment: number
  synopsis_quality: string | null
  synopsis_quality_source: string | null
  synopsis_quality_prediction_id: string | null
  synopsis_interest_skipped: boolean
  post_story_score: number | null
  post_fl_score: number | null
  post_ml_score: number | null
  post_character_development_score: number | null
  post_pacing_score: number | null
  post_art_visual_score: number | null
  post_impact_immersion_score: number | null
  post_originality_score: number | null
}>

export type PersonalStatePatch = ReadingStatePatch & TasteStatePatch

/**
 * Grava o estado pessoal de UM usuário em N obras. Upsert idempotente.
 *
 * Vai no cliente de SESSÃO (`createUserClient`) de propósito: a RLS da mig 142 exige
 * `user_id = auth.uid()` no `with check`, então uma tentativa de escrever na linha de outra
 * pessoa é NEGADA pelo Postgres — em vez de virar dado errado em silêncio, que é o que a
 * service role faria se algum dia o `user_id` viesse errado daqui.
 */
export async function writeReadingState(
  userId: string,
  workIds: string[],
  patch: PersonalStatePatch,
): Promise<{ error: string | null }> {
  const ids = Array.from(new Set(workIds.filter(Boolean)))
  if (ids.length === 0) return { error: null }

  const supabase = await createUserClient()
  const now = new Date().toISOString()
  const rows = ids.map((workId) => ({
    user_id: userId,
    work_id: workId,
    ...patch,
    updated_at: now,
  }))

  const { error } = await supabase
    .from("user_work_state")
    .upsert(rows, { onConflict: "user_id,work_id" })

  if (error) return { error: `Falha salvando o seu estado: ${error.message}` }
  return { error: null }
}

/**
 * Quem escreve o quê, em UMA decisão.
 *
 * 🔴 A armadilha que esta função existe pra fechar: `works` é a linha compartilhada, e as
 * colunas pessoais que moram nela são as do DONO. Um dual-write incondicional faria a Leitora
 * favoritar uma obra e sobrescrever o `is_favorite` DELE; marcar o capítulo 12 e o
 * `chapters_read` dele virar 12; dar 9 numa obra e a NOTA DELE virar 9 — e a nota do dono é o
 * rótulo que treina o Ridge, ou seja, o modelo dele passaria a aprender o gosto dela. Sem
 * erro, sem log. Por isso `works` só é tocada quando quem escreve É o dono.
 */
export async function canWriteSharedWorkRow(userId: string): Promise<boolean> {
  return userId === (await getOwnerUserId())
}
