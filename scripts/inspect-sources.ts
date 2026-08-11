/**
 * Diagnóstico: quais fontes externas estão VINCULADAS a uma obra e quantas reviews
 * temos de cada. Read-only, zero LLM, zero escrita.
 *
 * Uso (ALVO: LOCAL — o `.env.analysis` é o que evita queimar egress da nuvem):
 *   npm run fontes                        # matriz global: fonte × estado de cobertura
 *   npm run fontes -- "parte do título"   # detalhe de uma obra
 *   npm run fontes -- --falta=mangago     # LISTA as obras sem vínculo dessa fonte
 *   npm run fontes -- --falta=comix:reviews  # LISTA as vinculadas com ZERO reviews
 *   npm run fontes -- --falta=mangago --csv > /tmp/x.csv
 *   npm run fontes -- --falta=comix --limit=20
 *
 * ⚠️ O retrato é do LOCAL, que é do último `db:pull` — antes de AGIR sobre uma lista,
 * confira se ela ainda vale. Este cabeçalho deliberadamente NÃO traz um comando pronto
 * apontando para a nuvem: comando de cabeçalho é a interface real do script, e um que
 * bata na nuvem seria copiado sem se perceber o egress (guardado por
 * `tests/unit/orchestration/scripts-apontam-pro-local.test.ts`, que reprovou justamente
 * essa linha quando ela existia aqui).
 *
 * 🔴 A COBERTURA TEM QUATRO ESTADOS, NÃO DOIS, e cada um pede uma AÇÃO diferente.
 * Medido em 2026-08-11 (971 obras não arquivadas): `mangago` tem 561 sem vínculo (57,8%)
 * e só 26 vinculadas sem review; `comix` é o inverso — 2 sem vínculo e 366 vinculadas sem
 * review (37,7%). Um relatório que só diga "não tem reviews" junta os dois casos e esconde
 * qual ação resolve: um pede RESOLVER O VÍNCULO, o outro pede COLETAR.
 *
 * 🔴 E "zero reviews" NÃO distingue "a fonte não tem" de "nunca tentamos" — não existe
 * `last_checked_at` em `work_external_ids`. Em vez de fingir um número só, inferimos pelo
 * `fetched_at` das OUTRAS fontes da mesma obra: se ela tem review de qualquer outra fonte,
 * a coleta rodou e ESTA não trouxe nada; se não tem review de fonte alguma, nunca foi
 * coletada. Medido nas 366 da comix: 273 coletadas-vazias × 93 nunca coletadas.
 * ⚠️ A inferência NÃO separa "vazio legítimo" de "a coleta falhou" — para isso seria
 * preciso a coluna. O relatório diz isso em vez de esconder.
 */
import { createAdminClient } from "@/lib/supabase/admin"

const ALL_SOURCES = [
  "mangaupdates", "anilist", "myanimelist", "kitsu",
  "animeplanet", "mangadex", "comick", "comix", "mangago",
]

/** ⚠️ `select` corta em 1000 linhas SEM avisar (CLAUDE.md) — toda leitura ampla pagina. */
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999)
    if (error) throw error
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

type Estado = "sem_vinculo" | "rejeitado" | "coletada_vazia" | "nunca_coletada" | "com_reviews"

const ROTULO: Record<Estado, string> = {
  sem_vinculo: "sem vínculo",
  rejeitado: "vínculo REJEITADO",
  coletada_vazia: "vinculada · coleta rodou, 0 reviews",
  nunca_coletada: "vinculada · nunca coletada",
  com_reviews: "vinculada + reviews",
}

interface Cobertura {
  workId: string
  title: string
  estado: Estado
  reviews: number
  externalId: string | null
}

/**
 * Estado de cada obra ATIVA para uma fonte. `ultimaColetaDeOutra` é o que separa
 * "coleta rodou e esta fonte não trouxe nada" de "nunca coletamos esta obra".
 */
