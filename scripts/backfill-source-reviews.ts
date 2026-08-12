/**
 * Backfill das REVIEWS de uma fonte Cloudflare-gated (`--fonte=comix|mangago`) em
 * `work_reviews`, para obras que TÊM o vínculo e ZERO reviews dela.
 *
 * POR QUÊ: as duas fontes acumulam o mesmo passivo por motivos diferentes — coleta que
 * rodou antes da fonte existir no pipeline, e coleta que falhou em SILÊNCIO (2026-08-11:
 * o sidecar bloqueado comia o teto de 25s e a Comix vinha vazia em toda obra, sem erro).
 *
 * ⚠️ UM script para as duas, e não dois: a única diferença real é qual `fetch*Reviews`
 * chamar. Baldes, dry-run, custo zero, paginação e a detecção de "bypass fora" são
 * idênticos — um gêmeo seria a segunda cópia da mesma verdade, que este projeto já
 * pagou caro várias vezes (ver `LOW_BALANCE_USD`, `STRONG_TAG_WEIGHT`).
 *
 * ESCOPO — os dois baldes rendem, e isso foi MEDIDO, não suposto (amostra de 8+8):
 *   `vazias` (273) obras que já colheram de OUTRAS fontes e não têm nada da Comix
 *                  → 5/8 trouxeram reviews (184 no total)
 *   `nunca`   (93) obras sem review de fonte alguma
 *                  → 7/8 trouxeram reviews (139 no total)
 * ⚠️ A suposição inicial era que `vazias` fosse "a Comix não tem essa obra" e não
 * rendesse. Falso: a maioria rende. Não pule esse balde por dedução.
 *
 * CUSTO DE IA: ZERO. `skipPaidEnrichment: true` — grava as linhas sem gerar
 * digest/resumo (Sonnet, ~US$0,02-0,05/obra; nas 369 da Comix seriam US$7-18). O caminho normal
 * do app ("Buscar reviews") gera o digest; aqui NÃO, porque o ganho dele só aparece na
 * re-avaliação e isso é outra decisão, com outro orçamento.
 *
 * ⚠️ EXIGE o FlareSolverr de pé (`docker start flaresolverr`). As DUAS fontes são
 * Cloudflare-gated e nenhuma é atravessada pelo sidecar hoje (o Mangago nunca teve
 * sidecar; a Comix deixou de passar em 29/07) — o FlareSolverr é a ÚNICA via. Sem ele o
 * script roda inteiro e grava ZERO, que é o modo de falha caro. O resumo denuncia.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA. Rodá-lo contra o local, que é réplica descartável,
 *    joga o trabalho fora no próximo `db:pull`.
 *   npm run reviews:backfill -- --fonte=mangago                      # dry-run
 *   npm run reviews:backfill -- --fonte=comix --escopo=nunca --limit=20
 *   npm run reviews:backfill -- --fonte=mangago --apply
 */
import { createClient } from "@supabase/supabase-js"
import { fetchComixReviews } from "../lib/external/comix"
import { fetchMangagoReviews } from "../lib/external/mangago"
import { extractUserRating } from "../lib/external/index"
import { saveWorkReviews } from "../lib/external/persist-reviews"
import type { SourcedReview } from "../lib/external/types"
import { exigeAlvoNuvem } from "./lib/exige-alvo-nuvem"

