/**
 * Backfill das REVIEWS do MyAnimeList em `work_reviews`.
 *
 * POR QUÊ: enquanto o Jikan esteve em 504, as reviews do MAL não eram colhidas. As obras
 * que passaram por busca de reviews naquele período têm reviews das outras fontes, mas
 * NENHUMA do MAL. Agora elas vêm por scraping direto do myanimelist.net (PR #109).
 *
 * ESCOPO: 747 obras do catálogo têm review de alguma fonte (reviews são colhidas sob
 * demanda, não pra todo mundo). O buraco atribuível ao Jikan são as que JÁ colheram
 * reviews, TÊM o MAL vinculado, e mesmo assim não têm nenhuma review dele: **339 obras**.
 * Obra que nunca colheu review de fonte nenhuma não é buraco do MAL — é o desenho do app,
 * e re-colher tudo seria outro projeto.
 *
 * CUSTO DE IA: ZERO. `skipPaidEnrichment: true` — só grava as linhas, sem o digest/resumo
 * (Sonnet, ~US$0,02-0,05/obra). O caminho normal do app ("Buscar reviews") gera o digest;
 * aqui NÃO, porque isso não foi autorizado e o ganho do digest só aparece na re-avaliação.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/backfill-mal-reviews.ts
 *   ...                                                                                --apply
 */
import { createClient } from "@supabase/supabase-js"
import { fetchMalReviews } from "../lib/external/myanimelist-reviews"
import { extractUserRating } from "../lib/external/index"
import { saveWorkReviews } from "../lib/external/persist-reviews"
import type { SourcedReview } from "../lib/external/types"

const APPLY = process.argv.includes("--apply")
const PAUSA_MS = 1200 // educado com o myanimelist.net (é scraping, não API)

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { data: vinculos } = await sb
    .from("work_external_ids")
    .select("work_id, external_id, works(title)")
    .eq("source", "myanimelist")
    .eq("is_rejected", false)
    .not("external_id", "is", null)

  // ⚠️ PAGINAR. O Supabase corta o select em 1000 linhas por padrão, em SILÊNCIO. Sem
  // isto, `work_reviews` (13.7k linhas) vinha truncado e o alvo saía 15x menor que o real
  // — o script "terminava com sucesso" tendo processado 6% do buraco. Erro que produz
  // resultado, de novo.
  const revs: Array<{ work_id: string; source: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("work_reviews").select("work_id, source").range(from, from + 999)
    if (!data?.length) break
    revs.push(...(data as Array<{ work_id: string; source: string }>))
    if (data.length < 1000) break
  }
  const comAlgumaReview = new Set(revs.map((r) => r.work_id))
  const comReviewMal = new Set(revs.filter((r) => r.source === "myanimelist").map((r) => r.work_id))

  const alvos = (vinculos ?? [])
    .filter((v) => comAlgumaReview.has(v.work_id as string) && !comReviewMal.has(v.work_id as string))
    .map((v) => ({
      workId: v.work_id as string,
      malId: Number(v.external_id),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      title: ((v as any).works?.title as string) ?? "?",
    }))
    .filter((a) => Number.isInteger(a.malId) && a.malId > 0)

  console.log(`obras que já colheram reviews, têm MAL vinculado e NÃO têm review do MAL: ${alvos.length}`)
  console.log(APPLY ? "  (APPLY — vai gravar)\n" : "  (DRY-RUN — nada será gravado)\n")
  if (alvos.length === 0) return

  let totalReviews = 0
  let comReview = 0
  let semReview = 0

  for (const alvo of alvos) {
    const textos = await fetchMalReviews(alvo.malId).catch(() => [])
    if (textos.length === 0) {
      semReview += 1
      console.log(`   0  "${alvo.title.slice(0, 46)}"`)
      await sleep(PAUSA_MS)
      continue
    }

    const reviews: SourcedReview[] = textos.map((texto): SourcedReview => {
      const { rating, cleanText } = extractUserRating(texto)
      return {
        source: "myanimelist",
        sourceTitle: alvo.title,
        // O vínculo com o MAL já foi ACEITO pelo usuário (está em work_external_ids, não
        // rejeitado), então não há match a pontuar aqui: é 1 por construção.
        matchScore: 1,
        text: cleanText,
        userRating: rating,
        textLength: cleanText.length,
      }
    })

    if (APPLY) {
      // `accumulate` = união por fonte; NUNCA remove review boa de outra fonte.
      // `skipPaidEnrichment` = sem digest/resumo Sonnet. Custo de IA: zero.
      await saveWorkReviews(alvo.workId, reviews, { skipPaidEnrichment: true, accumulate: true })
    }

    totalReviews += reviews.length
    comReview += 1
    console.log(`  ${String(reviews.length).padStart(2)}  "${alvo.title.slice(0, 46)}"`)
    await sleep(PAUSA_MS)
  }

  console.log(`\n  obras com review do MAL:  ${comReview}`)
  console.log(`  obras sem review no MAL:  ${semReview}   (o MAL simplesmente não tem)`)
  console.log(`  reviews ${APPLY ? "GRAVADAS" : "que seriam gravadas"}: ${totalReviews}`)
  console.log(`  custo de IA: US$ 0,00  (digest não foi gerado — ver o cabeçalho do script)`)
  if (!APPLY) console.log(`\n──> DRY-RUN. Rode de novo com --apply pra gravar.`)
}

main()
