/**
 * Reaplica o piso/teto de `adult_content` (lib/ai-evaluation/adult-content-rules.ts)
 * contra as tags ATUAIS de cada obra já avaliada — sem chamar a IA de novo ($0).
 *
 * Por quê: o piso/teto só era aplicado NO MOMENTO da avaliação. Uma obra avaliada
 * antes de uma tag ganhar `adult_score_tier`, ou antes da regra existir (ex.: o teto
 * de "R15 but Based on a R19 Novel", migração 164), fica com a nota fora da faixa
 * pra sempre — não há gatilho de reavaliação quando a regra muda. Medido em
 * 2026-07-31: 15/21 obras com essa tag estão HOJE acima do teto declarado (6.0).
 *
 * Escopo desta rodada: só as tags que JÁ têm `adult_score_tier` decidido (as 53
 * migradas em 174) + a tag especial R15-based-on-R19-novel. As ~119 tags no backlog
 * de revisão (/settings → "Piso de nota 18+ (tags)") NÃO entram até serem revisadas
 * — script determinístico não deve decidir por curadoria pendente.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/adult-content-retroactive-bounds.ts              # dry-run (default)
 *   ... --execute                                               # grava de verdade
 *
 * Roda contra o que `.env.local` apontar — confira NEXT_PUBLIC_SUPABASE_URL antes
 * (local por padrão neste projeto). Rode `node scripts/backup-db.mjs` antes de
 * `--execute` contra a nuvem (o banco não tem backup automático).
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeAdultContentBounds, clampAdultContentScore } from "@/lib/ai-evaluation/adult-content-rules"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { markRecalcPending } from "@/server/recalc/queue"

const EXECUTE = process.argv.includes("--execute")
const CHUNK = 200

type Admin = ReturnType<typeof createAdminClient>

async function fetchAllPaged<T>(
  fn: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fn(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function main() {
  const supabase: Admin = createAdminClient()
  console.log(`modo: ${EXECUTE ? "EXECUTE (grava)" : "dry-run (só reporta)"}`)
  console.log(`alvo: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

  // 1) Notas adult_content persistidas.
  const scoreRows = await fetchAllPaged<{ work_id: string; score: string; id: string }>(async (from, to) =>
    supabase
      .from("category_scores")
      .select("id, work_id, score")
      .eq("criterion_slug", "adult_content")
      .range(from, to),
  )
  console.log(`obras com adult_content persistido: ${scoreRows.length}`)
  const workIds = scoreRows.map((r) => r.work_id)

  // 2) Títulos (só pro relatório).
  const titleById = new Map<string, string>()
  for (const c of chunk(workIds, CHUNK)) {
    const { data, error } = await supabase.from("works").select("id, title").in("id", c)
    if (error) throw new Error(error.message)
    for (const w of data ?? []) titleById.set(w.id as string, w.title as string)
  }

  // 3) Tags de cada obra (nome + grupo + adult_score_tier) — TODAS, não só
  // content_indicator (a tag R15-based-on-R19 é checada por nome fora do grupo).
  // work_tags é fan-out (uma obra pode ter dezenas de tags — Stigma Effect tem
  // 44) — um chunk de CHUNK obras passa de 1000 linhas fácil, e o corte
  // silencioso do Supabase derrubaria tags do FIM do chunk sem erro nenhum
  // (ver CLAUDE.md, "Supabase: o select corta em 1000 linhas"). Pagina cada
  // chunk até esgotar.
  const tagsByWork = new Map<string, Array<{ name: string; group: string | null; scoreTier: string | null }>>()
  for (const c of chunk(workIds, CHUNK)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("work_tags")
        .select("work_id, tags(name, tag_group_id, adult_score_tier)")
        .in("work_id", c)
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as unknown as Array<{
        work_id: string
        tags: { name: string; tag_group_id: string | null; adult_score_tier: string | null } | null
      }>) {
        if (!row.tags?.name) continue
        const list = tagsByWork.get(row.work_id) ?? []
        list.push({
          name: row.tags.name,
          group: row.tags.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[row.tags.tag_group_id] ?? null) : null,
          scoreTier: row.tags.adult_score_tier,
        })
        tagsByWork.set(row.work_id, list)
      }
      if (!data || data.length < 1000) break
    }
  }

  // 4) Gêneros (só o gênero "Adult" importa pro rótulo, mas passamos todos).
  const genresByWork = new Map<string, string[]>()
  for (const c of chunk(workIds, CHUNK)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("work_genres")
        .select("work_id, genres(name)")
        .in("work_id", c)
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as unknown as Array<{ work_id: string; genres: { name: string } | null }>) {
        if (!row.genres?.name) continue
        const list = genresByWork.get(row.work_id) ?? []
        list.push(row.genres.name)
        genresByWork.set(row.work_id, list)
      }
      if (!data || data.length < 1000) break
    }
  }

  // 5) Recalcula piso/teto com as tags de HOJE e compara com a nota persistida.
  interface Diff {
    id: string
    csId: string
    title: string
    oldScore: number
    newScore: number
    reasons: string
  }
  const diffs: Diff[] = []
  for (const row of scoreRows) {
    const bounds = computeAdultContentBounds({
      tags: (tagsByWork.get(row.work_id) ?? []).map((t) => ({
        name: t.name,
        group: t.group,
        scoreTier: t.scoreTier === "label" || t.scoreTier === "explicit" ? t.scoreTier : null,
      })),
      genres: genresByWork.get(row.work_id) ?? [],
    })
    if (bounds.floor == null && bounds.ceiling == null) continue
    const oldScore = Number(row.score)
    const newScore = clampAdultContentScore(oldScore, bounds)
    if (newScore === oldScore) continue
    diffs.push({
      id: row.work_id,
      csId: row.id,
      title: titleById.get(row.work_id) ?? row.work_id,
      oldScore,
      newScore,
      reasons: bounds.reasons.join(" "),
    })
  }

  console.log(`\n${diffs.length} obra(s) fora do piso/teto atual:\n`)
  for (const d of diffs.sort((a, b) => Math.abs(b.newScore - b.oldScore) - Math.abs(a.newScore - a.oldScore))) {
    console.log(`  ${d.oldScore.toFixed(1)} → ${d.newScore.toFixed(1)}  ${d.title}`)
    console.log(`      ${d.reasons}`)
  }

  if (!EXECUTE) {
    console.log(`\n[dry-run] nada foi gravado. Rode com --execute pra aplicar.`)
    return
  }
  if (diffs.length === 0) {
    console.log(`\nnada a gravar.`)
    return
  }

  for (const d of diffs) {
    const { error } = await supabase.from("category_scores").update({ score: d.newScore }).eq("id", d.csId)
    if (error) console.error(`  falhou em ${d.title}: ${error.message}`)
  }
  await markRecalcPending("adult-content-retroactive-bounds")
  console.log(`\n✅ ${diffs.length} nota(s) ajustada(s). Recalc marcado como pendente (fila debounced).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