const APPLY = process.argv.includes("--apply")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null
const ESCOPO = (arg("escopo") ?? "todas") as "vazias" | "nunca" | "todas"
/** Fontes suportadas: as gateadas por Cloudflare cujo id basta para buscar reviews. */
const FONTES = {
  comix: { fetch: (id: string, max?: number) => fetchComixReviews(id).then((r) => (max ? r.slice(0, max) : r)), rotulo: "Comix" },
  mangago: { fetch: (id: string, max?: number) => fetchMangagoReviews(id, max ?? 40), rotulo: "Mangago" },
} as const
const FONTE = arg("fonte") as keyof typeof FONTES | null
const LIMITE = Number(arg("limit")) || Infinity
// Teto de reviews POR OBRA. É a única alavanca real de velocidade: `fetchMangagoReviews`
// faz UM fetch por review (~44 requisições com o default 40 ⇒ ~37s/obra, medido), e
// paralelizar não adianta — a sessão nomeada do FlareSolverr é serializada de propósito
// (duas chamadas concorrentes na mesma sessão leem a página uma da outra).
const MAX_REVIEWS = Number(arg("max-reviews")) || undefined
// A cadeia da Comix já leva ~2,5s por obra (4 chamadas via FlareSolverr). A pausa é
// polidez com o origin, não throttle nosso.
const PAUSA_MS = 800

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** ⚠️ `select` corta em 1000 linhas SEM avisar — `work_reviews` tem ~14k. Paginar sempre. */
async function paginar<T>(tabela: string, cols: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(tabela).select(cols).range(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

async function main() {
  if (!FONTE || !(FONTE in FONTES)) {
    console.error(`--fonte é obrigatório. Use: ${Object.keys(FONTES).join(" | ")}`)
    process.exitCode = 1
    return
  }
  if (!["vazias", "nunca", "todas"].includes(ESCOPO)) {
    console.error(`--escopo inválido: "${ESCOPO}". Use vazias | nunca | todas.`)
    process.exitCode = 1
    return
  }
  const fonte = FONTES[FONTE]
  // Ver o gêmeo em resolve-mangago-slugs.ts: o que se perde aqui é a coleta inteira.
  if (APPLY) exigeAlvoNuvem(`npm run reviews:backfill -- --fonte=${FONTE} --apply`)

  const works = (await paginar<{ id: string; title: string; is_archived: boolean | null }>(
    "works",
    "id, title, is_archived",
  )).filter((w) => !w.is_archived)
  const ids = await paginar<{ work_id: string; source: string; external_id: string | null; is_rejected: boolean | null }>(
    "work_external_ids",
    "work_id, source, external_id, is_rejected",
  )
  const revs = await paginar<{ work_id: string; source: string }>("work_reviews", "work_id, source")

  const idDe = new Map<string, string>()
  for (const r of ids) {
    if (r.source === FONTE && r.external_id && r.is_rejected !== true) idDe.set(r.work_id, r.external_id)
  }
  const temDaFonte = new Set(revs.filter((r) => r.source === FONTE).map((r) => r.work_id))
  // "outra" exclui a PRÓPRIA fonte de propósito: é isso que separa "a coleta já rodou
  // nesta obra e esta fonte não trouxe nada" de "nunca colhemos nada dela".
  const temOutra = new Set(revs.filter((r) => r.source !== FONTE).map((r) => r.work_id))

  // Sem review da Comix, mas COM o vínculo. O balde separa "a coleta já rodou nesta obra"
  // de "nunca colhemos nada dela" — ver o cabeçalho: os dois rendem.
  const candidatos = works
    .filter((w) => idDe.has(w.id) && !temDaFonte.has(w.id))
    .map((w) => ({ workId: w.id, title: w.title, externalId: idDe.get(w.id)!, balde: temOutra.has(w.id) ? "vazias" : "nunca" }))
  const alvos = candidatos.filter((c) => ESCOPO === "todas" || c.balde === ESCOPO).slice(0, LIMITE)

  const nVazias = alvos.filter((a) => a.balde === "vazias").length
  console.log(
    `obras com ${fonte.rotulo} vinculada e ZERO reviews: ${candidatos.length}` +
      `  (escopo="${ESCOPO}" ⇒ ${alvos.length}: ${nVazias} já colheram de outra fonte, ${alvos.length - nVazias} nunca)`,
  )
  console.log(APPLY ? "  (APPLY — vai gravar na NUVEM)\n" : "  (DRY-RUN — nada será gravado)\n")
  if (!alvos.length) return
  // 🔴 ETA impresso ANTES de começar. A Comix custa ~2,5s/obra; o Mangago ~37s, porque
  // busca UMA página por review. Medido em 2026-08-11: 405 obras = ~3,7h, contra os
  // "20-30 min" que eu havia estimado de cabeça. Estimativa que não sai do custo real da
  // fonte não é estimativa — e um lote de horas sem ETA vira "está travado?".
  const SEG_POR_OBRA: Record<string, number> = { comix: 2.5, mangago: 37 }
  const eta = Math.round((alvos.length * (SEG_POR_OBRA[FONTE] ?? 10)) / 60)
  console.log(`  ⏱  ≈${eta} min (${alvos.length} obras). Pode interromper: o escopo é recalculado,`)
  console.log(`     então o que já gravou sai da lista e a retomada continua de onde parou.\n`)

  let totalReviews = 0
  let comReview = 0
  let semReview = 0
  let feitas = 0
  const t0 = Date.now()
  // Uma linha por obra já dá sinal de vida, mas não diz QUANTO FALTA — e num lote de
  // horas é isso que separa "está indo" de "está travado".
  const marcarProgresso = () => {
    feitas += 1
    if (feitas % 20 !== 0 || feitas === alvos.length) return
    const restaMin = Math.round(((Date.now() - t0) / feitas) * (alvos.length - feitas) / 60000)
    console.log(`  ⏱  ${feitas}/${alvos.length} · ${totalReviews} reviews · faltam ~${restaMin} min`)
  }

  for (const alvo of alvos) {
    const textos = await fonte.fetch(alvo.externalId, MAX_REVIEWS).catch(() => [] as string[])
    if (textos.length === 0) {
      semReview += 1
      console.log(`  ${"0".padStart(3)}  "${alvo.title.slice(0, 46)}"`)
      marcarProgresso()
      await sleep(PAUSA_MS)
      continue
    }

    const reviews: SourcedReview[] = textos.map((texto): SourcedReview => {
      const { rating, cleanText } = extractUserRating(texto)
      return {
        source: FONTE,
        sourceTitle: alvo.title,
        // O vínculo já foi ACEITO (está em work_external_ids, não rejeitado),
        // então não há match a pontuar: é 1 por construção.
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
    console.log(`  ${String(reviews.length).padStart(3)}  "${alvo.title.slice(0, 46)}"`)
    marcarProgresso()
    await sleep(PAUSA_MS)
  }

  console.log(`\n  obras que trouxeram reviews: ${comReview}`)
  console.log(`  obras sem review em ${fonte.rotulo}:    ${semReview}`)
  console.log(`  reviews ${APPLY ? "GRAVADAS" : "que seriam gravadas"}: ${totalReviews}`)
  console.log(`  custo de IA: US$ 0,00  (digest não foi gerado — ver o cabeçalho)`)

  // 🔴 Zero em TODAS as obras é o fingerprint de "o bypass está fora", não de "a Comix
  // não tem nada" — foi exatamente assim que a fonte sumiu por dias sem ninguém notar.
  if (comReview === 0 && alvos.length >= 5) {
    console.error(
      `\n🔴 NENHUMA das ${alvos.length} obras trouxe review. Isso quase nunca é ${fonte.rotulo} estar vazio:` +
        `\n   confira se o FlareSolverr está de pé (docker start flaresolverr) antes de concluir` +
        `\n   qualquer coisa deste resultado.`,
    )
    process.exitCode = 3
  }
  if (!APPLY && comReview > 0) console.log(`\n──> DRY-RUN. Rode de novo com --apply pra gravar.`)
}

// 🔴 `process.exit(0)` explícito, como o `inspect-sources.ts`. Sem ele o processo fica
// PENDURADO depois de imprimir o resumo — o trabalho já está gravado, mas o terminal não
// volta, e isso é indistinguível de "ainda rodando". Medido em 2026-08-11: o lote do
// Mangago terminou de persistir e seguiu vivo, com a contagem no banco estável por 75s.
// Segura o event loop algum handle de keep-alive (fetch/undici, refresh de auth do
// supabase-js); sair explicitamente é o que os outros scripts do repo já fazem.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
