import "server-only"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { ACTIVE_MODELS } from "@/lib/ai/models"
import { providerDetailOf, providerOutcomeOf } from "@/lib/tags/enrichment-status"
import type { ProviderOutcome } from "@/lib/tags/enrichment-status"

const MODEL = ACTIVE_MODELS.haiku

export interface EnrichInputTag {
  name: string
  slug: string
}

/** Nível de indicação de conteúdo sexual adulto da tag (decide o FLAG works.is_adult). */
export type AdultLevel = "none" | "label" | "explicit"

/**
 * Piso de `category_scores.adult_content` implicado pela tag (decide a NOTA, eixo
 * independente do flag). Ver lib/ai-evaluation/adult-content-rules.ts: uma tag pode
 * ser forte o bastante pra marcar a obra como 18+ (adultLevel="explicit", ex.
 * "BDSM", "Big Breasts") sem AFIRMAR que uma cena sexual é mostrada — nesse caso
 * scoreTier fica null. Só vira 'explicit'/'label' quando a tag nomeia um ato/rótulo
 * que garante a nota mínima; na dúvida, null (conservador — o modelo continua livre
 * pra pontuar alto pela evidência, só não é OBRIGADO).
 */
export type AdultScoreTier = "none" | "label" | "explicit"

export interface EnrichResult {
  /** slug of an approved sub-group of the group, or null if none fits. */
  subgroupSlug: string | null
  /** slug of an existing tag this one is a near-synonym of, or null. */
  synonymOfSlug: string | null
  /** 0–1. `null` = o modelo não mandou um número válido (vai como NULL, nunca como 0 inventado). */
  confidence: number | null
  /**
   * 18+: "explicit" = nomeia/afirma conteúdo sexual EXPLÍCITO mostrado (ato,
   * anatomia, pornográfico) → adult_indicator + strong. "label" = rótulo de
   * conteúdo adulto sem afirmar cena (Adult, R19, Erotica) → só adult_indicator.
   * "none" = não é indicador sexual (inclui violência/gore/tema maduro).
   */
  adultLevel: AdultLevel
  /** Ver AdultScoreTier acima. */
  adultScoreTier: AdultScoreTier
}

export interface EnrichTagsForGroupInput {
  groupSlug: string
  groupName: string
  newTags: EnrichInputTag[]
  approvedSubgroups: Array<{ slug: string; name: string; description: string | null }>
  existingTags: EnrichInputTag[]
}

interface RawClassification {
  tag_name: string
  subgroup_slug?: string | null
  synonym_of_slug?: string | null
  confidence?: number | null
  adult_level?: string | null
  adult_score_tier?: string | null
}

const ENRICH_TOOL = {
  name: "enrich_tags",
  description: "Atribui sub-grupo e detecta sinônimos para cada tag nova.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tag_name: { type: "string" },
            subgroup_slug: { type: "string", description: "slug de um sub-grupo da lista, ou \"none\"." },
            synonym_of_slug: { type: "string", description: "slug de uma tag existente da qual esta é sinônimo claro, ou \"none\"." },
            confidence: { type: "number", description: "0–1, confiança no sinônimo (use a do sub-grupo se não houver sinônimo)." },
            adult_level: {
              type: "string",
              enum: ["none", "label", "explicit"],
              description: "18+: \"explicit\" = conteúdo sexual explícito mostrado (ato/anatomia/pornô); \"label\" = rótulo adulto sem afirmar cena (adult/r19/erotica/smut); \"none\" = não sexual (violência/gore/tema maduro incluídos).",
            },
            adult_score_tier: {
              type: "string",
              enum: ["none", "label", "explicit"],
              description: "Piso de NOTA que a tag GARANTE (eixo separado de adult_level — ver system prompt). Use \"none\" sempre que houver a menor dúvida.",
            },
          },
          required: ["tag_name", "subgroup_slug", "synonym_of_slug", "confidence", "adult_level", "adult_score_tier"],
        },
      },
    },
    required: ["results"],
  },
}

