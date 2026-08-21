/**
 * Reaplica o piso/teto de `adult_content` (lib/ai-evaluation/adult-content-rules.ts)
 * contra as tags ATUAIS de cada obra já avaliada — sem chamar a IA de novo ($0).
 *
 * Por quê: o piso/teto só era aplicado NO MOMENTO da avaliação. Uma obra avaliada
 * antes de uma tag ganhar `adult_score_tier`, ou antes da regra existir (ex.: o teto
 * de "R15 but Based on a R19 Novel", migração 164), fica com a nota fora da faixa
 * pra sempre — não há gatilho de reavaliação quando a regra muda. Medido em
 * 2026-07-31: 15/21 obras com essa tag estão HOJE acima do teto declarado (6.0).
 *
 * Escopo desta rodada: só as tags que JÁ têm `adult_score_tier` decidido (as 53
 * migradas em 174) + a tag especial R15-based-on-R19-novel. As ~119 tags no backlog
 * de revisão (/curation/settings → "Piso de nota 18+ (tags)") NÃO entram até serem revisadas
 * — script determinístico não deve decidir por curadoria pendente.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/adult-content-retroactive-bounds.ts              # dry-run (default)
 *   ... --execute                                               # grava de verdade
 *
 * Roda contra o que `.env.local` apontar — confira NEXT_PUBLIC_SUPABASE_URL antes
 * (local por padrão neste projeto). Rode `node scripts/backup-db.mjs` antes de
 * `--execute` contra a nuvem (o banco não tem backup automático).
 */
import fs from "node:fs"
import path from "node:path"
import { createAdminClient } from "@/lib/supabase/admin"
import { podar } from "./lib/backups-retencao.mjs"
// O funil imprime ONDE os candidatos se perderam — foi a ausência dele que deixou o
// `--heal` inerte reportando "nada a gravar". Ver scripts/lib/funil.mjs.
import { criarFunil } from "./lib/funil.mjs"
import { aplicarLimiteAdulto } from "@/lib/ai-evaluation/adult-content-apply"
import {
  computeAdultContentBounds,
  clampAdultContentScore,
  EXPLICIT_FLOOR,
  ADULT_LABEL_FLOOR,
} from "@/lib/ai-evaluation/adult-content-rules"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { markRecalcPending } from "@/server/recalc/queue"

const EXECUTE = process.argv.includes("--execute")
const HEAL = process.argv.includes("--heal")
/** Os pisos que `computeAdultContentBounds` sabe produzir. Nota persistida que vale
 *  exatamente um deles é candidata a ter sido ESCRITA por um clamp, não pelo modelo. */
const FLOOR_VALUES = new Set([EXPLICIT_FLOOR, ADULT_LABEL_FLOOR, 5])
const CHUNK = 200

type Admin = ReturnType<typeof createAdminClient>

/** Embed to-one do PostgREST: hoje volta OBJETO; o client já tipou ARRAY. Aceita os dois. */
type EmbedToOne<T> = T | T[]

