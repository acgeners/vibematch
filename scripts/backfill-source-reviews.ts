/**
 * Backfill das REVIEWS de uma fonte (`--fonte=comix|mangago|mangaupdates`) em `work_reviews`,
 * para obras que TÊM o vínculo aceito com ela.
 *
 * POR QUÊ: as fontes acumulam o mesmo passivo por motivos diferentes — coleta que rodou antes
 * da fonte existir no pipeline, e coleta que falhou em SILÊNCIO (2026-08-11: o sidecar bloqueado
 * comia o teto de 25s e a Comix vinha vazia em toda obra, sem erro; 2026-06-17 → 2026-11-05: o
 * MangaUpdates respondia 429 ao User-Agent antigo e o conector devolvia `[]`, 4,5 meses sem coletar).
 *
 * ⚠️ UM script para todas, e não um por fonte: a única diferença real é COMO buscar. Baldes,
 * dry-run, custo zero, paginação e a detecção de "fonte fora" são idênticos — um gêmeo seria a
 * segunda cópia da mesma verdade, que este projeto já pagou caro várias vezes (ver
 * `LOW_BALANCE_USD`, `STRONG_TAG_WEIGHT`).
 *
 * ESCOPO — os dois baldes de "zero reviews da fonte" rendem, e isso foi MEDIDO (amostra de 8+8):
 *   `vazias` (273) obras que já colheram de OUTRAS fontes e não têm nada da Comix
 *                  → 5/8 trouxeram reviews (184 no total)
 *   `nunca`   (93) obras sem review de fonte alguma
 *                  → 7/8 trouxeram reviews (139 no total)
 * ⚠️ A suposição inicial era que `vazias` fosse "a Comix não tem essa obra" e não
 * rendesse. Falso: a maioria rende. Não pule esse balde por dedução.
 *   `todas` (padrão) = `vazias` + `nunca`.
 *   `vinculadas` = TODA obra com o vínculo, inclusive as que já têm reviews da fonte. Existe para
 *                  o caso do MangaUpdates: as 409 obras com reviews de lá pararam no retrato de
 *                  17/06, e o que entrou depois só chega rebuscando. Seguro porque a gravação é
 *                  ACUMULATIVA (só insere texto novo) — e o script conta as novas ANTES de gravar.
 *
 * CUSTO DE IA: ZERO. `skipPaidEnrichment: true` — grava as linhas sem gerar
 * digest/resumo (Sonnet, ~US$0,02-0,05/obra; nas 369 da Comix seriam US$7-18). O caminho normal
 * do app ("Buscar reviews") gera o digest; aqui NÃO, porque o ganho dele só aparece na
 * re-avaliação e isso é outra decisão, com outro orçamento.
 *
 * ⚠️ O que a gravação MEXE além de `work_reviews` (de graça, mas visível): `works.reviews_hash`,
 * `works.art_signal` (extração local) e, na obra com avaliação concluída, `ai_eval_reviews_stale`
 * — ela entra na fila "Reviews novas" de `/curation/works`. É o sinal certo (a avaliação não viu
 * essas reviews), e por isso o resumo imprime QUANTAS vão entrar. Obra sem review nova não é
 * gravada, então nada disso muda nela.
 *
 * ⚠️ Comix e Mangago EXIGEM o FlareSolverr de pé (`docker start flaresolverr`): são
 * Cloudflare-gated e nenhuma é atravessada pelo sidecar hoje (o Mangago nunca teve sidecar; a
 * Comix deixou de passar em 29/07). Sem ele o script roda inteiro e grava ZERO, que é o modo de
 * falha caro. O resumo denuncia. O MangaUpdates vem da API oficial e não precisa de bypass.
 *
 * Falha da fonte NÃO é "0 reviews": quando o adaptador rejeita (o Mangago lança
 * `MangagoUnavailableError`; o MangaUpdates, `MangaUpdatesUnavailableError`), a obra sai como
 * `ERR`, nada é gravado e ela segue no escopo da próxima execução — ver
 * `scripts/lib/coleta-de-reviews.ts`.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA. Rodá-lo contra o local, que é réplica descartável,
 *    joga o trabalho fora no próximo `db:pull`.
 *   npm run reviews:backfill -- --fonte=mangago                      # dry-run
 *   npm run reviews:backfill -- --fonte=comix --escopo=nunca --limit=20
 *   npm run reviews:backfill -- --fonte=mangaupdates --escopo=vinculadas
 *   npm run reviews:backfill -- --fonte=mangago --apply
 */
