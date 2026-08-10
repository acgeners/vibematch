/**
 * Escopo da OPERAÇÃO e1 em produção — fonte ÚNICA do filtro de obras.
 *
 * Critérios (decisão 2026-06-27):
 *   - obra ativa (is_archived=false)
 *   - > 3 reviews
 *   - >= 20 tags
 *   - publication_status != Cancelled (id 4)
 *   - personal_status ∉ {Completed(1), Dropped(9), Stalled(4)}
 *
 * READ-ONLY. Usado por:
 *   - scripts/e1-prod-digest.ts  (consolida digest só nas filtradas sem digest)
 *   - backfill do Interesse        (--work-id=<filtered>, via npm run backfill:interest)
 *
 * Execução direta (npm run e1:scope): imprime contagens e escreve os IDs em
 * disco (scratchpad) para alimentar o --work-id do backfill.
 *
 * 🔴 QUEBRADO desde a Fase F (`329a446`, 14/07/2026) — conferido em 2026-08-10 rodando
 * `npm run e1:scope`: `FATAL: works: column works.personal_status_id does not exist`. O
 * critério de `personal_status` acima lê uma coluna que `works` não tem mais: a Fase F moveu
 * as 19 colunas pessoais para o espelho `user_work_state`, que virou a única fonte.
 *
 * ⚠️ Ao consertar, o filtro pessoal precisa decidir DE QUEM é o status — em `works` ele era
 * global por acidente; no espelho ele tem dono. Para uma operação de catálogo, o dono é o
 * curador, e isso passa a ser uma escolha explícita, não uma leitura de coluna.
 *
 * ⚠️ Este defeito derrubou os DOIS consumidores em silêncio, e nada acusou por ~4 semanas:
 * nenhum deles roda em CI nem por hábito. É a mesma família do
 * [[gotcha-scripts-fora-do-package-json-batem-na-nuvem]] — script fora de qualquer rede
 * envelhece sem sintoma.
 */
import { writeFileSync } from "node:fs"
import { createAdminClient } from "@/lib/supabase/admin"

export const EXCLUDED_PUBLICATION_STATUS_IDS = new Set([4]) // Cancelled
export const EXCLUDED_PERSONAL_STATUS_IDS = new Set([1, 9, 4]) // Completed, Dropped, Stalled
export const MIN_REVIEWS_EXCLUSIVE = 3 // > 3  ⇒  >= 4
export const MIN_TAGS_INCLUSIVE = 20 // >= 20

type Sb = ReturnType<typeof createAdminClient>

async function countByWorkId(sb: Sb, table: string): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select("work_id").range(from, from + PAGE - 1)
    if (error) throw new Error(`countByWorkId(${table}): ${error.message}`)
    for (const r of data ?? []) {
      const id = (r as { work_id: string }).work_id
      m.set(id, (m.get(id) ?? 0) + 1)
    }
    if (!data || data.length < PAGE) break
  }
  return m
}

export interface E1ProdScope {
  /** Todas as obras que passam nos 4 critérios (ordenadas por id ASC). */
  filtered: string[]
  /** Subconjunto de `filtered` que AINDA não tem review_digest. */
  filteredNoDigest: string[]
  /** Diagnóstico por critério (sobre obras ativas). */
  diagnostics: {
    activeTotal: number
    passReviews: number
    passTags: number
    passStatus: number
    filteredWithDigest: number
  }
}

export async function computeE1ProdScope(sb: Sb = createAdminClient()): Promise<E1ProdScope> {
  const [reviewCounts, tagCounts] = await Promise.all([
    countByWorkId(sb, "work_reviews"),
    countByWorkId(sb, "work_tags"),
  ])

  const works: Array<{ id: string; pub: number | null; pers: number | null; hasDigest: boolean }> = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("works")
      .select("id, publication_status_id, personal_status_id, review_digest")
      .eq("is_archived", false)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`works: ${error.message}`)
    for (const r of data ?? []) {
      const row = r as {
        id: string
        publication_status_id: number | null
        personal_status_id: number | null
        review_digest: unknown
      }
      works.push({
        id: row.id,
        pub: row.publication_status_id,
        pers: row.personal_status_id,
        hasDigest: row.review_digest != null,
      })
    }
    if (!data || data.length < PAGE) break
  }

  let passReviews = 0, passTags = 0, passStatus = 0, filteredWithDigest = 0
  const filtered: string[] = []
  const filteredNoDigest: string[] = []
  for (const w of works) {
    const okReviews = (reviewCounts.get(w.id) ?? 0) > MIN_REVIEWS_EXCLUSIVE
    const okTags = (tagCounts.get(w.id) ?? 0) >= MIN_TAGS_INCLUSIVE
    const okPub = w.pub == null || !EXCLUDED_PUBLICATION_STATUS_IDS.has(w.pub)
    const okPers = w.pers == null || !EXCLUDED_PERSONAL_STATUS_IDS.has(w.pers)
    if (okReviews) passReviews++
    if (okTags) passTags++
    if (okPub && okPers) passStatus++
    if (okReviews && okTags && okPub && okPers) {
      filtered.push(w.id)
      if (w.hasDigest) filteredWithDigest++
      else filteredNoDigest.push(w.id)
    }
  }
  filtered.sort()
  filteredNoDigest.sort()

  return {
    filtered,
    filteredNoDigest,
    diagnostics: {
      activeTotal: works.length,
      passReviews,
      passTags,
      passStatus,
      filteredWithDigest,
    },
  }
}

// ---- Execução direta -------------------------------------------------------
async function main() {
  const scope = await computeE1ProdScope()
  const d = scope.diagnostics
  console.log("=== ESCOPO e1 (obras ativas) ===")
  console.log(`ativas: ${d.activeTotal}`)
  console.log(`  passam reviews>${MIN_REVIEWS_EXCLUSIVE}: ${d.passReviews}`)
  console.log(`  passam tags>=${MIN_TAGS_INCLUSIVE}:      ${d.passTags}`)
  console.log(`  passam status:        ${d.passStatus}`)
  console.log(`>>> FILTRADAS (4 critérios): ${scope.filtered.length}`)
  console.log(`    com digest: ${d.filteredWithDigest}  |  SEM digest: ${scope.filteredNoDigest.length}`)

  const SCRATCH =
    "/private/tmp/claude-501/-Users-geners-Code-VibeMatch-animedb/d67f0f62-4516-4427-84a4-5c589331f37b/scratchpad"
  writeFileSync(`${SCRATCH}/e1-filtered-ids.txt`, scope.filtered.join(",") + "\n")
  writeFileSync(`${SCRATCH}/e1-nodigest-ids.txt`, scope.filteredNoDigest.join(",") + "\n")
  console.log(`\nIDs gravados em:`)
  console.log(`  ${SCRATCH}/e1-filtered-ids.txt   (${scope.filtered.length} — p/ --work-id do backfill)`)
  console.log(`  ${SCRATCH}/e1-nodigest-ids.txt   (${scope.filteredNoDigest.length} — p/ o digest)`)
}

if (process.argv[1] && process.argv[1].endsWith("e1-prod-scope.ts")) {
  main().catch((e) => {
    console.error("FATAL:", e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
}