function umEmbed<T>(v: EmbedToOne<T> | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

async function fetchAllPaged<T>(
  fn: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fn(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function main() {
  const supabase: Admin = createAdminClient()
  console.log(`modo: ${EXECUTE ? "EXECUTE (grava)" : "dry-run (só reporta)"}${HEAL ? " + --heal (desfaz piso obsoleto)" : ""}`)
  console.log(`alvo: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

  // 1) Notas adult_content persistidas + a nota COMMITADA na avaliação de origem.
  //
  // 🔴 O baseline do clamp é a nota da AVALIAÇÃO, não a persistida. `clampAdultContentScore`
  // só empurra a nota PARA DENTRO da faixa — reaplicá-lo sobre a nota já ajustada é
  // idempotente pra piso que SOBE e inerte pra piso que DESCE. Medido em 2026-08-09: a
  // rodada de 01/08 subiu 64 obras pra 9,0 por tags de circunstância marcadas 'explicit'
  // (migration 182 corrigiu o tier); com baseline na nota persistida, nenhuma delas voltaria
  // — o script diria "nada a gravar" e o erro ficaria congelado, sem nada acusar.
  const scoreRows = await fetchAllPaged<{
    work_id: string
    score: string
    id: string
    source: string | null
    ai_evaluation_id: string | null
    /**
     * 🔴 O PostgREST devolve embed to-one como OBJETO — medido na nuvem em 2026-08-20. Este
     * tipo dizia `Array<…>` e o código fazia `?.[0]`, que em objeto é `undefined`: o baseline
     * da avaliação NUNCA era encontrado, em 373 de 392 obras com limite. O `--heal` depende
     * exatamente disso, então ele estava **inerte, reportando "nada a fazer"** — a família de
     * erro que este projeto mais paga: falha que produz resultado.
     *
     * ⚠️ O comentário que estava aqui afirmava o oposto ("manter o tipo fiel ao que volta"), o
     * que fazia a leitura do código CONFIRMAR o defeito. Aceitar as duas formas é defensivo de
     * propósito: o client já mudou essa forma entre versões, e o custo de errar é silencioso.
     */
    ai_evaluations: EmbedToOne<{
      ai_evaluation_scores: Array<{
        id: string
        criterion_slug: string
        suggested_score: string | null
        accepted_score: string | null
        justification: string | null
      }>
    }> | null
  }>(async (from, to) =>
    supabase
      .from("category_scores")
      .select(
        "id, work_id, score, source, ai_evaluation_id, ai_evaluations(ai_evaluation_scores(id, criterion_slug, suggested_score, accepted_score, justification))",
      )
      .eq("criterion_slug", "adult_content")
      // 🔴 O embed traz os NOVE critérios da avaliação. Sem este filtro, `[0]` é um
      // critério qualquer — na 1ª versão o baseline de adult_content saiu 8.0 numa obra
      // cuja avaliação dizia 7.0, porque veio de outra linha. Erro que produz resultado.
      .eq("ai_evaluations.ai_evaluation_scores.criterion_slug", "adult_content")
      .range(from, to),
  )
  const funil = criarFunil(HEAL ? "adult-content --heal" : "adult-content")
  funil.passo("com adult_content persistido", scoreRows.length)
  const workIds = scoreRows.map((r) => r.work_id)

  // 2) Títulos (só pro relatório).
  const titleById = new Map<string, string>()
  for (const c of chunk(workIds, CHUNK)) {
    const { data, error } = await supabase.from("works").select("id, title").in("id", c)
    if (error) throw new Error(error.message)
    for (const w of data ?? []) titleById.set(w.id as string, w.title as string)
  }

  // 3) Tags de cada obra (nome + grupo + adult_score_tier) — TODAS, não só
  // content_indicator (a tag R15-based-on-R19 é checada por nome fora do grupo).
  // work_tags é fan-out (uma obra pode ter dezenas de tags — Stigma Effect tem
  // 44) — um chunk de CHUNK obras passa de 1000 linhas fácil, e o corte
  // silencioso do Supabase derrubaria tags do FIM do chunk sem erro nenhum
  // (ver CLAUDE.md, "Supabase: o select corta em 1000 linhas"). Pagina cada
  // chunk até esgotar.
  const tagsByWork = new Map<string, Array<{ name: string; group: string | null; scoreTier: string | null }>>()
  for (const c of chunk(workIds, CHUNK)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("work_tags")
        .select("work_id, tags(name, tag_group_id, adult_score_tier)")
        .in("work_id", c)
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as unknown as Array<{
        work_id: string
        tags: { name: string; tag_group_id: string | null; adult_score_tier: string | null } | null
      }>) {
        if (!row.tags?.name) continue
        const list = tagsByWork.get(row.work_id) ?? []
        list.push({
          name: row.tags.name,
          group: row.tags.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[row.tags.tag_group_id] ?? null) : null,
          scoreTier: row.tags.adult_score_tier,
        })
        tagsByWork.set(row.work_id, list)
      }
      if (!data || data.length < 1000) break
    }
  }

  // 4) Gêneros (só o gênero "Adult" importa pro rótulo, mas passamos todos).
  const genresByWork = new Map<string, string[]>()
  for (const c of chunk(workIds, CHUNK)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("work_genres")
        .select("work_id, genres(name)")
        .in("work_id", c)
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as unknown as Array<{ work_id: string; genres: { name: string } | null }>) {
        if (!row.genres?.name) continue
        const list = genresByWork.get(row.work_id) ?? []
        list.push(row.genres.name)
        genresByWork.set(row.work_id, list)
      }
      if (!data || data.length < 1000) break
    }
  }

  // 5) Recalcula piso/teto com as tags de HOJE e compara com a nota persistida.
  interface Diff {
    id: string
    csId: string
    title: string
    oldScore: number
    newScore: number
    reasons: string
  }
  /**
   * 🔴 Texto que precisa ganhar a RAZÃO do limite. É uma lista SEPARADA da de notas de
   * propósito: medido em 2026-08-20, **0 das 1.010 notas estavam fora do piso/teto** e ainda
   * assim **89 fichas** exibiam uma nota movida sem dizer por quem, **7** citavam um limite
   * diferente do vigente e **81** traziam o MODELO narrando a regra — errado em 5 casos
   * conferidos. Um script que só olha número reporta "nada a fazer" sobre isso, que foi
   * exatamente o que ele fez por 10 dias.
   */
  interface DiffTexto {
    evalScoreId: string
    title: string
    nota: number
    antes: string
    depois: string
  }
  const diffs: Diff[] = []
  const diffsTexto: DiffTexto[] = []
  // 🔴 Os dois estágios do MEIO, que o relatório antigo não tinha. `comBaseline` é exatamente
  // onde o `--heal` morria: o embed to-one lido como array devolvia `undefined` em 373 de 392
  // obras, e o script terminava dizendo "nada a gravar".
  let comLimite = 0
  let elegiveisHeal = 0
  let comBaseline = 0
  for (const row of scoreRows) {
    const bounds = computeAdultContentBounds({
      tags: (tagsByWork.get(row.work_id) ?? []).map((t) => ({
        name: t.name,
        group: t.group,
        scoreTier: t.scoreTier === "label" || t.scoreTier === "explicit" ? t.scoreTier : null,
      })),
      genres: genresByWork.get(row.work_id) ?? [],
    })
    if (bounds.floor == null && bounds.ceiling == null) continue
    comLimite++
    const oldScore = Number(row.score)

    // Caminho normal: empurra a nota persistida PRA DENTRO da faixa de hoje.
    let newScore = clampAdultContentScore(oldScore, bounds)

    // Caminho `--heal`: desfaz nota que um piso ANTIGO subiu e que o piso de hoje já não
    // justifica. Necessário porque `clampAdultContentScore` é one-way — baixar um piso
    // não desfaz nada, e o erro fica congelado dizendo "nada a gravar".
    //
    // 🔴 As quatro condições são um FINGERPRINT estreito, não um resync com a avaliação.
    // A 1ª versão deste bloco simplesmente usava a nota da avaliação como baseline, e o
    // dry-run devolveu 219 diffs contra as 64 obras que eu queria curar: ele reescrevia
    // toda divergência entre `category_scores` e `ai_evaluation_scores`, inclusive ajuste
    // manual posterior que nunca voltou pra avaliação. Ampliar isto é como apagar
    // curadoria em silêncio.
    if (HEAL && newScore === oldScore) {
      elegiveisHeal++
      const evalScore = umEmbed(row.ai_evaluations)?.ai_evaluation_scores?.find(
        (x) => x.criterion_slug === "adult_content",
      )
      const committed = evalScore?.accepted_score ?? evalScore?.suggested_score
      const baseline = committed != null ? Number(committed) : null
      if (baseline != null) comBaseline++
      const healed = baseline != null ? clampAdultContentScore(baseline, bounds) : null
      if (
        baseline != null &&
        healed != null &&
        oldScore > baseline &&              // a persistida está ACIMA do que a avaliação entregou
        FLOOR_VALUES.has(oldScore) &&       // e vale EXATAMENTE um piso — assinatura de escrita do clamp
        healed < oldScore                   // e o piso de hoje já não a sustenta
      ) {
        newScore = healed
      }
    }

    /**
     * ── TEXTO ────────────────────────────────────────────────────────────────
     * O baseline aqui é a nota que a AVALIAÇÃO entregou, nunca a persistida: é ela que diz se
     * o limite chegou a agir. `aplicarLimiteAdulto` é o mesmo dono que o fluxo de avaliação
     * usa — uma segunda montagem de texto aqui seria a família "dois critérios pro mesmo
     * fato" reaparecendo pelo lado que já a produziu uma vez.
     *
     * ⚠️ Roda mesmo quando a NOTA não muda (`continue` abaixo), porque é justamente esse o
     * passivo: nota certa, explicação órfã.
     */
    const evalRow = umEmbed(row.ai_evaluations)?.ai_evaluation_scores?.find(
      (x) => x.criterion_slug === "adult_content",
    )
    const baselineTexto = evalRow?.suggested_score != null ? Number(evalRow.suggested_score) : null
    /**
     * 🔴 Nota EDITADA por humano fica de fora do texto — mesmo precedente do
     * `backfill-faixa-citada`: o realinhamento afirma *"definida pelo limite obrigatório"*, e
     * quando a curadora escolheu o número essa frase credita a máquina por uma decisão dela.
     * A ficha já diz o certo por outro caminho: a página imprime "Ajustada por você · a IA
     * sugeria X" (`app/catalog/[id]/page.tsx`).
     *
     * ⚠️ O caso não é hipotético — apareceu no primeiro dry-run: *For the Fallen of the Virgin
     * Love* tem a IA em 6,0, o piso em 7,0 e a persistida em 7,0 com `source: ai_edited`. As
     * duas causas dão o mesmo número, e por isso nenhum dado distingue quem decidiu.
     */
    const editadaPorHumano = row.source === "ai_edited"
    if (!editadaPorHumano && evalRow?.id && evalRow.justification && baselineTexto != null) {
      const r = aplicarLimiteAdulto(baselineTexto, evalRow.justification, bounds)
      if (r.justification !== evalRow.justification) {
        diffsTexto.push({
          evalScoreId: evalRow.id,
          title: titleById.get(row.work_id) ?? row.work_id,
          nota: oldScore,
          antes: evalRow.justification,
          depois: r.justification,
        })
      }
    }

    if (newScore === oldScore) continue
    diffs.push({
      id: row.work_id,
      csId: row.id,
      title: titleById.get(row.work_id) ?? row.work_id,
      oldScore,
      newScore,
      reasons: bounds.reasons.join(" "),
    })
  }

  funil.passo("com piso/teto em vigor", comLimite)
  if (HEAL) {
    funil.passo("que o clamp não move (candidatas a heal)", elegiveisHeal)
    // 🔴 `reterAoMenos` é a EXPECTATIVA declarada: a avaliação de origem existe para quase toda
    // obra com limite, então reter 5% é defeito de leitura, não do catálogo. Era o número real
    // quando o `--heal` estava inerte (19 de 392).
    funil.passo("com baseline da avaliação encontrado", comBaseline, { reterAoMenos: 0.5 })
  }
  funil.passo("com nota a mover", diffs.length)
  const funilOk = funil.relatar()
  if (!funilOk) {
    console.log("       ↑ o script esperava achar mais que isso. Confira a leitura antes de")
    console.log("         concluir que não há o que corrigir.")
  }

  console.log(`\n${diffs.length} obra(s) fora do piso/teto atual:\n`)
  for (const d of diffs.sort((a, b) => Math.abs(b.newScore - b.oldScore) - Math.abs(a.newScore - a.oldScore))) {
    const seta = d.newScore < d.oldScore ? "↓" : "↑"
    console.log(`  ${seta} ${d.oldScore.toFixed(1)} → ${d.newScore.toFixed(1)}  ${d.title}`)
    console.log(`      ${d.reasons}`)
  }

  console.log(`\n${diffsTexto.length} justificativa(s) sem a razão do limite:\n`)
  for (const d of diffsTexto.slice(0, 12)) {
    // ⚠️ Imprime o que MUDOU, não os primeiros N caracteres: a razão entra no FIM, então um
    // corte pelo começo mostra dois textos idênticos e dá a impressão de que o script é inerte.
    const faixaAntes = d.antes.match(/^\s*Faixa\s+[^:,]{0,40}/)?.[0]?.trim() ?? "(sem faixa)"
    const faixaDepois = d.depois.match(/^\s*Faixa\s+[^:,]{0,40}/)?.[0]?.trim() ?? "(sem faixa)"
    const acrescimo = d.depois.startsWith(d.antes.trimEnd())
      ? d.depois.slice(d.antes.trimEnd().length).trim()
      : (d.depois.match(/(Obra rotulada como adulta|Há cena de sexo explícito|"R15 but Based|Fonte externa classifica)[\s\S]*$/)?.[0] ?? "(prefixo realinhado)")
    console.log(`  · ${d.title} (nota ${d.nota.toFixed(1)})`)
    if (faixaAntes !== faixaDepois) console.log(`      prefixo: ${faixaAntes}  →  ${faixaDepois}`)
    console.log(`      + razão: ${acrescimo.replace(/\s+/g, " ").slice(0, 190)}`)
  }
  if (diffsTexto.length > 12) {
    // ⚠️ A lista COMPLETA de títulos sai sempre, mesmo com o detalhe cortado em 12: sem ela não
    // dá pra conferir se um caso específico entrou, e "… e mais 71" é indistinguível de
    // "o caso que me incomoda ficou de fora".
    console.log(`  … e mais ${diffsTexto.length - 12}. Lista completa:`)
    console.log(`    ${diffsTexto.map((d) => d.title).join(" · ")}`)
  }

  if (!EXECUTE) {
    console.log(`\n[dry-run] nada foi gravado. Rode com --execute pra aplicar.`)
    return
  }
  if (diffs.length === 0 && diffsTexto.length === 0) {
    funil.nadaAFazer("\nnada a gravar.")
    return
  }

  /**
   * Snapshot ANTES de escrever — o banco não tem PITR, e aqui o texto original é
   * IRRECONSTRUÍVEL: ele é a saída de um modelo que já não roda com aquele prompt, então
   * reavaliar produz outra prosa, não a mesma. A poda vem antes de gravar, como nas outras
   * famílias: execução interrompida deixa lixo igual ao de uma completa.
   */
  if (diffsTexto.length > 0) {
    podar("adult-content-razao")
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const dir = path.resolve(process.cwd(), ".backups", `adult-content-razao-${stamp}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "plano.json"), JSON.stringify(diffsTexto, null, 2))
    console.log(`estado anterior salvo em ${path.relative(process.cwd(), dir)}/plano.json`)
  }

  for (const d of diffs) {
    const { error } = await supabase.from("category_scores").update({ score: d.newScore }).eq("id", d.csId)
    if (error) console.error(`  falhou em ${d.title}: ${error.message}`)
  }
  // ⚠️ A justificativa mora em `ai_evaluation_scores`, tabela DIFERENTE da nota. Gravar as
  // duas no mesmo laço esconderia qual das duas falhou — daí os erros serem reportados com o
  // rótulo da tabela.
  for (const d of diffsTexto) {
    const { error } = await supabase
      .from("ai_evaluation_scores")
      .update({ justification: d.depois })
      .eq("id", d.evalScoreId)
    if (error) console.error(`  falhou no texto de ${d.title}: ${error.message}`)
  }
  // 🔴 Só a NOTA move o recalc. Texto não é input de cálculo nenhum (ver `recalc-inputs.ts`),
  // e marcar por causa dele acenderia o badge "Recalcular notas" para uma mudança de prosa —
  // o gate de materialidade existe exatamente contra isso.
  if (diffs.length > 0) await markRecalcPending("adult-content-retroactive-bounds")
  console.log(
    `\n✅ ${diffs.length} nota(s) ajustada(s)${diffs.length > 0 ? " (recalc pendente)" : ""} · ` +
      `${diffsTexto.length} justificativa(s) com a razão do limite.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