import { createClient } from "@supabase/supabase-js"
import { fetchComixReviews } from "../lib/external/comix"
import { fetchMangagoReviews } from "../lib/external/mangago"
import { extractUserRating } from "../lib/external/index"
import { saveWorkReviews } from "../lib/external/persist-reviews"
import type { ExternalSourceId, SourcedReview } from "../lib/external/types"
import { exigeAlvoNuvem } from "./lib/exige-alvo-nuvem"
import { buscarComoOApp, chaveDaReview, coletarReviewsDaObra, soAsNovas } from "./lib/coleta-de-reviews"

const APPLY = process.argv.includes("--apply")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null
const ESCOPOS = ["vazias", "nunca", "todas", "vinculadas"] as const
const ESCOPO = (arg("escopo") ?? "todas") as (typeof ESCOPOS)[number]
const LIMITE = Number(arg("limit")) || Infinity
// Teto de reviews POR OBRA. É a única alavanca real de velocidade: `fetchMangagoReviews`
// faz UM fetch por review (~44 requisições com o default 40 ⇒ ~37s/obra, medido), e
// paralelizar não adianta — a sessão nomeada do FlareSolverr é serializada de propósito
// (duas chamadas concorrentes na mesma sessão leem a página uma da outra).
const MAX_REVIEWS = Number(arg("max-reviews")) || undefined
// A cadeia da Comix já leva ~2,5s por obra (4 chamadas via FlareSolverr). A pausa é
// polidez com o origin, não throttle nosso.
const PAUSA_MS = 800

type Alvo = { workId: string; title: string; externalId: string }

/** Texto cru do adaptador → review gravável. Usado pelas fontes que só devolvem texto. */
const paraSourced = (source: ExternalSourceId, textos: string[], titulo: string): SourcedReview[] =>
  textos.map((texto): SourcedReview => {
    const { rating, cleanText } = extractUserRating(texto)
    return {
      source,
      sourceTitle: titulo,
      // O vínculo já foi ACEITO (está em work_external_ids, não rejeitado),
      // então não há match a pontuar: é 1 por construção.
      matchScore: 1,
      text: cleanText,
      userRating: rating,
      textLength: cleanText.length,
    }
  })

const corta = <T>(lista: T[]) => (MAX_REVIEWS ? lista.slice(0, MAX_REVIEWS) : lista)

/**
 * `segPorObra` é o custo MEDIDO de cada fonte (vira o ETA); `bypass` diz se ela depende do
 * FlareSolverr — é o que o alarme de "zero em tudo" manda conferir.
 */
const FONTES = {
  comix: {
    rotulo: "Comix",
    segPorObra: 2.5,
    bypass: true,
    buscar: (a: Alvo) => fetchComixReviews(a.externalId).then((r) => paraSourced("comix", corta(r), a.title)),
  },
  mangago: {
    rotulo: "Mangago",
    segPorObra: 37,
    bypass: true,
    buscar: (a: Alvo) => fetchMangagoReviews(a.externalId, MAX_REVIEWS ?? 40).then((r) => paraSourced("mangago", r, a.title)),
  },
  mangaupdates: {
    rotulo: "MangaUpdates",
    segPorObra: 1.5,
    bypass: false,
    // O MESMO caminho do app, e não um mapeamento próprio — ver `buscarComoOApp`.
    buscar: (a: Alvo) => buscarComoOApp("mangaupdates", a.externalId, a.title).then(corta),
  },
} as const
const FONTE = arg("fonte") as keyof typeof FONTES | null

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * ⚠️ `select` corta em 1000 linhas SEM avisar — `work_reviews` tem ~15k. Paginar sempre.
 * 🔴 E paginar com `ORDER BY` por chave ÚNICA: sem ele o Postgres não promete ordem entre
 * páginas, e uma linha some enquanto outra vem duas vezes (medido: 2050 lidas, 1550 únicas).
 * Aqui isso decidiria o ESCOPO — obra sumida da leitura de reviews pareceria "zero da fonte".
 */