function classificar(
  works: { id: string; title: string; is_archived: boolean | null }[],
  vinculo: Map<string, { externalId: string | null; rejeitado: boolean }>,
  reviewsDaFonte: Map<string, number>,
  ultimaColetaDeOutra: Map<string, string>,
): Cobertura[] {
  return works
    .filter((w) => !w.is_archived)
    .map((w) => {
      const v = vinculo.get(w.id)
      const reviews = reviewsDaFonte.get(w.id) ?? 0
      const base = { workId: w.id, title: w.title, reviews, externalId: v?.externalId ?? null }
      if (!v || !v.externalId) return { ...base, estado: "sem_vinculo" as const }
      if (v.rejeitado) return { ...base, estado: "rejeitado" as const }
      if (reviews > 0) return { ...base, estado: "com_reviews" as const }
      return { ...base, estado: ultimaColetaDeOutra.has(w.id) ? ("coletada_vazia" as const) : ("nunca_coletada" as const) }
    })
}

/** Carrega o que a visão de cobertura precisa: obras ativas, vínculos e reviews. */
async function carregarCobertura(sb: ReturnType<typeof createAdminClient>) {
  const works = await fetchAll<{ id: string; title: string; is_archived: boolean | null }>((f, t) =>
    sb.from("works").select("id, title, is_archived").range(f, t),
  )
  const ids = await fetchAll<{ work_id: string; source: string; external_id: string | null; is_rejected: boolean | null }>(
    (f, t) => sb.from("work_external_ids").select("work_id, source, external_id, is_rejected").range(f, t),
  )
  const revs = await fetchAll<{ work_id: string; source: string; fetched_at: string | null }>((f, t) =>
    sb.from("work_reviews").select("work_id, source, fetched_at").range(f, t),
  )
  return { works, ids, revs }
}

/** Recorta os índices por fonte. `ultimaColetaDeOutra` exclui a própria fonte de propósito. */
function indicesPara(
  fonte: string,
  ids: { work_id: string; source: string; external_id: string | null; is_rejected: boolean | null }[],
  revs: { work_id: string; source: string; fetched_at: string | null }[],
) {
  const vinculo = new Map<string, { externalId: string | null; rejeitado: boolean }>()
  for (const r of ids) {
    if (r.source !== fonte) continue
    vinculo.set(r.work_id, { externalId: r.external_id, rejeitado: r.is_rejected === true })
  }
  const reviewsDaFonte = new Map<string, number>()
  const ultimaColetaDeOutra = new Map<string, string>()
  for (const r of revs) {
    if (r.source === fonte) {
      reviewsDaFonte.set(r.work_id, (reviewsDaFonte.get(r.work_id) ?? 0) + 1)
    } else if (r.fetched_at) {
      const prev = ultimaColetaDeOutra.get(r.work_id)
      if (!prev || r.fetched_at > prev) ultimaColetaDeOutra.set(r.work_id, r.fetched_at)
    }
  }
  return { vinculo, reviewsDaFonte, ultimaColetaDeOutra }
}

/** Cobertura de UMA fonte sobre as obras ativas. Ponto único: os dois modos usam este. */
function coberturaDe(
  fonte: string,
  works: { id: string; title: string; is_archived: boolean | null }[],
  ids: { work_id: string; source: string; external_id: string | null; is_rejected: boolean | null }[],
  revs: { work_id: string; source: string; fetched_at: string | null }[],
): Cobertura[] {
  const idx = indicesPara(fonte, ids, revs)
  return classificar(works, idx.vinculo, idx.reviewsDaFonte, idx.ultimaColetaDeOutra)
}