/**
 * 🔴 Aviso de abuso/violência sexual NÃO é 18+ (decisão de produto de 2026-10-09). Até aqui o
 * item 4 dizia que "Rape" e "Pedophilia" "podem ser fortes o bastante pra marcar a obra 18+
 * (adult_level=explicit)" — o oposto do item 3 —, e as tags de estupro criadas de fonte em
 * 2026-07-27 saíram `adult_indicator_strong`, ligando o gate sozinhas. Exportada pra o teste
 * conferir o TEXTO que o modelo recebe.
 */
export function buildSystemPrompt(input: EnrichTagsForGroupInput): string {
  const subSection = input.approvedSubgroups.length
    ? input.approvedSubgroups
        .map((s) => `- ${s.slug}: ${s.name}${s.description ? ` — ${s.description}` : ""}`)
        .join("\n")
    : "(este grupo não tem sub-grupos — use \"none\" em subgroup_slug)"

  const existingSection = input.existingTags.length
    ? input.existingTags.map((t) => `- ${t.slug}: ${t.name}`).join("\n")
    : "(nenhuma tag existente — use \"none\" em synonym_of_slug)"

  return `Você enriquece tags novas de um grupo de tags de obras (mangás/manhwas/webtoons/novels). Para cada tag nova você faz QUATRO coisas:

1. SUB-GRUPO: escolha o slug do sub-grupo (da lista abaixo) que melhor descreve a tag, usando as descrições como fonte de verdade. Se nenhum encaixa bem, use "none".
2. SINÔNIMO: diga se a tag é um SINÔNIMO CLARO de alguma tag JÁ EXISTENTE do grupo (mesmo conceito, redação diferente — ex.: "abandoned-fl" ↔ "abandoned-protagonist"). Se for, retorne o slug da tag existente em synonym_of_slug; senão "none". NÃO marque como sinônimo tags que apenas compartilham um atributo mas têm significado diferente (ex.: "blonde-protagonist" vs "blonde-villain").
3. 18+ (adult_level): a tag indica conteúdo SEXUAL adulto? Decide se a obra é marcada 18+ (works.is_adult).
   - "explicit": nomeia ou afirma conteúdo sexual EXPLÍCITO mostrado — ato sexual, anatomia genital, pornográfico (ex.: "Oral Sex", "Smut", "Hentai", "Pornographic").
   - "label": rótulo de conteúdo adulto sem afirmar que uma cena é mostrada (ex.: "Adult", "R19", "Sexual Content", "Erotica").
   - "none": NÃO é indicador sexual. Isto inclui violência, gore, tortura, temas maduros/sombrios, e fatos de enredo ("Sexually Active Protagonist") — retratar violência sexual ou ter sexo na história NÃO é ser sexualmente explícito. Inclui SEMPRE os avisos de abuso, violência sexual, não-consentimento e pedofilia (ex.: "Rape", "Gang Rape", "Rape as a Start of Relationship", "Sexual Assault", "Pedophilia", "Non-Consensual Relationship", "Drugging/Roofing"): eles descrevem um TEMA — muitas vezes backstory, trauma, abuso mencionado ou evento não mostrado — e não provam que a obra mostre sexo explícito. Na dúvida, use "none" (conservador).
4. PISO DE NOTA (adult_score_tier): eixo SEPARADO de adult_level — decide o piso mínimo obrigatório da NOTA numérica "conteúdo adulto" (0-10) desta obra, não se ela é marcada 18+.
   - "explicit": a tag NOMEIA um ato ou posição sexual específica RETRATADA (ex.: "Oral Sex", "Cunnilingus", "Handjob") — só quando a tag é específica o bastante que ninguém a usaria numa cena cortada/fade-to-black. Rótulos que AFIRMAM pornografia (Smut/Hentai/Pornographic) também entram aqui.
   - "label": rótulo de FAIXA ADULTA que não afirma cena mostrada (ex.: "Adult", "R19", "Sexual Content", "Erotica") — pode ser adulta por violência, não necessariamente sexo.
   - "none": USE PARA TUDO O RESTO, mesmo se adult_level="explicit" acima. Em especial: atributos/anatomia (ex.: "Big Breasts", "Big Penis"), dinâmicas/temas (ex.: "BDSM", "Netorare", "Incest") e fatos de enredo (ex.: "Sexually Active Protagonist") — todos podem ser fortes o bastante pra marcar a obra 18+ (adult_level="explicit") SEM afirmar que uma cena sexual é efetivamente MOSTRADA na obra. Avisos de conteúdo (ex.: "Rape", "Pedophilia", "Gore", "Sexual Harassment") também são "none" aqui — e são "none" em adult_level (item 3): são aviso de tema sensível, não 18+. Retratar uma dinâmica ou tema não é o mesmo que mostrar o ato. NA MENOR DÚVIDA, use "none" — um falso positivo aqui força a nota pra cima incorretamente.

confidence (0–1): confiança no SINÔNIMO quando houver; sem sinônimo, a confiança da escolha do sub-grupo.

Grupo: ${input.groupName} (${input.groupSlug})

Sub-grupos aprovados:
${subSection}

Tags já existentes no grupo (alvos possíveis de sinônimo):
${existingSection}

Regras: responda SEMPRE chamando a tool enrich_tags, com uma entrada por tag nova. Use apenas slugs das listas acima (ou "none").`
}

