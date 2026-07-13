import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { createUserClient } from "@/lib/supabase/user"
import { getCurrentUserId, getOwnerUserId } from "./current-user"

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

export interface PersonalWorkState {
  isFavorite: boolean
  personalStatusId: number | null
  chaptersRead: number | null
  /** Dia (YYYY-MM-DD) — normalizado. Ver `toDay()`. */
  lastReadAt: string | null
}

export const EMPTY_PERSONAL_STATE: PersonalWorkState = {
  isFavorite: false,
  personalStatusId: null,
  chaptersRead: null,
  lastReadAt: null,
}

/** As 4 colunas, como vêm de uma linha de `works`. */
export interface WorkReadingColumns {
  is_favorite?: boolean | null
  personal_status_id?: number | null
  chapters_read?: number | null
  last_read_at?: string | null
}

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
  return {
    isFavorite: Boolean(row.is_favorite ?? false),
    personalStatusId: row.personal_status_id ?? null,
    chaptersRead: row.chapters_read ?? null,
    lastReadAt: toDay(row.last_read_at),
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
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("user_work_state")
      .select("work_id, is_favorite, personal_status_id, chapters_read, last_read_at")
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
}): Promise<string[] | null> {
  const { personalStatusIds, onlyFavorites } = filter
  const wantsStatus = personalStatusIds != null && personalStatusIds.length > 0
  if (!wantsStatus && !onlyFavorites) return null

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

export type ReadingStatePatch = Partial<{
  is_favorite: boolean
  personal_status_id: number | null
  chapters_read: number | null
  last_read_at: string | null
}>

/**
 * Grava o estado de leitura de UM usuário em N obras. Upsert idempotente.
 *
 * Vai no cliente de SESSÃO (`createUserClient`) de propósito: a RLS da mig 142 exige
 * `user_id = auth.uid()` no `with check`, então uma tentativa de escrever na linha de outra
 * pessoa é NEGADA pelo Postgres — em vez de virar dado errado em silêncio, que é o que a
 * service role faria se algum dia o `user_id` viesse errado daqui.
 */
export async function writeReadingState(
  userId: string,
  workIds: string[],
  patch: ReadingStatePatch,
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

  if (error) return { error: `Falha salvando seu estado de leitura: ${error.message}` }
  return { error: null }
}

/**
 * Quem escreve o quê, em UMA decisão.
 *
 * 🔴 A armadilha que esta função existe pra fechar: `works` é a linha compartilhada, e as 4
 * colunas de leitura que moram nela são as do DONO. Um dual-write incondicional faria a
 * Leitora favoritar uma obra e sobrescrever o `is_favorite` DELE; marcar o capítulo 12 e o
 * `chapters_read` dele virar 12. Sem erro, sem log. Por isso `works` só é tocada quando quem
 * escreve É o dono.
 */
export async function canWriteSharedWorkRow(userId: string): Promise<boolean> {
  return userId === (await getOwnerUserId())
}
