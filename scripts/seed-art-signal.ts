/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SEMENTE do sinal de arte: preenche `works.art_signal` no catálogo inteiro, uma vez.
 *
 * Por que existe, e por que é de COBERTURA TOTAL: daqui pra frente o sinal se mantém sozinho
 * (`refreshArtSignalForWork` roda quando reviews ou digest mudam), mas isso só cobre obra nova
 * ou reprocessada. Um FILTRO com cobertura parcial erra em silêncio nos dois sentidos — ou
 * exclui as obras antigas, e a busca volta quase vazia, ou as inclui sem ter medido nada. Não
 * há como o usuário perceber a diferença.
 *
 * ⚠️ Não gasta IA: US$0. O único custo é ler `review_digest` + `work_reviews` uma vez (a
 * metade cara do estimador, que existe justamente para não ser paga a cada recalc).
 *
 * Depois desta semente, o `recalculateAll` preenche `calculated_scores.art_estimate` e
 * `art_percentile` sozinho. Com `--com-estimativa` este script as grava na hora, para o
 * piloto não depender de um recalc completo — mesma função, mesmas entradas, mesmo valor.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA no catálogo. Rodá-lo contra o local, que é réplica
 * descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/seed-art-signal.ts
 *   ...                                                                                --execute
 *
 * O dry-run (default) NÃO grava e pode rodar contra o local para conferir cobertura:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/seed-art-signal.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { exigeAlvoNuvem } from "./lib/exige-alvo-nuvem"
import { getOwnerUserId } from "@/server/queries/current-user"
import { computeArtForCatalog } from "@/lib/art/model"
import {
  ART_SIGNAL_VERSION,
  ART_TAG_SLUGS,
  extractArtSignal,
  hasArtEvidence,
  isArtSignalStale,
  parseArtSignal,
} from "@/lib/art/signal"

const EXECUTE = process.argv.includes("--execute")
/**
 * Grava também `calculated_scores.art_estimate/art_percentile`, em vez de deixar isso para o
 * próximo recalc. Existe para o PILOTO: sem estimativa a página da obra mostra "sem número",
 * e o recalc é operação bem mais pesada do que este script.
 *
 * ⚠️ Isto faz do script um 2º escritor dessas duas colunas. Não é o padrão perigoso de dois
 * DONOS: os dois caminhos chamam `computeArtForCatalog` com as mesmas entradas, então o
 * recalc seguinte reescreve valores idênticos. Se um dia divergirem, o dono é o recalc.
 */
const COM_ESTIMATIVA = process.argv.includes("--com-estimativa")
const LOTE = 200