export interface EnrichTagsForGroupResult {
  /**
   * Nome → resultado, SÓ para as tags sobre as quais o modelo respondeu com um item VÁLIDO e
   * COMPLETO. Tag ausente = o modelo não decidiu nada sobre ela.
   *
   * 🔴 Até a migration 210 este mapa vinha pré-preenchido com um resultado NEUTRO para toda tag
   * (sem subgrupo, `adult_level=none`, `adult_score_tier=none`) e era devolvido assim também quando
   * a chamada nem acontecia — sem chave, guard de proveniência, erro do provider. O neutro era
   * indistinguível de uma decisão, e `enrichNewTags` gravava a marca de revisão em cima dele.
   *
   * 🔴 E até 2026-10-13 o mesmo acontecia CAMPO A CAMPO numa resposta que chegou: `adult_level`
   * fora do enum ou ausente virava "none", subgrupo inexistente virava "nenhum subgrupo", e um item
   * cortado por `max_tokens` (o `partialParse` do SDK descarta a string incompleta) também. Hoje
   * esses itens vão para `invalid`, com o motivo, e a tag não é dada como classificada.
   */
  results: Map<string, EnrichResult>
  /** Nome → por que o item desta tag foi recusado (inválido, incompleto ou truncado). */
  invalid: Map<string, string>
  outcome: ProviderOutcome
  detail: string | null
}

const ADULT_ENUM = ["none", "label", "explicit"] as const

/**
 * Valida UM item da resposta. Os três campos que viram decisão gravada — subgrupo, `adult_level` e
 * `adult_score_tier` — precisam vir presentes e dentro do contrato; ausência ou valor inválido NÃO
 * se converte em "none". Sinônimo e confiança são tolerantes de propósito: nenhum dos dois grava uma
 * decisão negativa (sinônimo inválido = nenhuma proposta; confiança inválida = NULL).
 */
