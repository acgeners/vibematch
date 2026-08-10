/**
 * Backfill da nota do MyAnimeList em `platform_ratings`.
 *
 * POR QUÊ: enquanto o Jikan (scraper de terceiros, aposentado no PR #109) esteve em 504,
 * `fetchJikanMangaById` devolvia null e a nota do MAL NÃO entrava em platform_ratings. As
 * obras hidratadas naquele período têm o VÍNCULO com o MAL, mas não a nota — e a Nota
 * Prevista delas roda sem a fonte de MAIOR PESO do catálogo (em "Solo Leveling", 371 mil
 * votos contra 121 mil do AniList).
 *
 * A correção (PR #108) vale na criação E na atualização, mas obra antiga não se cura
 * sozinha: só re-hidratando. Este script faz isso em lote.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/backfill-mal-ratings.ts
 *   ...                                                                              --apply
 *
 * Sem `--apply` é DRY-RUN: busca as notas, mostra o que gravaria, e não escreve nada.
 */
import { createClient } from "@supabase/supabase-js"

const APPLY = process.argv.includes("--apply")

// NÃO usa `fetchMalMangaById` do app de propósito. Aquele conector tem um circuito afinado
// pro uso INTERATIVO (3 falhas → abre 5min), e num lote ele entra em vaivém: o TTL expira,
// a 1ª falha reabre na hora (o contador de falhas só zera num sucesso) — e dezenas de obras
// são marcadas "não resolveu" sem nem sair da máquina. Foi o que estragou a 1ª rodada.
//
// Medido: a API oficial responde em ~250ms e aguenta chamadas sequenciais tranquilamente —
// mas LIMITA POR VOLUME (as falhas só apareceram perto da centésima obra). Daí o ritmo lento
// e o backoff longo aqui: um backfill tem necessidade diferente de uma tela.
const PAUSA_MS = 1500
const TIMEOUT_MS = 20_000
const BACKOFF_MS = [5_000, 20_000, 60_000] // se o MAL nos segurar, esperamos de verdade