async function paginar<T>(tabela: string, cols: string, ordem: string, eq?: [string, string]): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(tabela).select(cols)
    if (eq) q = q.eq(eq[0], eq[1])
    const { data, error } = await q.order(ordem).range(from, from + 999)
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
  if (!(ESCOPOS as readonly string[]).includes(ESCOPO)) {
    console.error(`--escopo inválido: "${ESCOPO}". Use ${ESCOPOS.join(" | ")}.`)
    process.exitCode = 1
    return
  }
  const fonte = FONTES[FONTE]
  // Ver o gêmeo em resolve-mangago-slugs.ts: o que se perde aqui é a coleta inteira.
  if (APPLY) exigeAlvoNuvem(`npm run reviews:backfill -- --fonte=${FONTE} --escopo=${ESCOPO} --apply`)

  const works = (await paginar<{
    id: string
    title: string
    is_archived: boolean | null
    ai_eval_status: string | null
    ai_eval_reviews_stale: boolean | null
  }>("works", "id, title, is_archived, ai_eval_status, ai_eval_reviews_stale", "id")).filter((w) => !w.is_archived)
  const ids = await paginar<{ work_id: string; source: string; external_id: string | null; is_rejected: boolean | null }>(
    "work_external_ids",
    "id, work_id, source, external_id, is_rejected",
    "id",
  )
  const revs = await paginar<{ work_id: string; source: string }>("work_reviews", "id, work_id, source", "id")

  const idDe = new Map<string, string>()
  for (const r of ids) {
    if (r.source === FONTE && r.external_id && r.is_rejected !== true) idDe.set(r.work_id, r.external_id)
  }
  const temDaFonte = new Set(revs.filter((r) => r.source === FONTE).map((r) => r.work_id))
  // "outra" exclui a PRÓPRIA fonte de propósito: é isso que separa "a coleta já rodou
  // nesta obra e esta fonte não trouxe nada" de "nunca colhemos nada dela".
  const temOutra = new Set(revs.filter((r) => r.source !== FONTE).map((r) => r.work_id))

  // COM o vínculo. O balde separa "já tem reviews desta fonte", "a coleta já rodou nesta obra
  // e esta fonte não trouxe nada" e "nunca colhemos nada dela" — ver o cabeçalho.
  const candidatos = works
    .filter((w) => idDe.has(w.id))
    .map((w) => ({
      workId: w.id,
      title: w.title,
      externalId: idDe.get(w.id)!,
      balde: temDaFonte.has(w.id) ? "ja-tem" : temOutra.has(w.id) ? "vazias" : "nunca",
      // Avaliação concluída e ainda NÃO marcada: é a que review nova põe em "Reviews novas".
      marcaReviewsNovas: w.ai_eval_status === "done" && w.ai_eval_reviews_stale !== true,
    }))
  const noEscopo = (balde: string) =>
    ESCOPO === "vinculadas" || (balde !== "ja-tem" && (ESCOPO === "todas" || balde === ESCOPO))
  const alvos = candidatos.filter((c) => noEscopo(c.balde)).slice(0, LIMITE)

  const nPorBalde = (b: string) => alvos.filter((a) => a.balde === b).length
  console.log(
    `obras com ${fonte.rotulo} vinculada: ${candidatos.length}` +
      ` (${candidatos.filter((c) => c.balde !== "ja-tem").length} com ZERO reviews dela)` +
      `  ·  escopo="${ESCOPO}" ⇒ ${alvos.length}: ${nPorBalde("ja-tem")} já têm, ` +
      `${nPorBalde("vazias")} colheram de outra fonte, ${nPorBalde("nunca")} nunca`,
  )
  console.log(APPLY ? "  (APPLY — vai gravar na NUVEM)\n" : "  (DRY-RUN — nada será gravado)\n")
  if (!alvos.length) return

  // O que JÁ existe desta fonte, para contar as novas ANTES de gravar. Só é lido quando o escopo
  // inclui obra que já tem reviews dela — nos outros, por construção, tudo que vier é novo.
  const existentes = new Map<string, Set<string>>()
  if (nPorBalde("ja-tem") > 0) {
    const textos = await paginar<{ work_id: string; text: string | null }>(
      "work_reviews",
      "id, work_id, text",
      "id",
      ["source", FONTE],
    )
    for (const r of textos) {
      const s = existentes.get(r.work_id) ?? new Set<string>()
      s.add(chaveDaReview(r.text ?? ""))
      existentes.set(r.work_id, s)
    }
  }

  // 🔴 ETA impresso ANTES de começar. A Comix custa ~2,5s/obra; o Mangago ~37s, porque
  // busca UMA página por review. Medido em 2026-08-11: 405 obras = ~3,7h, contra os
  // "20-30 min" que eu havia estimado de cabeça. Estimativa que não sai do custo real da
  // fonte não é estimativa — e um lote de horas sem ETA vira "está travado?".
  const eta = Math.round((alvos.length * fonte.segPorObra) / 60)
  console.log(`  ⏱  ≈${eta} min (${alvos.length} obras). Pode interromper: o escopo é recalculado,`)
  console.log(`     então o que já gravou sai da lista e a retomada continua de onde parou.\n`)

  let totalReviews = 0
  let totalNovas = 0
  let comReview = 0
  let comNovas = 0
  let marcadas = 0
  let semReview = 0
  // Fonte que NÃO respondeu (a promise rejeitou). Contada à parte de `semReview`: juntar as duas
  // era o defeito — a falha aparecia como "obra sem review".
  let falharam = 0
  const motivosDaFalha = new Map<string, number>()
  let feitas = 0
  const t0 = Date.now()
  // Uma linha por obra já dá sinal de vida, mas não diz QUANTO FALTA — e num lote de
  // horas é isso que separa "está indo" de "está travado".
  const marcarProgresso = () => {
    feitas += 1
    if (feitas % 20 !== 0 || feitas === alvos.length) return
    const restaMin = Math.round(((Date.now() - t0) / feitas) * (alvos.length - feitas) / 60000)
    console.log(`  ⏱  ${feitas}/${alvos.length} · ${totalNovas} novas · faltam ~${restaMin} min`)
  }

  for (const alvo of alvos) {
    let novas: SourcedReview[] = []
    const resultado = await coletarReviewsDaObra(
      () => fonte.buscar(alvo),
      // `accumulate` = união por fonte; NUNCA remove review boa de outra fonte.
      // `skipPaidEnrichment` = sem digest/resumo Sonnet. Custo de IA: zero.
      // Sem review nova a obra NÃO é gravada: o save reescreveria o sinal de arte à toa.
      async (reviews) => {
        novas = soAsNovas(existentes.get(alvo.workId), reviews)
        if (APPLY && novas.length > 0) {
          await saveWorkReviews(alvo.workId, reviews, { skipPaidEnrichment: true, accumulate: true })
        }
      },
    )

    if (resultado.status === "falhou") {
      falharam += 1
      motivosDaFalha.set(resultado.motivo, (motivosDaFalha.get(resultado.motivo) ?? 0) + 1)
      console.log(`  ERR  "${alvo.title.slice(0, 46)}"  (${resultado.motivo})`)
    } else if (resultado.status === "zero") {
      semReview += 1
      console.log(`  ${"0".padStart(3)}  "${alvo.title.slice(0, 46)}"`)
    } else {
      totalReviews += resultado.textos.length
      totalNovas += novas.length
      comReview += 1
      if (novas.length > 0) {
        comNovas += 1
        if (alvo.marcaReviewsNovas) marcadas += 1
      }
      console.log(
        `  ${String(resultado.textos.length).padStart(3)}  "${alvo.title.slice(0, 46)}"` +
          (novas.length !== resultado.textos.length ? `  (${novas.length} novas)` : ""),
      )
    }
    marcarProgresso()
    await sleep(PAUSA_MS)
  }

  console.log(`\n  obras que trouxeram reviews: ${comReview}  (com review NOVA: ${comNovas})`)
  console.log(`  obras sem review em ${fonte.rotulo}:    ${semReview}`)
  console.log(`  obras em que ${fonte.rotulo} FALHOU:  ${falharam}`)
  console.log(`  reviews trazidas: ${totalReviews}  ·  NOVAS ${APPLY ? "GRAVADAS" : "que seriam gravadas"}: ${totalNovas}`)
  console.log(`  obras que ${APPLY ? "entraram" : "entrariam"} em "Reviews novas": ${marcadas}`)
  console.log(`  custo de IA: US$ 0,00  (digest não foi gerado — ver o cabeçalho)`)

  // 🔴 Zero em TODAS as obras é o fingerprint de "a fonte está fora", não de "ela não tem
  // nada" — foi exatamente assim que a Comix sumiu por dias e o MangaUpdates por meses.
  if (comReview === 0 && alvos.length >= 5) {
    console.error(
      `\n🔴 NENHUMA das ${alvos.length} obras trouxe review. Isso quase nunca é ${fonte.rotulo} estar vazio:` +
        (fonte.bypass
          ? `\n   confira se o FlareSolverr está de pé (docker start flaresolverr) antes de concluir`
          : `\n   confira se a fonte responde (status HTTP, User-Agent recusado) antes de concluir`) +
        `\n   qualquer coisa deste resultado.`,
    )
    process.exitCode = 3
  }
  // Falha não é "sem review": nada foi gravado nessas obras e elas continuam no escopo. Sair 0
  // diria que o backfill terminou — e ele não terminou.
  if (falharam > 0) {
    const porMotivo = [...motivosDaFalha].map(([m, n]) => `${m} ×${n}`).join(", ")
    console.error(
      `\n🔴 ${falharam} obra(s) com ${fonte.rotulo} FALHANDO (${porMotivo}) — isso NÃO é "sem review".` +
        `\n   Nada foi gravado nelas e elas seguem no escopo: rode de novo quando a fonte responder.`,
    )
    process.exitCode = 3
  }
  if (!APPLY && totalNovas > 0) console.log(`\n──> DRY-RUN. Rode de novo com --apply pra gravar.`)
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