function validateItem(
  r: RawClassification,
  subSlugs: Set<string>,
  existingSlugs: Set<string>,
): { ok: true; result: EnrichResult } | { ok: false; reason: string } {
  const sub = r.subgroup_slug
  if (typeof sub !== "string" || sub.trim() === "") return { ok: false, reason: "campo ausente: subgroup_slug" }
  if (sub !== "none" && !subSlugs.has(sub)) {
    return { ok: false, reason: `subgrupo inválido: "${sub}" não é um subgrupo aprovado do grupo` }
  }
  for (const field of ["adult_level", "adult_score_tier"] as const) {
    const v = r[field]
    if (v === undefined || v === null || v === "") return { ok: false, reason: `campo ausente: ${field}` }
    if (!(ADULT_ENUM as readonly string[]).includes(v)) {
      return { ok: false, reason: `valor fora do contrato: ${field}="${String(v)}"` }
    }
  }
  const synonymOfSlug = r.synonym_of_slug && existingSlugs.has(r.synonym_of_slug) ? r.synonym_of_slug : null
  const confidence =
    typeof r.confidence === "number" && Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 1
      ? r.confidence
      : null
  return {
    ok: true,
    result: {
      subgroupSlug: sub === "none" ? null : sub,
      synonymOfSlug,
      confidence,
      adultLevel: r.adult_level as AdultLevel,
      adultScoreTier: r.adult_score_tier as AdultScoreTier,
    },
  }
}

export async function enrichTagsForGroup(
  input: EnrichTagsForGroupInput,
): Promise<EnrichTagsForGroupResult> {
  const results = new Map<string, EnrichResult>()
  const invalid = new Map<string, string>()
  if (input.newTags.length === 0) return { results, invalid, outcome: "ok", detail: null }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { results, invalid, outcome: "provider_not_called", detail: "ANTHROPIC_API_KEY ausente" }
  }

  const subSlugs = new Set(input.approvedSubgroups.map((s) => s.slug))
  const existingSlugs = new Set(input.existingTags.map((t) => t.slug))
  const asked = new Set(input.newTags.map((t) => t.name))

  let raw: unknown = []
  let truncated = false
  try {
    const client = getAnthropicClient({ maxRetries: 4 })
    const { message } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: "text", text: buildSystemPrompt(input), cache_control: { type: "ephemeral" } }],
        tools: [ENRICH_TOOL],
        tool_choice: { type: "tool", name: ENRICH_TOOL.name },
        messages: [
          {
            role: "user",
            content: `Enriqueça as tags novas:\n\n${input.newTags.map((t) => `- ${t.name}`).join("\n")}`,
          },
        ],
      },
      { operation: "tag_enricher", metadata: { groupSlug: input.groupSlug, nTags: input.newTags.length } },
    )
    const toolUse = message.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    )
    const payload = toolUse?.input as { results?: unknown } | undefined
    raw = payload?.results ?? []
    truncated = message.stop_reason === "max_tokens"
  } catch (error) {
    const outcome = providerOutcomeOf(error)
    console.error(`[tag-enricher] ${outcome}: nenhuma tag enriquecida`, error)
    return { results, invalid, outcome, detail: providerDetailOf(error) }
  }

  if (!Array.isArray(raw)) {
    // A chamada voltou, mas sem a lista: nenhuma tag tem resposta utilizável.
    for (const name of asked) invalid.set(name, "resposta inválida: `results` não é uma lista")
    return { results, invalid, outcome: "ok", detail: null }
  }

  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") return // sem tag_name não há a quem atribuir: vira "omitida"
    const r = item as RawClassification
    if (typeof r.tag_name !== "string" || !asked.has(r.tag_name)) return
    // `max_tokens`: os itens ANTERIORES foram fechados (o modelo já emitiu o seguinte); o ÚLTIMO pode
    // ter sido cortado em qualquer campo, e o parser parcial do SDK o devolve "completo" sem o resto.
    if (truncated && i === raw.length - 1) {
      results.delete(r.tag_name)
      invalid.set(r.tag_name, "resposta truncada (max_tokens): o item desta tag pode estar incompleto")
      return
    }
    const v = validateItem(r, subSlugs, existingSlugs)
    if (!v.ok) {
      results.delete(r.tag_name)
      invalid.set(r.tag_name, v.reason)
      return
    }
    // Item duplicado com um inválido antes: a resposta sobre esta tag não é confiável.
    if (!invalid.has(r.tag_name)) results.set(r.tag_name, v.result)
  })
  return { results, invalid, outcome: "ok", detail: null }
}
