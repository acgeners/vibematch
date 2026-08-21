/**
 * Adiciona a tag R19 a todas as obras com adult_content >= 7.
 * DRY-RUN por padrão (read-only). --execute grava (aditivo, ignoreDuplicates,
 * source NULL = igual às tags manuais).
 *
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/tag-r19-adult.ts [--execute]
 *
 * Ao executar, grava a lista de work_ids inseridos em r19-reversal.json (ou
 * $R19_REVERSAL_OUT) para rollback. Reverter:
 *   DELETE FROM work_tags WHERE tag_id = '<R19>' AND work_id IN (
 *     SELECT work_id FROM category_scores
 *     WHERE criterion_slug = 'adult_content' AND score >= 7);
 */
import { createAdminClient } from "@/lib/supabase/admin"
import fs from "node:fs"
import { criarFunil } from "./lib/funil.mjs"

const R19_TAG_ID = "b4df1fa0-52c0-4cbe-8ae5-381da77c0a36"
const THRESHOLD = 7
const EXECUTE = process.argv.includes("--execute")

async function main() {
  const sb = createAdminClient()

  // 0) Sanidade: a tag existe?
  const { data: tag, error: tagErr } = await sb
    .from("tags")
    .select("id, name, slug")
    .eq("id", R19_TAG_ID)
    .maybeSingle()
  if (tagErr) throw tagErr
  if (!tag) throw new Error(`Tag ${R19_TAG_ID} não encontrada em tags`)
  console.log(`Tag alvo: "${tag.name}" (slug=${tag.slug})`)

  // 1) Obras com adult_content >= THRESHOLD
  const { data: scores, error: scoreErr } = await sb
    .from("category_scores")
    .select("work_id, score")
    .eq("criterion_slug", "adult_content")
    .gte("score", THRESHOLD)
  if (scoreErr) throw scoreErr
  const qualifyingIds = [...new Set((scores ?? []).map((s) => s.work_id as string))]
  const funil = criarFunil("tag R19 por adult_content")
  funil.passo(`com adult_content >= ${THRESHOLD}`, qualifyingIds.length)

  if (qualifyingIds.length === 0) {
    funil.nadaAFazer("Nada a fazer.")
    return
  }

  // 2) Metadados das obras (título, arquivada) — em chunks pra evitar .in() gigante
  const chunk = <T,>(arr: T[], n: number) =>
    Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

  const worksById = new Map<string, { title: string; is_archived: boolean }>()
  for (const ids of chunk(qualifyingIds, 200)) {
    const { data, error } = await sb.from("works").select("id, title, is_archived").in("id", ids)
    if (error) throw error
    for (const w of data ?? []) worksById.set(w.id as string, { title: w.title as string, is_archived: w.is_archived as boolean })
  }

  // 3) Quais dessas já têm a tag R19?
  const alreadyTagged = new Set<string>()
  for (const ids of chunk(qualifyingIds, 200)) {
    const { data, error } = await sb
      .from("work_tags")
      .select("work_id")
      .eq("tag_id", R19_TAG_ID)
      .in("work_id", ids)
    if (error) throw error
    for (const r of data ?? []) alreadyTagged.add(r.work_id as string)
  }

  const toInsert = qualifyingIds.filter((id) => !alreadyTagged.has(id))
  const archivedCount = qualifyingIds.filter((id) => worksById.get(id)?.is_archived).length

  console.log(`  já com R19:        ${alreadyTagged.size}`)
  funil.passo("a inserir (ainda sem a tag)", toInsert.length)
  funil.relatar()
  console.log(`  a inserir:         ${toInsert.length}`)
  console.log(`  (destas, arquivadas: ${qualifyingIds.filter((id) => worksById.get(id)?.is_archived).length}; a inserir arquivadas: ${toInsert.filter((id) => worksById.get(id)?.is_archived).length})`)
  console.log(`  total obras arquivadas no conjunto: ${archivedCount}`)

  // Amostra dos títulos a inserir
  console.log("\nAmostra (até 40) a inserir:")
  for (const id of toInsert.slice(0, 40)) {
    const w = worksById.get(id)
    console.log(`  - ${w?.title ?? "(sem título)"}${w?.is_archived ? "  [arquivada]" : ""}  ${id}`)
  }
  if (toInsert.length > 40) console.log(`  ... e mais ${toInsert.length - 40}`)

  if (!EXECUTE) {
    console.log("\n[DRY-RUN] Nada gravado. Rode com --execute pra aplicar.")
    return
  }

  // 4) EXECUTA — insere (work_id, tag_id) sem source (= manual/legado), ignora duplicatas
  const reversalPath = process.env.R19_REVERSAL_OUT ?? "r19-reversal.json"
  fs.writeFileSync(
    reversalPath,
    JSON.stringify({ tag_id: R19_TAG_ID, threshold: THRESHOLD, inserted_work_ids: toInsert }, null, 2)
  )
  console.log(`\nReversão salva em ${reversalPath} (${toInsert.length} ids)`)

  let inserted = 0
  for (const ids of chunk(toInsert, 200)) {
    const rows = ids.map((work_id) => ({ work_id, tag_id: R19_TAG_ID }))
    const { error } = await sb
      .from("work_tags")
      .upsert(rows, { onConflict: "work_id,tag_id", ignoreDuplicates: true })
    if (error) throw error
    inserted += rows.length
    console.log(`  inseridas (lote): +${rows.length} (acum ${inserted}/${toInsert.length})`)
  }

  // 5) Verificação pós-gravação
  let verifyCount = 0
  for (const ids of chunk(qualifyingIds, 200)) {
    const { count, error } = await sb
      .from("work_tags")
      .select("work_id", { count: "exact", head: true })
      .eq("tag_id", R19_TAG_ID)
      .in("work_id", ids)
    if (error) throw error
    verifyCount += count ?? 0
  }
  console.log(`\n✅ Concluído. Obras qualificadas agora com R19: ${verifyCount}/${qualifyingIds.length}`)
}

main().catch((e) => {
  console.error("ERRO:", e)
  process.exit(1)
})
