/**
 * Resolve em LOTE o slug do Mangago das obras que ainda não têm vínculo.
 *
 * POR QUÊ: 555 obras (56,7% das ativas) não têm o Mangago vinculado, e ele é a fonte
 * com mais reviews por obra do acervo (~23,5). O resolvedor existe desde 2026-07-06
 * (`resolveMangagoUrlProd`) e roda no caminho de AVALIAÇÃO — ou seja, cobre obra nova e
 * reavaliação, nunca o passivo. Este script é o passivo.
 *
 * MEDIDO antes de escrever (2026-08-11, 6 obras sem vínculo): **6/6 em banda AUTO**,
 * score 1,00, ~1,1s cada. As 555 devem levar ~11min.
 *
 * CUSTO DE IA: ZERO — o resolvedor é matching de título (busca no Mangago + score),
 * sem nenhuma chamada de LLM.
 *
 * ⚠️ EXIGE o FlareSolverr de pé (`docker start flaresolverr`): o Mangago é
 * Cloudflare-gated e NÃO tem sidecar — o FlareSolverr é a única via. Sem ele o script
 * roda inteiro e resolve ZERO; o resumo denuncia isso em vez de deixar passar.
 *
 * 🔴 O DRY-RUN ORDENA POR MARGEM CRESCENTE, e não é estética. A banda AUTO exige
 * score ≥0,90 E margem ≥0,08 — o falso positivo mora justamente na margem baixa, com
 * título curto/genérico. Medido: "Zenith" resolveu com score 1,00 e margem 0,22 para
 * um slug que não se parece com o título. Ordenar pelo risco deixa você varrer a
 * CABEÇA da lista em vez das 555 linhas.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA. Rodá-lo contra o local, que é réplica
 *    descartável, joga o trabalho fora no próximo `db:pull`.
 *   npm run mangago:slugs                 # dry-run, ordenado por margem crescente
 *   npm run mangago:slugs -- --limit=30
 *   npm run mangago:slugs -- --apply      # ~11 min
 */
import { createClient } from "@supabase/supabase-js"
import { resolveMangagoUrlProd } from "../lib/external/mangago-resolve-prod"
import { persistMangagoSlug } from "../lib/external/mangago-persist"
import { exigeAlvoNuvem } from "./lib/exige-alvo-nuvem"

const APPLY = process.argv.includes("--apply")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null
const LIMITE = Number(arg("limit")) || Infinity
const PAUSA_MS = 400 // o resolve já leva ~1,1s; a pausa é polidez com o origin

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** ⚠️ `select` corta em 1000 linhas SEM avisar (CLAUDE.md). */
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

interface Achado {
  workId: string
  title: string
  slug: string
  score: number
  margin: number
  band: string
  matchedCandidateTitle: string
}

