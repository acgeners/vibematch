/**
 * Diagnóstico: quais fontes externas estão VINCULADAS a uma obra e quantas reviews
 * temos de cada. Read-only, zero LLM, zero escrita.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/inspect-sources.ts "parte do título"
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/inspect-sources.ts   # (sem arg) resumo global
 *
 * Para cada obra que casa o título mostra:
 *   - external_ids: fonte → id  [aceito | REJEITADO]
 *   - work_reviews: nº de reviews salvas por fonte
 * Cruzando os dois você vê na hora se o Mangago (ou qualquer fonte) está vinculado
 * mas sem review, ou simplesmente não vinculado.
 */
import { createAdminClient } from "@/lib/supabase/admin"

const ALL_SOURCES = [
  "mangaupdates", "anilist", "myanimelist", "kitsu",
  "animeplanet", "mangadex", "comick", "comix", "mangago",
]

async function main() {
  const sb = createAdminClient()
  const title = process.argv.slice(2).join(" ").trim()

  if (!title) {
    // Resumo global (paginado — NÃO cair no corte de 1000 linhas)
    const rows: Array<{ source: string; is_rejected: boolean | null }> = []
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from("work_external_ids").select("source, is_rejected").range(from, from + 999)
      if (!data?.length) break
      rows.push(...(data as any))
      if (data.length < 1000) break
    }
    const acc = new Map<string, number>()
    for (const r of rows) if (r.is_rejected !== true) acc.set(String(r.source), (acc.get(String(r.source)) ?? 0) + 1)
    console.log("Obras com cada fonte vinculada (aceita):")
    for (const s of ALL_SOURCES) console.log(`  ${s.padEnd(14)} ${acc.get(s) ?? 0}`)
    console.log("\nPasse parte de um título pra ver o detalhe de uma obra.")
    return
  }

  const { data: works } = await sb
    .from("works")
    .select("id, title, original_title")
    .ilike("title", `%${title}%`)
    .limit(15)
  if (!works?.length) return console.log(`Nenhuma obra casou "${title}".`)

  for (const w of works) {
    const { data: ids } = await sb
      .from("work_external_ids")
      .select("source, external_id, is_rejected")
      .eq("work_id", w.id)
    const { data: revs } = await sb
      .from("work_reviews")
      .select("source")
      .eq("work_id", w.id)
      .range(0, 4999)
    const revBySrc = new Map<string, number>()
    for (const r of revs ?? []) revBySrc.set(String(r.source), (revBySrc.get(String(r.source)) ?? 0) + 1)
    const linked = new Map<string, { id: string; rejected: boolean }>()
    for (const i of ids ?? []) linked.set(String(i.source), { id: String(i.external_id), rejected: i.is_rejected === true })

    console.log(`\n━━ "${w.title}"  (id=${w.id})`)
    for (const s of ALL_SOURCES) {
      const link = linked.get(s)
      const nRev = revBySrc.get(s) ?? 0
      const status = !link ? "— não vinculada" : link.rejected ? `REJEITADA (${link.id})` : `vinculada (${link.id})`
      const flag = link && !link.rejected && nRev === 0 ? "  ⚠️ vinculada SEM review" : ""
      console.log(`   ${s.padEnd(14)} ${status.padEnd(42)} reviews=${nRev}${flag}`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
