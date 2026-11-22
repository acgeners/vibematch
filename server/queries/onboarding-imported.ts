import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { PERSONAL_STATUSES } from "@/types/domain"
import type { PersonalStatus } from "@/types/domain"
import { getPersonalStatusIdByName, getPersonalStatusNameById } from "@/lib/constants/status-lookups"
import { isRateListStatus } from "@/lib/onboarding/rate-status"
import type { RateListWork } from "@/lib/onboarding/rate-status"
import type { ExternalListSource } from "@/lib/import/external-list/types"
import { hydrateOnboardingWorks } from "@/server/queries/onboarding-deck"

/** Teto da lista: uma importação grande traz centenas de obras sem nota, e a tela é uma lista só. */
export const IMPORTED_UNRATED_LIMIT = 200

/** Nome do site como a pessoa o conhece. Títulos colados não têm site: a etiqueta diz "da sua lista". */
const SOURCE_LABEL: Partial<Record<ExternalListSource, string>> = {
  anilist: "AniList",
  myanimelist: "MyAnimeList",
  mangaupdates: "MangaUpdates",
  animeplanet: "Anime-Planet",
}

/**
 * Status que querem dizer "já li, ao menos em parte": os terminais (terminei, larguei) e os que
 * acompanham progresso. Sai das FLAGS do banco, nunca de uma lista de nomes — a mesma régua da tela.
 */
function readStatusIds(): number[] {
  return PERSONAL_STATUSES.filter((s) => isRateListStatus(s))
    .map((s) => getPersonalStatusIdByName(s))
    .filter((id): id is number => id != null)
}

/** As colunas de `user_work_state` que a tela de notas precisa: a ordem e o estado de leitura. */
const RATE_ROW_COLUMNS = "work_id, updated_at, personal_status_id, chapters_read"

interface RateRowData {
  work_id: string
  personal_status_id: number | null
  chapters_read: number | null
}

/**
 * Hidrata as obras e junta o status e o capítulo GRAVADOS. Sem isto a tela inventava "Terminei"
 * para todas (ver `lib/onboarding/rate-status.ts`).
 */
async function hydrateRateWorks(rows: RateRowData[]): Promise<RateListWork[]> {
  const byId = new Map(rows.map((r) => [r.work_id, r]))
  const works = await hydrateOnboardingWorks(rows.map((r) => r.work_id))
  return works.flatMap((w) => {
    const row = byId.get(w.id)
    const status = row?.personal_status_id != null ? getPersonalStatusNameById(row.personal_status_id) : null
    if (!status) return []
    return [{ ...w, status: status as PersonalStatus, chaptersRead: row?.chapters_read ?? null }]
  })
}

export interface ImportedUnrated {
  works: RateListWork[]
  /** Quantas obras a mesma importação trouxe COM nota (já contam no ensō). */
  ratedCount: number
  /** "AniList", "MyAnimeList"… ou null quando a lista veio colada (ou não houve importação). */
  sourceLabel: string | null
}

/**
 * O que a importação das boas-vindas trouxe como LIDO e SEM nota: vai para a tela de notas.
 *
 * "Desta vez" = linha gravada a partir de `sinceIso`, o instante em que a página abriu (hora do
 * servidor). A importação grava por `writeReadingState`, que carimba `updated_at`; obra lida há
 * meses e sem nota não volta a pedir nota a quem só está revendo as boas-vindas.
 */
export async function getImportedUnrated(userId: string, sinceIso: string): Promise<ImportedUnrated> {
  const supabase = createAdminClient()
  const [rows, rated, lastImport] = await Promise.all([
    supabase
      .from("user_work_state")
      .select(RATE_ROW_COLUMNS)
      .eq("user_id", userId)
      .is("user_score", null)
      .in("personal_status_id", readStatusIds())
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
      .order("work_id", { ascending: true })
      .limit(IMPORTED_UNRATED_LIMIT),
    supabase
      .from("user_work_state")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("user_score", "is", null)
      .gte("updated_at", sinceIso),
    supabase
      .from("imports")
      .select("raw_metadata, created_at")
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1),
  ])
  if (rows.error) throw new Error(`getImportedUnrated: ${rows.error.message}`)
  if (rated.error) throw new Error(`getImportedUnrated(com nota): ${rated.error.message}`)
  if (lastImport.error) throw new Error(`getImportedUnrated(imports): ${lastImport.error.message}`)

  const source = (lastImport.data?.[0]?.raw_metadata as { source?: ExternalListSource } | null)?.source
  const works = await hydrateRateWorks((rows.data ?? []) as RateRowData[])
  return { works, ratedCount: rated.count ?? 0, sourceLabel: source ? (SOURCE_LABEL[source] ?? null) : null }
}

/**
 * TODAS as obras lidas e sem nota da pessoa (a mais recente primeiro) — a lista "Já li, falta a
 * nota" da página "Dar notas": obra marcada como lida em qualquer lugar do app também aparece lá.
 */
export async function getUnratedRead(userId: string): Promise<RateListWork[]> {
  const { data, error } = await createAdminClient()
    .from("user_work_state")
    .select(RATE_ROW_COLUMNS)
    .eq("user_id", userId)
    .is("user_score", null)
    .in("personal_status_id", readStatusIds())
    .order("updated_at", { ascending: false })
    .order("work_id", { ascending: true })
    .limit(IMPORTED_UNRATED_LIMIT)
  if (error) throw new Error(`getUnratedRead: ${error.message}`)
  return hydrateRateWorks((data ?? []) as RateRowData[])
}

/**
 * Quantas obras lidas e SEM nota a pessoa tem — o mesmo filtro de `getUnratedRead`, sem o teto de
 * `IMPORTED_UNRATED_LIMIT`. É o que entra no "de N obras" do ensō: contar pela lista erraria em
 * silêncio quem tem mais obras sem nota do que a lista mostra.
 */
export async function countUnratedReadOf(userId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("user_work_state")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("user_score", null)
    .in("personal_status_id", readStatusIds())
  if (error) throw new Error(`countUnratedReadOf: ${error.message}`)
  return count ?? 0
}

/** Quantas obras COM nota a pessoa tem (o número do ensō). Conta no servidor: zero linhas trafegam. */
export async function countRatedWorksOf(userId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("user_work_state")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("user_score", "is", null)
  if (error) throw new Error(`countRatedWorksOf: ${error.message}`)
  return count ?? 0
}