async function main() {
  // Gravar no local perde o trabalho no próximo `db:pull` — e quem copia o comando do
  // cabeçalho não passa pelo npm script. Custo aqui não é dinheiro (IA zero), são os
  // ~11 min de resolução jogados fora sem nada avisar.
  if (APPLY) exigeAlvoNuvem("npm run mangago:slugs -- --apply")

  const works = (await paginar<{
    id: string
    title: string
    original_title: string | null
    is_archived: boolean | null
  }>("works", "id, title, original_title, is_archived")).filter((w) => !w.is_archived)
  const ids = await paginar<{ work_id: string; source: string; external_id: string | null; is_rejected: boolean | null }>(
    "work_external_ids",
    "work_id, source, external_id, is_rejected",
  )

  // Rejeitada NÃO entra: alguém já decidiu que essa obra não é a do Mangago.
  const jaTem = new Set(
    ids.filter((r) => r.source === "mangago" && (r.external_id || r.is_rejected === true)).map((r) => r.work_id),
  )
  const alvos = works.filter((w) => !jaTem.has(w.id)).slice(0, LIMITE)

  console.log(`obras sem vínculo do Mangago: ${works.filter((w) => !jaTem.has(w.id)).length}  (processando ${alvos.length})`)
  console.log(APPLY ? "  (APPLY — vai gravar na NUVEM)\n" : "  (DRY-RUN — nada será gravado)\n")
  if (!alvos.length) return

  const achados: Achado[] = []
  let semCandidato = 0
  let naoAuto = 0

  for (const w of alvos) {
    let r: Awaited<ReturnType<typeof resolveMangagoUrlProd>> = null
    try {
      r = await resolveMangagoUrlProd({ title: w.title })
    } catch {
      /* fail-soft: conta como sem candidato */
    }
    if (!r) {
      semCandidato += 1
    } else if (r.band !== "auto") {
      // `review` volta resultado mas NÃO é confiável o bastante para persistir sozinho.
      naoAuto += 1
    } else {
      achados.push({
        workId: w.id,
        title: w.title,
        slug: r.slug,
        score: r.score,
        margin: r.margin,
        band: r.band,
        matchedCandidateTitle: r.matchedCandidateTitle,
      })
    }
    await sleep(PAUSA_MS)
  }

  // 🔴 MENOR MARGEM PRIMEIRO: é onde mora o falso positivo (título curto/genérico
  // casando com o slug errado). Você varre a cabeça da lista, não as 555 linhas.
  achados.sort((a, b) => a.margin - b.margin || a.score - b.score)

  console.log(`  ${"margem".padStart(7)} ${"score".padStart(6)}  obra → slug casado`)
  for (const a of achados) {
    const alerta = a.margin < 0.25 ? " ⚠️" : ""
    // O TÍTULO QUE CASOU resolve o susto na própria linha. O slug do Mangago costuma ser
    // o nome do SCANLATION, não da obra: "Zenith" → `janice_simp_scans` parece erro grave
    // e é match perfeito por alt-title (a obra lá se chama "Janice", com "Zenith" entre os
    // títulos alternativos). Sem isto impresso, conferir exige abrir o site — foi o que
    // tive de fazer, e é justamente o atrito que faz ninguém conferir.
    const casou = a.matchedCandidateTitle && a.matchedCandidateTitle !== a.title ? `  [casou: "${a.matchedCandidateTitle.slice(0, 34)}"]` : ""
    console.log(
      `  ${a.margin.toFixed(2).padStart(7)} ${a.score.toFixed(2).padStart(6)}  ` +
        `"${a.title.slice(0, 38)}" → ${a.slug.slice(0, 40)}${casou}${alerta}`,
    )
  }

  if (APPLY) {
    let gravados = 0
    for (const a of achados) {
      const res = await persistMangagoSlug({ supabase: sb, workId: a.workId, slug: a.slug })
      if (res) gravados += 1
    }
    console.log(`\n  slugs GRAVADOS: ${gravados}`)
  }

  console.log(`\n  resolvidos em banda AUTO: ${achados.length}`)
  console.log(`  banda review/reject:      ${naoAuto}   (não persistem — exigem decisão humana)`)
  console.log(`  sem candidato no Mangago: ${semCandidato}`)
  const baixaMargem = achados.filter((a) => a.margin < 0.25).length
  if (baixaMargem) console.log(`  ⚠️ ${baixaMargem} com margem <0,25 (marcados acima) — confira antes do --apply`)
  console.log(`  custo de IA: US$ 0,00  (matching de título, sem LLM)`)

  // 🔴 Zero resolvido em TODAS é o fingerprint de "o FlareSolverr está fora", não de
  // "o Mangago não tem essas obras" — a mesma falha silenciosa que deixou a Comix
  // cega por 13 dias e o resolvedor de hid reportando "sem match".
  if (achados.length === 0 && alvos.length >= 5) {
    console.error(
      `\n🔴 NENHUMA das ${alvos.length} obras resolveu. Isso quase nunca é o Mangago não tê-las:` +
        `\n   confira se o FlareSolverr está de pé (docker start flaresolverr) antes de concluir` +
        `\n   qualquer coisa deste resultado.`,
    )
    process.exitCode = 3
  }
  if (!APPLY && achados.length) console.log(`\n──> DRY-RUN. Rode de novo com --apply pra gravar.`)
}

main()
