/**
 * 2ª opinião de conteúdo 18+ nas obras de SINAL FRACO (fila de auditoria da mig 161).
 *
 * A classificação graduada (migração 161) só marca 18+ automaticamente quando o
 * sinal é forte (tag sexualmente explícita, ou tag genérica + nota IA ≥ 7). O que
 * sobra — obra com só tag genérica ("Adult"/"Sexual Content"…) ou só nota alta sem
 * tag — fica `is_adult=false` e cai AQUI: um modelo forte (Sonnet) dá o veredito.
 *
 * Grava direto (autorizado), MONOTÔNICO (só sobe, nunca desmarca) e idempotente:
 *   adult=true            → adult_auto=true, adult_reason='ai_review'
 *   adult=false + confiante→ adult_reason='ai_review_clean'  (segue is_adult=false)
 *   incerto (low conf)    → adult_reason='ai_review_uncertain' (fica pra humano)
 * Obras já com reason 'ai_review*' são puladas (re-rodar não re-chama a IA).
 * O override humano vence tudo e nunca é tocado aqui.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/ai-review-adult-uncertain.ts [--dry-run] [--limit N]
 *   --dry-run : lista a fila e NÃO chama a IA nem grava (read-only)
 *   --limit N : processa no máximo N obras
 */
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@supabase/supabase-js"
import { SONNET_MODEL, modelRejectsSampling } from "@/lib/ai/models"

const CI_GROUP = "90edf1bb-a80e-459e-b421-ebca4e493128" // content_indicator