/** Chamada direta à API oficial: só os 2 campos que este backfill precisa. */
async function buscarNota(malId: number): Promise<{ rating: number | null } | null> {
  const url = `https://api.myanimelist.net/v2/manga/${malId}?fields=mean,num_scoring_users`
  for (let tentativa = 0; tentativa <= BACKOFF_MS.length; tentativa++) {
    try {
      const r = await fetch(url, {
        headers: { "X-MAL-CLIENT-ID": process.env.MAL_CLIENT_ID! },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (r.status === 404) return null // a obra não existe mais no MAL
      if (r.ok) {
        const j = (await r.json()) as { mean?: number; num_scoring_users?: number }
        // `mean` ausente = existe no MAL mas ninguém votou — nada a gravar, e não é erro.
        return j.mean == null
          ? { rating: null }
          : ({ rating: j.mean, votes: j.num_scoring_users ?? 0 } as { rating: number | null })
      }
    } catch {
      // timeout/rede: cai no backoff
    }
    if (tentativa < BACKOFF_MS.length) {
      const espera = BACKOFF_MS[tentativa]
      process.stdout.write(`   (MAL segurou — esperando ${espera / 1000}s)\n`)
      await sleep(espera)
    }
  }
  return null
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const n2 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2))

interface Alvo {
  workId: string
  malId: number
  title: string
}

/** Obras COM vínculo do MAL e SEM linha de nota do MAL. */
async function acharAlvos(): Promise<Alvo[]> {
  const { data: vinculos } = await sb
    .from("work_external_ids")
    .select("work_id, external_id, works(title)")
    .eq("source", "myanimelist")
    .eq("is_rejected", false)
    .not("external_id", "is", null)

  const { data: notas } = await sb.from("platform_ratings").select("work_id").eq("platform", "myanimelist")
  const jaTem = new Set((notas ?? []).map((r) => r.work_id as string))

  return (vinculos ?? [])
    .filter((v) => !jaTem.has(v.work_id as string))
    .map((v) => ({
      workId: v.work_id as string,
      malId: Number(v.external_id),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      title: ((v as any).works?.title as string) ?? "?",
    }))
    .filter((a) => Number.isInteger(a.malId) && a.malId > 0)
}

/** expected_score de TODAS as obras — o retreino do Ridge mexe no catálogo inteiro,
 *  não só nas obras corrigidas. Sem separar os dois grupos, eu atribuiria à correção um
 *  efeito que é do retreino. */
async function snapshotNotas(): Promise<Map<string, number | null>> {
  const mapa = new Map<string, number | null>()
  let from = 0
  for (;;) {
    const { data } = await sb
      .from("calculated_scores")
      .select("work_id, expected_score")
      .range(from, from + 999)
    if (!data?.length) break
    for (const r of data) mapa.set(r.work_id as string, r.expected_score as number | null)
    if (data.length < 1000) break
    from += 1000
  }
  return mapa
}

function resumoDelta(nome: string, deltas: number[]) {
  if (deltas.length === 0) return console.log(`  ${nome}: (nenhuma obra)`)
  const abs = deltas.map(Math.abs)
  const media = abs.reduce((a, b) => a + b, 0) / abs.length
  const max = Math.max(...abs)
  const mudou = abs.filter((d) => d >= 0.01).length
  const subiu = deltas.filter((d) => d >= 0.01).length
  const desceu = deltas.filter((d) => d <= -0.01).length
  console.log(
    `  ${nome.padEnd(28)} n=${String(deltas.length).padStart(3)}  mudaram=${String(mudou).padStart(3)}  ` +
      `|Δ| médio=${media.toFixed(3)}  |Δ| máx=${max.toFixed(3)}  (↑${subiu} ↓${desceu})`
  )
}

async function main() {
  const alvos = await acharAlvos()
  console.log(`obras com MAL vinculado e SEM nota gravada: ${alvos.length}\n`)
  if (alvos.length === 0) return

  console.log(`buscando a nota de cada uma na API oficial${APPLY ? "" : "  (DRY-RUN — nada será gravado)"}…`)
  const achadas: Array<{ alvo: Alvo; rating: number; votes: number }> = []
  const semNota: Alvo[] = []
  const falhas: Alvo[] = []

  const buscar = async (lista: Alvo[], rotulo: string) => {
    for (const [i, alvo] of lista.entries()) {
      const d = (await buscarNota(alvo.malId)) as { rating: number | null; votes?: number } | null
      if (!d) falhas.push(alvo)
      else if (d.rating == null) semNota.push(alvo) // existe no MAL, mas ninguém votou
      else achadas.push({ alvo, rating: d.rating, votes: d.votes ?? 0 })
      if ((i + 1) % 25 === 0) process.stdout.write(`   ${rotulo} ${i + 1}/${lista.length}\n`)
      await sleep(PAUSA_MS)
    }
  }

  await buscar(alvos, "")

  // 2ª passada só nas falhas: separa "o MAL não tem" de "eu bati rápido demais".
  if (falhas.length > 0) {
    const paraRetentar = [...falhas]
    falhas.length = 0
    console.log(`\n  ${paraRetentar.length} falharam — 2ª passada (mais devagar)…`)
    await sleep(5000)
    await buscar(paraRetentar, "retry")
  }

  console.log(`\n  com nota:      ${achadas.length}`)
  console.log(`  sem nota:      ${semNota.length}   (existe no MAL, mas ninguém votou — nada a gravar)`)
  console.log(`  não resolveu:  ${falhas.length}`)

  if (achadas.length > 0) {
    const votos = achadas.map((a) => a.votes).sort((a, b) => b - a)
    const notas = achadas.map((a) => a.rating)
    console.log(`\n  nota média das encontradas: ${(notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(2)}`)
    console.log(`  votos: mediana ${votos[Math.floor(votos.length / 2)]}  |  máx ${votos[0]}`)
    console.log(`\n  amostra:`)
    for (const a of achadas.slice(0, 5)) {
      console.log(`    ${a.rating.toFixed(2)}  ${String(a.votes).padStart(7)} votos  "${a.alvo.title.slice(0, 44)}"`)
    }
  }

  if (!APPLY) {
    console.log(`\n──> DRY-RUN. Rode de novo com --apply pra gravar e recalcular.`)
    return
  }

  // ---- APPLY -------------------------------------------------------------
  console.log(`\n=== GRAVANDO ${achadas.length} notas ===`)
  const antes = await snapshotNotas()

  const linhas = achadas.map((a) => ({
    work_id: a.alvo.workId,
    platform: "myanimelist",
    rating: a.rating,
    vote_count: a.votes,
  }))
  for (let i = 0; i < linhas.length; i += 200) {
    const { error } = await sb.from("platform_ratings").insert(linhas.slice(i, i + 200))
    if (error) throw new Error(`insert falhou: ${error.message}`)
  }
  console.log(`  ${linhas.length} linhas inseridas em platform_ratings`)

  console.log(`\n=== RECALCULANDO (retreina o Ridge — mexe no catálogo inteiro) ===`)
  const t = Date.now()
  const { recalculateAll } = await import("../server/actions/calculations")
  await recalculateAll("headless")
  console.log(`  concluído em ${((Date.now() - t) / 1000).toFixed(1)}s`)

  const depois = await snapshotNotas()
  const corrigidas = new Set(achadas.map((a) => a.alvo.workId))
  const deltaCorrigidas: number[] = []
  const deltaResto: number[] = []

  for (const [workId, notaAntes] of antes) {
    const notaDepois = depois.get(workId)
    if (notaAntes == null || notaDepois == null) continue
    const d = notaDepois - notaAntes
    ;(corrigidas.has(workId) ? deltaCorrigidas : deltaResto).push(d)
  }

  console.log(`\n=== IMPACTO NA NOTA PREVISTA ===`)
  resumoDelta("obras CORRIGIDAS", deltaCorrigidas)
  resumoDelta("resto do catálogo", deltaResto)
  console.log(
    `\n  (o "resto" mexe porque o Ridge foi retreinado com dados novos — é o efeito colateral\n` +
      `   esperado, e é por isso que os dois grupos são medidos separados.)`
  )

  // Maiores deslocamentos entre as corrigidas — é onde a ausência do MAL mais distorcia.
  const top = achadas
    .map((a) => ({ t: a.alvo.title, d: (depois.get(a.alvo.workId) ?? 0) - (antes.get(a.alvo.workId) ?? 0) }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 8)
  if (top.length) {
    console.log(`\n  maiores deslocamentos (onde a ausência do MAL mais distorcia):`)
    for (const x of top) {
      const sinal = x.d >= 0 ? "+" : ""
      console.log(`    ${sinal}${x.d.toFixed(3)}  "${x.t.slice(0, 48)}"`)
    }
  }
  void n2
}

main()
