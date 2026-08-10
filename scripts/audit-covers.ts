/**
 * Audita a capa PRIMÁRIA de cada obra contra as alternativas disponíveis.
 *
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/audit-covers.ts
 *   ... scripts/audit-covers.ts --fix-broken      # troca só as primárias MORTAS
 *   ... scripts/audit-covers.ts --fix-all         # troca também as que têm alternativa melhor
 *
 * Contexto: `rankCoversByMeasuredQuality` (lib/external/index.ts) já ordena as capas por qualidade
 * MEDIDA na criação da obra — mas as 881 obras que já existiam mantiveram a primária escolhida
 * pela ordem antiga por FONTE, que a medição provou estar praticamente invertida (acertava a
 * melhor capa em só 32% das obras com 2+ capas). Este script é o backfill que faltava.
 *
 * Três categorias que é fácil confundir, e que aqui ficam separadas:
 *   MORTA        — a URL não responde (404/timeout). A obra mostra imagem quebrada no app.
 *   NÃO-MEDIDA   — respondeu, mas não deu pra medir (host fora da allowlist, formato exótico).
 *                  NÃO é defeito: é falta de informação. Nunca troco uma primária por causa disso.
 *   PIOR         — medida, e existe outra capa medida com score maior.
 *
 * Só a 1ª e a 3ª justificam troca. Tratar "não-medida" como defeito faria o backfill trocar capas
 * boas por capas que eu simplesmente não consegui olhar.
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { measureCover, scoreCover } from "@/lib/server/covers/measure-cover"

const fixBroken = process.argv.includes("--fix-broken")
const fixAll = process.argv.includes("--fix-all")

/**
 * `--apply=<workId,workId,…>` — troca a primária SÓ nas obras listadas.
 *
 * É a saída de `scripts/review-covers.ts`: o score sabe medir resolução, compressão e proporção,
 * mas NÃO sabe distinguir uma capa de um painel interno. No "Young Lady's Knight" ele propunha
 * trocar a capa (230×341) por um painel com texto coreano cravado (771×1080) — maior em tudo que
 * ele mede, e pior como capa. Não há fórmula pra isso; a decisão é do olho.
 *
 * Então o caminho de aplicação em lote (--fix-all) existe, mas o recomendado é revisar na página e
 * aplicar só o aprovado.
 */
