import "server-only"
import type { createAdminClient } from "@/lib/supabase/admin"
import { slugifyTagName } from "@/lib/utils"

type Admin = ReturnType<typeof createAdminClient>

const SAMPLE_CAP = 8

/**
 * Uma string do campo-gênero só é boa candidata a gênero se RECORRE em várias obras
 * (gêneros reais como "Isekai"/"Yaoi" aparecem em muitas; tags finas como "Yandere
 * Character/s" são raras). Abaixo disto a proposta existe mas fica escondida da fila.
 */
export const GENRE_PROPOSAL_MIN_OCCURRENCES = 5

/**
 * Registra strings de CAMPO-GÊNERO que não são gênero do catálogo como candidatos
 * a gênero (fila `genre_proposal`, promoção com aprovação humana — mig 165). A
 * string já virou TAG na obra (nada se perde); isto só alimenta a fila de promoção.
 *
 *  - slug novo            → insere (pending, occurrences=1)
 *  - pending existente    → occurrences++ e agrega sample_work_ids (até SAMPLE_CAP)
 *  - approved/rejected    → NÃO ressuscita (a decisão humana vale)
 *  - slug que já é gênero → ignora
 *
 * Best-effort: o caller envolve em try/catch; nunca deve quebrar o fluxo de criação.
 */
export async function recordGenreCandidates(
  supabase: Admin,
  rawNames: string[],
  workId?: string,
): Promise<void> {
  const bySlug = new Map<string, string>()
  for (const raw of rawNames) {
    const name = raw.trim()
    const slug = slugifyTagName(name)
    if (slug && !bySlug.has(slug)) bySlug.set(slug, name)
  }
  if (bySlug.size === 0) return
  const slugs = [...bySlug.keys()]

  // Já é um gênero real do catálogo? Não propor.
  const { data: realGenres } = await supabase.from("genres").select("slug").in("slug", slugs)
  const realSet = new Set((realGenres ?? []).map((g) => g.slug as string))

  const { data: existing } = await supabase
    .from("genre_proposal")
    .select("id, slug, status, occurrences, sample_work_ids")
    .in("slug", slugs)
  const existingBySlug = new Map((existing ?? []).map((r) => [r.slug as string, r]))

  const toInsert: Array<Record<string, unknown>> = []
  for (const [slug, name] of bySlug) {
    if (realSet.has(slug)) continue
    const ex = existingBySlug.get(slug)
    if (!ex) {
      toInsert.push({ raw_name: name, slug, occurrences: 1, sample_work_ids: workId ? [workId] : [] })
      continue
    }
    if (ex.status !== "pending") continue // não ressuscita decisão humana
    const samples = new Set<string>(((ex.sample_work_ids as string[]) ?? []))
    if (workId) samples.add(workId)
    await supabase
      .from("genre_proposal")
      .update({
        occurrences: ((ex.occurrences as number) ?? 0) + 1,
        sample_work_ids: [...samples].slice(0, SAMPLE_CAP),
        updated_at: new Date().toISOString(),
      })
      .eq("id", ex.id as string)
  }
  if (toInsert.length > 0) {
    await supabase.from("genre_proposal").insert(toInsert)
  }
}