async function pageAll<T>(sb: any, table: string, select: string, tune?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(select).range(from, from + 999)
    if (tune) q = tune(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

async function main() {
  if (EXECUTE) {
    exigeAlvoNuvem(
      "npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/seed-art-signal.ts --execute",
    )
  }
  const sb = createAdminClient()
  console.log(`\n══ SEMENTE DO SINAL DE ARTE — ${EXECUTE ? "EXECUTANDO" : "dry-run"} ══`)
  console.log(`   alvo: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

  const works = await pageAll<any>(sb, "works", "id, review_digest, art_signal, is_archived")
  const ativas = works.filter((w) => !w.is_archived)
  const reviews = await pageAll<any>(sb, "work_reviews", "work_id, text")
  const tagRows = await pageAll<any>(sb, "work_tags", "work_id, tags(slug)")

  const textos = new Map<string, string[]>()
  for (const r of reviews) {
    const arr = textos.get(r.work_id) ?? []
    arr.push(String(r.text ?? ""))
    textos.set(r.work_id, arr)
  }
  const tags = new Map<string, Set<string>>()
  for (const t of tagRows) {
    const slug = t.tags?.slug
    if (!slug) continue
    const s = tags.get(t.work_id) ?? new Set<string>()
    s.add(slug)
    tags.set(t.work_id, s)
  }

  // Só reescreve o que está ausente ou de régua antiga — reextrair o que já está na versão
  // corrente gastaria leitura e escrita para gravar exatamente o mesmo valor.
  const pendentes = ativas.filter((w) => isArtSignalStale(parseArtSignal(w.art_signal)))
  console.log(`\n   ${ativas.length} obras ativas · ${pendentes.length} com sinal ausente ou de versão < ${ART_SIGNAL_VERSION}`)

  const atualizacoes: Array<{ id: string; art_signal: unknown }> = []
  let comEvidencia = 0
  for (const w of pendentes) {
    const signal = extractArtSignal({
      reviewDigest: w.review_digest,
      reviewTexts: textos.get(w.id) ?? [],
    })
    if (hasArtEvidence(signal, tags.get(w.id) ?? new Set())) comEvidencia++
    atualizacoes.push({ id: w.id, art_signal: signal })
  }

  const semEvidencia = atualizacoes.length - comEvidencia
  console.log(`   com evidência de arte: ${comEvidencia} · SEM nenhuma: ${semEvidencia} (${((100 * semEvidencia) / Math.max(1, atualizacoes.length)).toFixed(1)}%)`)
  console.log(`   ⚠️ as sem evidência ficam com art_estimate NULL no recalc — é um terceiro estado, não a média`)
  console.log(`   tags de arte consideradas: ${ART_TAG_SLUGS.join(", ")}`)

  if (!EXECUTE) {
    console.log(`\n   dry-run: nada gravado. Para valer:`)
    console.log(`     npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/seed-art-signal.ts --execute\n`)
    return
  }

  let gravadas = 0
  for (let i = 0; i < atualizacoes.length; i += LOTE) {
    const fatia = atualizacoes.slice(i, i + LOTE)
    // Update por linha: o upsert em `works` exigiria mandar as demais colunas de volta, e
    // sobrescrever catálogo para gravar um campo derivado é risco desproporcional.
    for (const u of fatia) {
      const { error } = await sb.from("works").update({ art_signal: u.art_signal }).eq("id", u.id)
      if (error) throw new Error(`update ${u.id}: ${error.message}`)
      gravadas++
    }
    console.log(`   ${gravadas}/${atualizacoes.length}`)
  }

  console.log(`\n   ✅ ${gravadas} sinais gravados.`)

  if (!COM_ESTIMATIVA) {
    console.log(`   Próximo passo: rodar o recalc — é ele que preenche art_estimate/art_percentile.`)
    console.log(`   (ou repetir com --com-estimativa para gravá-las agora)\n`)
    return
  }

  // 🔴 Os RÓTULOS são obrigatórios aqui. Sem eles `computeArtForCatalog` fica abaixo do piso
  // de treino e devolve null em tudo — o script "funcionaria", gravaria zero estimativas e o
  // piloto apareceria vazio sem nada acusar.
  const ownerId = await getOwnerUserId(sb)
  const rotulos = await pageAll<any>(sb, "pilot_taste_scores", "work_id, like_art_score", (q) =>
    q.eq("user_id", ownerId).not("like_art_score", "is", null),
  )
  const labelBy = new Map<string, number>(rotulos.map((r) => [r.work_id, Number(r.like_art_score)]))
  console.log(`   treino: ${labelBy.size} rótulos de arte do dono`)

  const porId = new Map(atualizacoes.map((u) => [u.id, u.art_signal]))
  const estimativas = computeArtForCatalog(
    ativas.map((w) => ({
      id: w.id,
      signal: (porId.get(w.id) ?? parseArtSignal(w.art_signal)) as never,
      tagSlugs: tags.get(w.id) ?? new Set<string>(),
      label: labelBy.get(w.id) ?? null,
    })),
  )
  let comNumero = 0
  for (const [id, r] of estimativas) {
    if (r.estimate == null) continue
    const { error } = await sb
      .from("calculated_scores")
      .update({ art_estimate: r.estimate, art_percentile: r.percentile })
      .eq("work_id", id)
    if (error) throw new Error(`estimativa ${id}: ${error.message}`)
    comNumero++
  }
  console.log(`   ✅ ${comNumero} estimativas gravadas em calculated_scores.\n`)
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
