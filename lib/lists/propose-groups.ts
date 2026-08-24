import "server-only"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { ACTIVE_MODELS } from "@/lib/ai/models"

// ────────────────────────────────────────────────────────────────────────────
// Curadoria por IA: lê TODOS os favoritos do usuário (balde plano) e propõe até
// N grupos temáticos coesos — cada um com nome, descrição e o subconjunto de
// obras que faz sentido junto. É a entrada do fluxo de CRIAÇÃO de grupos
// (/favorites), NÃO opera sobre grupos existentes. Uma chamada Haiku (barata),
// tool forçada. Ver [[project_favorites_groups_feature]].
// ────────────────────────────────────────────────────────────────────────────

const MODEL = ACTIVE_MODELS.haiku

/** Uma obra favorita, já enxuta pro prompt (posição = índice 1-based na lista). */
export interface FavoriteWork {
  id: string
  title: string
  genres: string[]
  tags: string[]
}

/** Um grupo proposto pela IA, já resolvido pra IDs reais. */
export interface ProposedGroup {
  name: string
  description: string
  workIds: string[]
}

const PROPOSE_TOOL = {
  name: "propose_groups",
  description:
    "Propõe grupos temáticos coesos a partir da lista numerada de obras favoritas do usuário.",
  input_schema: {
    type: "object" as const,
    properties: {
      groups: {
        type: "array",
        description: "Os grupos propostos, do mais coeso pro menos coeso.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Nome curto e evocativo do grupo em pt-BR (idealmente ≤ 40 caracteres). Sem aspas.",
            },
            description: {
              type: "string",
              description:
                "1–2 frases em pt-BR dizendo o que une as obras do grupo. No máximo 300 caracteres.",
            },
            work_numbers: {
              type: "array",
              items: { type: "integer" },
              description:
                "Números (1-based) das obras da lista que compõem este grupo. Ao menos 2.",
            },
          },
          required: ["name", "description", "work_numbers"],
        },
      },
    },
    required: ["groups"],
  },
}

function buildSystemPrompt(n: number): string {
  return `Você é um curador que organiza os FAVORITOS de um leitor (manhwa, manhua, webtoon, light novel) em grupos temáticos.
Receberá uma lista NUMERADA de obras (título, gêneros, tags). Proponha ATÉ ${n} grupo(s) coeso(s).

Regras:
- Cada grupo reúne obras que compartilham um fio condutor claro — tema, tom, gênero ou "vibe" (ex.: "Vilãs que dominam", "Romantasy sombria", "Slice of life aconchegante").
- Um grupo precisa de PELO MENOS 2 obras. Prefira grupos coesos a grupos grandes: é melhor deixar uma obra de fora do que forçá-la num grupo onde não combina.
- Uma obra PODE aparecer em mais de um grupo se fizer sentido em ambos; obras sem tema em comum podem ficar fora de todos.
- Se só houver temas para MENOS de ${n} grupos coesos, proponha menos — não invente agrupamentos fracos só pra bater o número.
- name: rótulo curto e específico em pt-BR (evite genérico como "Meus favoritos"). description: 1–2 frases em pt-BR.
- Refira as obras SEMPRE pelos números (work_numbers) da lista fornecida.

Responda SEMPRE chamando a tool propose_groups.`
}

function buildUserContent(works: FavoriteWork[]): string {
  const lines = works.map((w, i) => {
    const parts: string[] = [`${i + 1}. ${w.title}`]
    if (w.genres.length) parts.push(`gêneros: ${w.genres.join(", ")}`)
    if (w.tags.length) parts.push(`tags: ${w.tags.join(", ")}`)
    return parts.join(" — ")
  })
  return `Favoritos do usuário (${works.length} obras):\n\n${lines.join("\n")}`
}

interface RawGroup {
  name?: unknown
  description?: unknown
  work_numbers?: unknown
}

/**
 * Propõe até `n` grupos a partir dos favoritos. Resolve os `work_numbers` de
 * volta pros IDs reais (1-based → índice), descarta números fora da faixa e
 * grupos com menos de 2 obras válidas. Retorna [] quando não há chave de API ou
 * o modelo não devolveu nada aproveitável (o caller trata como erro amigável).
 */
export async function proposeFavoriteGroups(
  works: FavoriteWork[],
  n: number,
): Promise<ProposedGroup[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[propose-groups] ANTHROPIC_API_KEY ausente; pulando")
    return []
  }
  if (works.length < 2) return []
  const target = Math.min(4, Math.max(1, Math.round(n)))

  const client = getAnthropicClient({ maxRetries: 6 })
  const { message } = await createLoggedMessage(
    client,
    {
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: buildSystemPrompt(target), cache_control: { type: "ephemeral" } }],
      tools: [PROPOSE_TOOL],
      tool_choice: { type: "tool", name: PROPOSE_TOOL.name },
      messages: [{ role: "user", content: buildUserContent(works) }],
    },
    { operation: "suggest_groups", metadata: { nWorks: works.length, nTarget: target } },
  )

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  )
  const rawGroups = (toolUse?.input as { groups?: RawGroup[] })?.groups ?? []

  const out: ProposedGroup[] = []
  for (const g of rawGroups) {
    const name = typeof g.name === "string" ? g.name.trim().slice(0, 80) : ""
    const description = typeof g.description === "string" ? g.description.trim().slice(0, 500) : ""
    const nums = Array.isArray(g.work_numbers) ? g.work_numbers : []
    const ids: string[] = []
    const seen = new Set<string>()
    for (const raw of nums) {
      const idx = Math.trunc(Number(raw)) - 1 // 1-based → 0-based
      if (!Number.isFinite(idx) || idx < 0 || idx >= works.length) continue
      const id = works[idx].id
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    if (!name || ids.length < 2) continue // grupo sem nome ou < 2 obras válidas → descarta
    out.push({ name, description, workIds: ids })
  }

  return out.slice(0, target)
}
