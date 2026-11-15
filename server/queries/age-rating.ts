import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { parseAgeRatingRow } from "@/lib/age-rating/age-rating"
import type { AgeRating, AgeRatingRow, AgeRatingVersion } from "@/lib/age-rating/age-rating"

/**
 * Classificação etária (`work_age_rating`, migration 223) — catálogo, lido pela service role.
 * 🔴 Erro LANÇA: devolver [] faria a obra aparecer "sem classificação" — plausível e falso.
 */
export async function getAgeRatingForWork(workId: string): Promise<AgeRatingRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("work_age_rating")
    .select("versao, faixa, conflito, decidido_por")
    .eq("work_id", workId)
  if (error) throw new Error(`work_age_rating: ${error.message}`)
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(parseAgeRatingRow)
    .filter((r): r is AgeRatingRow => r !== null)
}

/** Um item da fila "Conflitos de classificação" (/curation/settings). */
export interface AgeRatingConflict {
  workId: string
  title: string
  versao: AgeRatingVersion
  /** Faixa provisória (a que vale enquanto o conflito está aberto), se houver. */
  faixa: AgeRating | null
  conflito: string
  isAdult: boolean
  editionState: string | null
  adultOverride: boolean | null
  /** Rótulos oficiais lidos, já resumidos para a tela ("Naver Webtoon: 15세 이용가"). */
  rotulos: Array<{ fonte: string; rotulo: string; url: string | null }>
  sinais: string[]
}

type Evidencia = {
  produtos?: Array<{ plataforma?: string; rotulo?: string | null; url?: string | null }>
  kmas?: Array<{ rotulo?: string | null; plataforma?: string | null; url?: string | null }>
  en?: Array<{ fonte?: string; rotulo?: string | null }>
  sinais_fortes?: string[]
  sinais_fracos?: string[]
}

export async function getAgeRatingConflicts(): Promise<AgeRatingConflict[]> {
  const supabase = createAdminClient()
  const rows = await fetchAllRows<Record<string, unknown>>(
    () =>
      supabase
        .from("work_age_rating")
        .select("work_id, versao, faixa, conflito, evidencia, works(title, is_adult, edition_state, adult_override)")
        .not("conflito", "is", null),
    // PK (work_id, versao) é ordem total.
    { orderBy: ["work_id", "versao"], label: "getAgeRatingConflicts" },
  )
  return rows
    .map((r) => {
      const row = parseAgeRatingRow(r)
      // Embed to-one: o PostgREST devolve OBJETO (FK work_age_rating.work_id → works).
      const w = (Array.isArray(r.works) ? r.works[0] : r.works) as Record<string, unknown> | null
      if (!row || !row.conflito || !w) return null
      const ev = (r.evidencia ?? {}) as Evidencia
      const rotulos = [
        ...(ev.produtos ?? []).map((p) => ({ fonte: p.plataforma ?? "?", rotulo: p.rotulo ?? "—", url: p.url ?? null })),
        ...(ev.kmas ?? []).map((k) => ({ fonte: `KMAS${k.plataforma ? ` (${k.plataforma})` : ""}`, rotulo: k.rotulo ?? "—", url: k.url ?? null })),
        ...(ev.en ?? []).map((e) => ({ fonte: e.fonte ?? "EN", rotulo: e.rotulo ?? "—", url: null })),
      ]
      return {
        workId: r.work_id as string,
        title: (w.title as string) ?? "",
        versao: row.versao,
        faixa: row.faixa,
        conflito: row.conflito,
        isAdult: w.is_adult === true,
        editionState: (w.edition_state as string | null) ?? null,
        adultOverride: typeof w.adult_override === "boolean" ? w.adult_override : null,
        rotulos,
        sinais: [...(ev.sinais_fortes ?? []), ...(ev.sinais_fracos ?? [])],
      } satisfies AgeRatingConflict
    })
    .filter((c): c is AgeRatingConflict => c !== null)
    .sort((a, b) => a.title.localeCompare(b.title))
}