const DRY = process.argv.includes("--dry-run")
const RESET = process.argv.includes("--reset") // limpa veredictos ai_review* antes (p/ reprocessar)
const limitArg = process.argv.indexOf("--limit")
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function all<T = Record<string, unknown>>(
  table: string,
  select: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mod?: (q: any) => any,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb.from(table).select(select).range(from, from + 999)
    if (mod) q = mod(q)
    const { data, error } = await q
    if (error) throw error
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

const VERDICT_TOOL: Anthropic.Tool = {
  name: "verdict",
  description: "Registra se a obra tem conteúdo sexual explícito (18+).",
  input_schema: {
    type: "object",
    properties: {
      adult: {
        type: "boolean",
        description: "true se a obra retrata cenas sexuais EXPLÍCITAS/pornográficas na própria obra.",
      },
      evidence: {
        type: "string",
        enum: ["reviews_explicit", "synopsis_explicit", "suggestive_only", "none"],
        description:
          "ONDE está a prova: reviews descrevem sexo; sinopse descreve; apenas insinuação/título/tag genérica; ou nada.",
      },
      confidence: { type: "string", enum: ["high", "low"] },
      reason: { type: "string", description: "Justificativa curta em PT (≤ 200 caracteres)." },
    },
    required: ["adult", "evidence", "confidence", "reason"],
  },
}

const SYSTEM =
  "Você classifica se uma obra (manhwa/manga/webtoon) é 18+ — ou seja, se retrata cenas " +
  "sexuais EXPLÍCITAS/pornográficas NA PRÓPRIA OBRA. NÃO conte como 18+: apenas temas " +
  "maduros, violência/gore, abuso citado sem cena explícita, ou romance apenas sugestivo. " +
  "As REVIEWS de leitores são o sinal mais confiável: se descrevem cenas de sexo/smut, é 18+; " +
  "se descrevem romance leve/fofo sem sexo, não é. A sinopse raramente confirma sozinha. " +
  "REGRA DURA: só marque adult=true com EVIDÊNCIA POSITIVA de cena explícita (evidence=" +
  "reviews_explicit ou synopsis_explicit). Título 'hot', premissa 'erótica', ou tag genérica " +
  "são evidence=suggestive_only e NÃO bastam pra 18+ — nesse caso adult=false. " +
  "Marque confidence=high só quando a evidência for inequívoca; senão confidence=low."

interface Verdict {
  adult: boolean
  evidence: "reviews_explicit" | "synopsis_explicit" | "suggestive_only" | "none"
  confidence: "high" | "low"
  reason: string
}

async function main() {
  // --- monta a fila (sinal fraco, não resolvido) ---
  const ciTags = await all<{ id: string; name: string; adult_indicator: boolean }>(
    "tags",
    "id,name,adult_indicator",
    (q) => q.eq("tag_group_id", CI_GROUP),
  )
  const adultTagIds = new Set(ciTags.filter((t) => t.adult_indicator).map((t) => t.id))
  const nameById = new Map(ciTags.map((t) => [t.id, t.name]))

  const wt = await all<{ work_id: string; tag_id: string }>("work_tags", "work_id,tag_id")
  const adultTagsByWork = new Map<string, string[]>()
  for (const r of wt) {
    if (!adultTagIds.has(r.tag_id)) continue
    if (!adultTagsByWork.has(r.work_id)) adultTagsByWork.set(r.work_id, [])
    adultTagsByWork.get(r.work_id)!.push(nameById.get(r.tag_id)!)
  }

  const cs = await all<{ work_id: string; score: number }>(
    "category_scores",
    "work_id,score",
    (q) => q.eq("criterion_slug", "adult_content"),
  )
  const scoreByWork = new Map(cs.map((r) => [r.work_id, r.score]))

  // --reset: desfaz veredictos anteriores da IA (adult_auto/reason) p/ reprocessar
  // com insumo melhor. Só toca linhas 'ai_review*' e sem override humano.
  if (RESET && !DRY) {
    const { error, count } = await sb
      .from("works")
      .update({ adult_auto: false, adult_reason: null }, { count: "exact" })
      .like("adult_reason", "ai_review%")
      .is("adult_override", null)
    if (error) throw error
    console.log(`[--reset] ${count ?? 0} veredictos ai_review* limpos.`)
  }

  const works = await all<{
    id: string
    title: string
    is_adult: boolean
    adult_override: boolean | null
    adult_reason: string | null
  }>("works", "id,title,is_adult,adult_override,adult_reason")

  const queue = works.filter((w) => {
    if (w.is_adult) return false // já é 18+ (auto forte)
    if (w.adult_override !== null) return false // decisão humana existe
    if (w.adult_reason?.startsWith("ai_review")) return false // já revisado pela IA
    const hasWeakTag = (adultTagsByWork.get(w.id)?.length ?? 0) > 0
    const hasScore = (scoreByWork.get(w.id) ?? 0) >= 7
    return hasWeakTag || hasScore // sinal fraco presente
  })

  console.log(`Fila de auditoria (sinal fraco não resolvido): ${queue.length} obras`)
  if (DRY) {
    for (const w of queue.slice(0, Number.isFinite(LIMIT) ? LIMIT : queue.length)) {
      const tags = adultTagsByWork.get(w.id) ?? []
      const sc = scoreByWork.get(w.id)
      console.log(`  · ${w.title}  {tags: ${tags.join(", ") || "—"}; nota: ${sc ?? "—"}}`)
    }
    console.log(`\n[dry-run] nada foi chamado nem gravado.`)
    return
  }

  // sinopses primárias só das obras da fila
  const ids = queue.map((w) => w.id)
  const syn = ids.length
    ? await all<{ work_id: string; text: string; is_primary: boolean }>(
        "work_synopses",
        "work_id,text,is_primary",
        (q) => q.in("work_id", ids),
      )
    : []
  const synByWork = new Map<string, string>()
  for (const s of syn) {
    if (!synByWork.has(s.work_id) || s.is_primary) synByWork.set(s.work_id, s.text)
  }

  // reviews (o sinal decisivo): as mais longas primeiro, até 6 por obra.
  const reviews = ids.length
    ? await all<{ work_id: string; text: string; source: string; text_length: number }>(
        "work_reviews",
        "work_id,text,source,text_length",
        (q) => q.in("work_id", ids),
      )
    : []
  const revByWork = new Map<string, string[]>()
  for (const r of reviews.sort((a, b) => (b.text_length ?? 0) - (a.text_length ?? 0))) {
    const arr = revByWork.get(r.work_id) ?? []
    if (arr.length < 6 && r.text) arr.push(`[${r.source}] ${r.text.slice(0, 400)}`)
    revByWork.set(r.work_id, arr)
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 })
  let nAdult = 0
  let nClean = 0
  let nUncertain = 0
  let inTok = 0
  let outTok = 0

  const toProcess = queue.slice(0, Number.isFinite(LIMIT) ? LIMIT : queue.length)
  for (let i = 0; i < toProcess.length; i++) {
    const w = toProcess[i]
    const tags = adultTagsByWork.get(w.id) ?? []
    let verdict: Verdict
    try {
      const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
        model: SONNET_MODEL,
        max_tokens: 400,
        system: SYSTEM,
        tools: [VERDICT_TOOL],
        tool_choice: { type: "tool", name: "verdict" },
        messages: [
          {
            role: "user",
            content: [
              `Título: ${w.title}`,
              scoreByWork.get(w.id) != null
                ? `Nota "conteúdo adulto" da IA (0-10): ${scoreByWork.get(w.id)}`
                : `Nota "conteúdo adulto": ausente`,
              tags.length ? `Tags de conteúdo presentes: ${tags.join(", ")}` : `Tags de conteúdo: nenhuma`,
              ``,
              `Sinopse:`,
              (synByWork.get(w.id) ?? "(sem sinopse)").slice(0, 1500),
              ``,
              `Reviews de leitores (sinal mais confiável):`,
              (revByWork.get(w.id) ?? []).join("\n---\n") || "(sem reviews)",
              ``,
              `Esta obra tem conteúdo sexual explícito (18+)?`,
            ].join("\n"),
          },
        ],
      }
      if (modelRejectsSampling(SONNET_MODEL)) params.thinking = { type: "disabled" }
      else params.temperature = 0

      const msg = await client.messages.create(params)
      inTok += msg.usage.input_tokens
      outTok += msg.usage.output_tokens
      const tool = msg.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined
      if (!tool) throw new Error("sem tool_use")
      verdict = tool.input as Verdict
    } catch (err) {
      console.warn(`  ⚠️ ${w.title}: falhou (${err instanceof Error ? err.message : err}) — pulando`)
      continue
    }

    // decisão + escrita — CONSERVADORA: só esconde com EVIDÊNCIA explícita (reviews
    // ou sinopse descrevendo cena). Insinuação/premissa não escondem — viram 'uncertain'
    // (decisão humana). Assim não some romance à toa. Não-18+ confiante = limpo.
    const explicit =
      verdict.evidence === "reviews_explicit" || verdict.evidence === "synopsis_explicit"
    let patch: { adult_auto: boolean; adult_reason: string }
    if (verdict.adult && explicit) {
      patch = { adult_auto: true, adult_reason: "ai_review" }
      nAdult++
    } else if (!verdict.adult && verdict.confidence === "high") {
      patch = { adult_auto: false, adult_reason: "ai_review_clean" }
      nClean++
    } else {
      patch = { adult_auto: false, adult_reason: "ai_review_uncertain" }
      nUncertain++
    }

    const { error } = await sb.from("works").update(patch).eq("id", w.id)
    if (error) {
      console.warn(`  ⚠️ ${w.title}: update falhou (${error.message})`)
      continue
    }
    const mark =
      patch.adult_reason === "ai_review" ? "🔞 18+" : patch.adult_reason === "ai_review_clean" ? "limpo" : "incerto"
    console.log(
      `  [${i + 1}/${toProcess.length}] ${mark.padEnd(6)} ${w.title} — [${verdict.evidence}] ${verdict.reason}`,
    )
  }

  // custo estimado (Sonnet-5 promo $2/$10 por MTok; ver lib/ai/models.ts)
  const costUsd = (inTok / 1e6) * 2 + (outTok / 1e6) * 10
  console.log(
    `\n=== resumo ===\n18+: ${nAdult} · limpo: ${nClean} · incerto: ${nUncertain}` +
      `\ntokens in/out: ${inTok}/${outTok} · custo estimado: ~US$${costUsd.toFixed(3)}` +
      `\n(NÃO logado em ai_api_calls — script direto; is_adult recalcula sozinho pelo generated column)`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
