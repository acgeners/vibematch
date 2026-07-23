import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

export interface AdultScoreFlag {
  /** works.is_adult — chip 🔞 do card. */
  isAdult: boolean
  /** works_owner.user_score (do dono) — badge "Real" do card. */
  userScore: number | null
}

/**
 * Flags de card que NÃO vêm juntas na query base das filas de curadoria:
 * - `is_adult` é CATÁLOGO (mora em `works`), e a view `works_owner` — de onde as filas leem —
 *   não expõe a coluna;
 * - `user_score` está em `works_owner`, mas nem toda query a seleciona.
 *
 * Busca ambas em lote por ids (chunk de 200 pra não estourar o `.in()`), pra casar o chip 🔞
 * e o badge "Real" em TODAS as abas de /ai-evaluation sem tocar em cada query/tipo intermediário.
 * Mesma fonte que o card principal (getEligibleWorks): `works.is_adult` + `works_owner.user_score`.
 */
export async function fetchAdultScoreFlags(ids: string[]): Promise<Map<string, AdultScoreFlag>> {
  const map = new Map<string, AdultScoreFlag>()
  if (ids.length === 0) return map
  const sb = createAdminClient()
  const CHUNK = 200
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))

  const ensure = (id: string): AdultScoreFlag => {
    let e = map.get(id)
    if (!e) {
      e = { isAdult: false, userScore: null }
      map.set(id, e)
    }
    return e
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const [adult, scores] = await Promise.all([
        sb.from("works").select("id, is_adult").in("id", chunk),
        sb.from("works_owner").select("id, user_score").in("id", chunk),
      ])
      for (const r of (adult.data ?? []) as Array<{ id: string; is_adult: boolean | null }>) {
        ensure(r.id).isAdult = Boolean(r.is_adult)
      }
      for (const r of (scores.data ?? []) as Array<{ id: string; user_score: number | null }>) {
        ensure(r.id).userScore = r.user_score ?? null
      }
    }),
  )
  return map
}
