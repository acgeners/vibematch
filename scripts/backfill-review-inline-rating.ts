/**
 * Backfill: preenche `work_reviews.user_rating` NULA a partir da nota embutida no
 * texto da review (`extractInlineRating`), pra reviews colhidas ANTES do recurso de
 * nota-inline (07/06/2026). Só toca em linhas com `user_rating` null — não mexe nas
 * notas estruturadas (da fonte), evitando sobrescrever sub-notas ("storytelling 10/10").
 *
 * Regex puro — ZERO chamada de IA. Dry-run por padrão; `--apply` grava.
 *
 *   npx tsx scripts/backfill-review-inline-rating.ts            # dry-run
 *   node scripts/backup-db.mjs && npx tsx scripts/backfill-review-inline-rating.ts --apply
 *
 * 🔴 ALVO: NUVEM — este script GRAVA. Rodá-lo contra o local, que é réplica descartável,
 * joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/backfill-review-inline-rating.ts
 */
import path from "node:path"
import { config } from "dotenv"
config({ path: path.resolve(import.meta.dirname, "..", ".env.local") })

import { createClient } from "@supabase/supabase-js"
import { extractInlineRating } from "../lib/external/inline-rating"

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local")
  process.exit(1)
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })
const APPLY = process.argv.includes("--apply")

type Row = { id: string; text: string | null; user_rating: number | null; source: string | null }

// Marcador AUTORITATIVO adicionado pelos scrapers ("Nota do usuário: X/10"), em qualquer
// posição — o prefixo `^Nota do usuário:` do extractUserRating falha quando o título vem antes
// (MangaUpdates). Quando presente, essa nota vence o scan genérico. Senão, cai no inline.
const NOTA_RE = /Nota do usu[áa]rio:\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*10)?/i
function markerRating(text: string): number | undefined {
  const m = text.match(NOTA_RE)
  if (!m) return undefined
  const v = Number(m[1])
  return Number.isFinite(v) && v >= 0 && v <= 10 ? Math.round(v * 10) / 10 : undefined
}
function ratingFromText(text: string): number | undefined {
  return markerRating(text) ?? extractInlineRating(text)
}

async function main(): Promise<void> {
  // Pagina (o select corta em 1000 sem avisar) e confere contra count exato.
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("work_reviews")
      .select("id, text, user_rating, source")
      .is("user_rating", null)
      .range(from, from + 999)
    if (error) {
      console.error("erro lendo work_reviews:", error.message)
      process.exit(1)
    }
    if (!data?.length) break
    rows.push(...(data as Row[]))
    if (data.length < 1000) break
  }
  const { count } = await sb
    .from("work_reviews")
    .select("*", { count: "exact", head: true })
    .is("user_rating", null)
  console.log(`reviews com user_rating NULL: ${rows.length} (count exato: ${count})`)
  if (count != null && rows.length !== count) {
    console.error("⚠️ paginação divergiu do count exato — abortando pra não backfillar recorte")
    process.exit(1)
  }

  // Extrai a nota de cada uma (marcador autoritativo > scan inline).
  const updates: Array<{ id: string; rating: number; source: string; snippet: string }> = []
  let mismatches = 0 // marcador presente MAS o scan inline daria valor diferente (arriscadas)
  for (const r of rows) {
    const text = r.text ?? ""
    const rating = ratingFromText(text)
    if (rating != null) {
      const mk = markerRating(text)
      if (mk != null && extractInlineRating(text) !== mk) mismatches++
      updates.push({
        id: r.id,
        rating,
        source: r.source ?? "?",
        snippet: text.replace(/\s+/g, " ").trim().slice(0, 72),
      })
    }
  }
  console.log(
    `divergências (marcador vs scan inline): ${mismatches} — usamos o marcador nessas, então ficam corretas`,
  )

  console.log(`\n→ ${updates.length} de ${rows.length} reviews nulas ganhariam nota inline\n`)
  const bySource = new Map<string, number>()
  for (const u of updates) bySource.set(u.source, (bySource.get(u.source) ?? 0) + 1)
  console.log("por fonte:", Object.fromEntries([...bySource].sort((a, b) => b[1] - a[1])))
  const byRating = new Map<number, number>()
  for (const u of updates) byRating.set(u.rating, (byRating.get(u.rating) ?? 0) + 1)
  console.log("por nota: ", Object.fromEntries([...byRating].sort((a, b) => a[0] - b[0])))
  console.log("\namostra (18):")
  for (const u of updates.slice(0, 18)) {
    console.log(`  ${String(u.rating).padStart(4)}  [${u.source}]  "${u.snippet}"`)
  }

  if (!APPLY) {
    console.log("\n[DRY-RUN] nada gravado. Rode o backup + '--apply' pra aplicar:")
    console.log("  node scripts/backup-db.mjs && npx tsx scripts/backfill-review-inline-rating.ts --apply")
    return
  }

  // APPLY: agrupa por nota e atualiza em lotes por `.in("id", chunk)` (chunk ≤ 200
  // pra não estourar o limite do PostgREST em listas grandes de ids).
  console.log("\n[APPLY] gravando…")
  const idsByRating = new Map<number, string[]>()
  for (const u of updates) {
    const arr = idsByRating.get(u.rating) ?? []
    arr.push(u.id)
    idsByRating.set(u.rating, arr)
  }
  let ok = 0
  for (const [rating, ids] of idsByRating) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { error } = await sb.from("work_reviews").update({ user_rating: rating }).in("id", chunk)
      if (error) {
        console.error(`  falha (nota=${rating}, ${chunk.length} linhas):`, error.message)
        continue
      }
      ok += chunk.length
    }
  }
  console.log(`✓ ${ok}/${updates.length} reviews atualizadas`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