const applyArg = process.argv.find((a) => a.startsWith("--apply="))
const applyIds = new Set(
  applyArg
    ? applyArg
        .slice("--apply=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [],
)

async function main() {
  const sb = createAdminClient()

  // PAGINA: work_covers tem 2.343 linhas e o select corta em 1000 sem avisar.
  type Row = { id: string; work_id: string; url: string; source: string; is_primary: boolean }
  const covers: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("work_covers")
      .select("id, work_id, url, source, is_primary")
      .order("id")
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    covers.push(...(data as Row[]))
    if (data.length < 1000) break
  }

  const { count: exact } = await sb.from("work_covers").select("*", { count: "exact", head: true })
  if (covers.length !== exact) {
    throw new Error(`paginação truncou: ${covers.length} lidas, ${exact} no banco`)
  }

  const { data: works } = await sb.from("works").select("id, title")
  const titleOf = new Map((works ?? []).map((w) => [w.id as string, w.title as string]))

  console.log(`\nmedindo ${covers.length} capas de ${titleOf.size} obras…\n`)

  // Mede em lotes — é um GET com Range de 32KB por capa, sem IA e sem custo em dólar.
  type Scored = Row & { score: number; width?: number; height?: number; dead: boolean }
  const scored: Scored[] = []
  const BATCH = 24
  for (let i = 0; i < covers.length; i += BATCH) {
    const slice = covers.slice(i, i + BATCH)
    const measured = await Promise.all(
      slice.map(async (c) => {
        let m = null
        let dead = false
        try {
          m = await measureCover(c.url)
        } catch {
          m = null
        }
        if (!m) {
          // Não-medida ≠ morta. Confirma com um GET curto antes de acusar.
          try {
            const res = await fetch(c.url, { method: "GET", headers: { Range: "bytes=0-0" } })
            dead = !res.ok && res.status !== 416 // 416 = servidor não aceita Range, mas existe
          } catch {
            dead = true
          }
        }
        return { ...c, score: m ? scoreCover(m) : -1, width: m?.width, height: m?.height, dead }
      }),
    )
    scored.push(...measured)
    process.stdout.write(`\r  ${Math.min(i + BATCH, covers.length)}/${covers.length}`)
  }
  console.log("\n")

  const byWork = new Map<string, Scored[]>()
  for (const c of scored) {
    const list = byWork.get(c.work_id) ?? []
    list.push(c)
    byWork.set(c.work_id, list)
  }

  const quebradas: Array<{ work: string; atual: Scored; melhor: Scored | null }> = []
  const piores: Array<{ work: string; atual: Scored; melhor: Scored; ganho: number }> = []
  let naoMedidas = 0
  let semAlternativa = 0

  for (const [workId, list] of byWork) {
    const atual = list.find((c) => c.is_primary)
    if (!atual) continue
    const title = titleOf.get(workId) ?? workId.slice(0, 8)

    const medidas = list.filter((c) => c.score >= 0)
    const melhor = medidas.length ? medidas.reduce((a, b) => (b.score > a.score ? b : a)) : null

    if (atual.dead) {
      quebradas.push({ work: title, atual, melhor: melhor && melhor.id !== atual.id ? melhor : null })
      continue
    }
    if (atual.score < 0) {
      naoMedidas++ // não-medida e viva: deixo em paz
      continue
    }
    if (!melhor || melhor.id === atual.id) {
      semAlternativa++
      continue
    }
    const ganho = melhor.score - atual.score
    if (ganho > 0) piores.push({ work: title, atual, melhor, ganho })
  }

  const px = (c: Scored) => (c.width ? `${c.width}×${c.height}` : "?")

  console.log("═".repeat(78))
  console.log(`  🔴 primárias MORTAS (imagem quebrada no app): ${quebradas.length}`)
  console.log(`  ⚠️  primárias com alternativa MELHOR:          ${piores.length}`)
  console.log(`  ·  primárias já são a melhor:                 ${semAlternativa}`)
  console.log(`  ·  primárias vivas mas não-mensuráveis:       ${naoMedidas}  (não conto como defeito)`)
  console.log("═".repeat(78))

  if (quebradas.length) {
    console.log("\n🔴 MORTAS:\n")
    for (const q of quebradas) {
      console.log(`  ${q.work}`)
      console.log(`     atual : [${q.atual.source}] ${q.atual.url.slice(0, 62)} — MORTA`)
      console.log(
        q.melhor
          ? `     troca : [${q.melhor.source}] ${px(q.melhor)}  score ${q.melhor.score.toFixed(2)}`
          : `     troca : ❌ NENHUMA alternativa viva — a obra fica SEM capa`,
      )
    }
  }

  if (piores.length) {
    // O ganho importa: trocar 0.98 → 0.99 é ruído. Separo por materialidade.
    const materiais = piores.filter((p) => p.ganho >= 0.15).sort((a, b) => b.ganho - a.ganho)
    const marginais = piores.filter((p) => p.ganho < 0.15)
    console.log(`\n⚠️  ALTERNATIVA MELHOR — ${materiais.length} materiais (ganho ≥ 0,15) · ${marginais.length} marginais\n`)
    for (const p of materiais.slice(0, 15)) {
      console.log(
        `  +${p.ganho.toFixed(2)}  ${p.work.slice(0, 40).padEnd(42)}` +
          `[${p.atual.source}] ${px(p.atual)} → [${p.melhor.source}] ${px(p.melhor)}`,
      )
    }
    if (materiais.length > 15) console.log(`  … e mais ${materiais.length - 15}`)
  }

  // 🔴 TRAVA. Achei um viés sistemático que fazia o score pedir a troca de 2850×4096 por
  // 700×950 — com plena confiança. Não presumo que era o único. Qualquer troca que DIMINUA
  // a capa é suspeita por padrão e sai listada pra revisão humana, nunca aplicada em lote.
  //
  // Exceção única: capa em PAISAGEM (mais larga que alta) não é capa — é banner. Aí a troca
  // está certa por definição, e o tamanho não importa. É o caso de "His Majesty Is Mine",
  // cuja primária é 720×330. Nenhuma outra exceção: as demais 9 suspeitas são proporção no
  // limite (3524×4532 leva multiplicador 0,6 por ficar 1,4% abaixo do corte de 1,30) ou WebP
  // raspando o limiar — falso positivo, e a trava existe justamente pra segurá-las.
  const ehBanner = (c: Scored) => c.width != null && c.height != null && c.height < c.width
  const downgrades = piores.filter(
    (p) =>
      p.ganho >= 0.15 &&
      p.atual.width &&
      p.melhor.width &&
      p.melhor.width < p.atual.width &&
      !ehBanner(p.atual),
  )
  if (downgrades.length) {
    console.log(`\n🔴 ${downgrades.length} troca(s) DIMINUEM a capa — suspeitas, NÃO serão aplicadas:\n`)
    for (const d of downgrades) {
      console.log(`  ${d.work.slice(0, 40).padEnd(42)}[${d.atual.source}] ${px(d.atual)} → [${d.melhor.source}] ${px(d.melhor)}`)
    }
  } else {
    console.log("\n✅ nenhuma troca proposta diminui a capa.")
  }

  if (!fixBroken && !fixAll && applyIds.size === 0) {
    console.log("\n(auditoria — nada foi alterado.)")
    console.log("  --fix-broken       só as primárias MORTAS")
    console.log("  --apply=<ids>      só as obras aprovadas na revisão visual  ← recomendado")
    console.log("  --fix-all          todas as materiais (o score NÃO distingue capa de painel)\n")
    process.exit(0)
  }

  const selecionadas = piores
    .filter((p) => !downgrades.includes(p)) // a trava anti-downgrade vale SEMPRE
    .filter((p) =>
      applyIds.size > 0
        ? applyIds.has(p.atual.work_id) // revisão visual: só o que o humano aprovou
        : fixAll && p.ganho >= 0.15,
    )

  const alvos = [
    ...(fixBroken || fixAll
      ? quebradas.filter((q) => q.melhor).map((q) => ({ atual: q.atual, novo: q.melhor! }))
      : []),
    ...selecionadas.map((p) => ({ atual: p.atual, novo: p.melhor })),
  ]

  if (applyIds.size > 0) {
    const naoAchadas = [...applyIds].filter((id) => !selecionadas.some((p) => p.atual.work_id === id))
    if (naoAchadas.length) {
      console.log(`\n⚠️  ${naoAchadas.length} id(s) da lista não têm troca pendente (já aplicada? travada?)`)
    }
  }

  console.log(`\naplicando ${alvos.length} troca(s) de capa primária…`)
  for (const { atual, novo } of alvos) {
    await sb.from("work_covers").update({ is_primary: false }).eq("id", atual.id)
    await sb.from("work_covers").update({ is_primary: true }).eq("id", novo.id)
  }
  console.log(`✅ ${alvos.length} obra(s) com capa primária trocada.\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