async function main() {
  const sb = createAdminClient()
  const argv = process.argv.slice(2)
  const flags = argv.filter((a) => a.startsWith("--"))
  const title = argv.filter((a) => !a.startsWith("--")).join(" ").trim()
  const valorDe = (nome: string) => flags.find((f) => f.startsWith(`--${nome}=`))?.split("=").slice(1).join("=") ?? null
  const csv = flags.includes("--csv")
  const limite = Number(valorDe("limit")) || Infinity
  const falta = valorDe("falta")

  // ── modo LISTA: --falta=<fonte>[:reviews] ────────────────────────────────────
  if (falta) {
    const [fonte, qualificador] = falta.split(":")
    if (!ALL_SOURCES.includes(fonte)) {
      console.error(`Fonte desconhecida: "${fonte}". Conhecidas: ${ALL_SOURCES.join(", ")}`)
      process.exitCode = 1
      return
    }
    const { works, ids, revs } = await carregarCobertura(sb)
    const cobertura = coberturaDe(fonte, works, ids, revs)

    // `--falta=x` = não temos o VÍNCULO. `--falta=x:reviews` = temos o vínculo e
    // nenhuma review — problemas distintos, com ações distintas.
    const querReviews = qualificador === "reviews"
    const alvo = cobertura.filter((c) =>
      querReviews ? c.estado === "coletada_vazia" || c.estado === "nunca_coletada" : c.estado === "sem_vinculo",
    )

    if (csv) {
      console.log("work_id,titulo,estado,external_id,reviews")
      for (const c of alvo.slice(0, limite)) {
        console.log(`${c.workId},"${c.title.replace(/"/g, '""')}",${c.estado},${c.externalId ?? ""},${c.reviews}`)
      }
      return
    }

    const cabecalho = querReviews
      ? `${alvo.length} obra(s) com ${fonte} VINCULADA e ZERO reviews`
      : `${alvo.length} obra(s) SEM vínculo de ${fonte}`
    console.log(`${cabecalho}  (de ${cobertura.length} ativas)\n`)
    for (const c of alvo.slice(0, limite)) {
      const detalhe = querReviews ? `  [${ROTULO[c.estado]}]` : ""
      console.log(`  ${c.workId}  ${c.title}${detalhe}`)
    }
    if (alvo.length > limite) console.log(`\n  … e mais ${alvo.length - limite} (use --limit ou --csv)`)
    if (querReviews) {
      const vazias = alvo.filter((c) => c.estado === "coletada_vazia").length
      console.log(
        `\n  ${vazias} tiveram coleta (há review de outra fonte) e ${alvo.length - vazias} nunca foram coletadas.` +
          `\n  ⚠️ "coleta rodou, 0 reviews" NÃO separa vazio legítimo de falha na coleta — não guardamos tentativa.`,
      )
    }
    return
  }

  if (!title) {
    // ── matriz global: fonte × estado ─────────────────────────────────────────
    const { works, ids, revs } = await carregarCobertura(sb)
    const ativas = works.filter((w) => !w.is_archived).length
    console.log(`Cobertura por fonte — ${ativas} obras não arquivadas (de ${works.length})\n`)
    const col = (n: number) => `${String(n).padStart(6)}${`(${((n / ativas) * 100).toFixed(1)}%)`.padStart(10)}`
    console.log(
      `${"fonte".padEnd(14)}${"sem vínculo".padStart(16)}${"rodou, 0 rev".padStart(16)}` +
        `${"nunca coletada".padStart(16)}${"com reviews".padStart(16)}`,
    )
    for (const s of ALL_SOURCES) {
      const cobertura = coberturaDe(s, works, ids, revs)
      const conta = (e: Estado) => cobertura.filter((c) => c.estado === e).length
      console.log(
        `${s.padEnd(14)}${col(conta("sem_vinculo"))}${col(conta("coletada_vazia"))}` +
          `${col(conta("nunca_coletada"))}${col(conta("com_reviews"))}`,
      )
    }
    console.log(
      `\nPasse parte de um título pra ver o detalhe de uma obra, ou --falta=<fonte>[:reviews] pra LISTAR.` +
        `\n⚠️ "rodou, 0 rev" é inferido do fetched_at das outras fontes — não separa vazio de falha.`,
    )
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
