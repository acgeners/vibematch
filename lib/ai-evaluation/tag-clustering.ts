// AI-assisted semantic clustering of tags within a tag group.
// Used by `scripts/propose-tag-clusters.js` to populate the
// `tag_cluster_proposal` table for human review.

import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { SONNET_MODEL } from "@/lib/ai/models"

const MODEL = SONNET_MODEL

const SYSTEM_PROMPT = `You receive an alphabetically-sorted list of tag names that all belong to the same tag group (e.g. "characters", "cast", "elements"). Your task is to propose semantic clusters: groups of names that describe the same concept or highly overlapping tropes, so the database can collapse them into a single canonical tag.

Rules:
1. Each cluster MUST have ≥2 members (no singletons).
2. Do NOT merge orthogonal concepts. "blonde-protagonist" and "blonde-villain" share an attribute (hair color) but the role differs — keep them separate. Same for gender/age modifiers that change meaning.
3. \`canonical_name\` MUST be one of the existing member names — choose the most generic/representative. Do NOT invent new names.
4. \`confidence\`:
   - 0.95+ for clear paraphrases ("abused-female-lead" ↔ "abused-protagonist", same concept different wording).
   - 0.80–0.94 for strong synonyms with minor nuance differences.
   - 0.70–0.79 for defensible groupings where reasonable people might disagree.
   - Do NOT emit clusters with confidence < 0.70.
5. Tags you cannot confidently group should simply be absent from the response — leave them as-is.
6. Each member name appears in AT MOST one cluster.
7. Respond ONLY via the \`propose_clusters\` tool.

Common patterns to merge:
- Wording variants ("abandoned-protagonist" / "abandoned-mc" / "abandoned-fl").
- Singular/plural ("assassin" / "assassins").
- US/UK spellings ("colour" / "color").
- Role-equivalent synonyms ("mc" / "protagonist" / "main-character" when context is clear).

Common patterns NOT to merge:
- Different roles ("villain" vs "protagonist").
- Different genders if the existing taxonomy distinguishes them.
- Different specificity levels (don't merge "noble" with "duke" — duke is a kind of noble).
`

export const TAG_CLUSTERING_TOOL = {
  name: "propose_clusters",
  description:
    "Returns the proposed semantic clusters. Always use this tool to respond; never write free-form text outside it.",
  input_schema: {
    type: "object" as const,
    properties: {
      clusters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            canonical_name: {
              type: "string",
              description:
                "The chosen canonical name (must be one of the input member names).",
            },
            members: {
              type: "array",
              minItems: 2,
              items: { type: "string" },
              description:
                "All tag names (≥2) that belong to this cluster, including the canonical itself.",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            rationale: {
              type: "string",
              description:
                "Brief explanation of why these tags refer to the same concept.",
            },
          },
          required: ["canonical_name", "members", "confidence", "rationale"],
        },
      },
    },
    required: ["clusters"],
  },
} satisfies Anthropic.Messages.Tool

const clustersPayloadSchema = z.object({
  clusters: z.array(
    z.object({
      canonical_name: z.string().min(1),
      members: z.array(z.string().min(1)).min(2),
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
    }),
  ),
})

export type ProposedCluster = z.infer<typeof clustersPayloadSchema>["clusters"][number]

export interface ProposeOptions {
  groupSlug: string
  tagNames: string[]
  minConfidence?: number
  apiKey?: string
}

export async function proposeTagClusters(
  opts: ProposeOptions,
): Promise<{ clusters: ProposedCluster[]; totalTokens: { input: number; output: number } }> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required")
  if (opts.tagNames.length < 2) return { clusters: [], totalTokens: { input: 0, output: 0 } }

  const minConfidence = opts.minConfidence ?? 0.7

  const sorted = [...opts.tagNames].sort((a, b) => a.localeCompare(b))
  const userMessage =
    `Group: ${opts.groupSlug}\n` +
    `Total tags: ${sorted.length}\n\n` +
    `Tag names (one per line):\n` +
    sorted.join("\n")

  const client = getAnthropicClient({ apiKey, maxRetries: 6 })

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { message } = await createLoggedMessage(
        client,
        {
          model: MODEL,
          max_tokens: 8000,
          temperature: attempt === 0 ? 0.2 : 0,
          system: [
            { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
          ],
          tools: [TAG_CLUSTERING_TOOL],
          tool_choice: { type: "tool", name: TAG_CLUSTERING_TOOL.name },
          messages: [{ role: "user", content: userMessage }],
        },
        {
          operation: "tag_clustering",
          attempt,
          metadata: {
            groupSlug: opts.groupSlug,
            nTags: sorted.length,
          },
        },
      )

      const toolUse = message.content.find(
        (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
      )
      if (!toolUse) throw new Error("model returned no tool_use block")

      const parsed = clustersPayloadSchema.safeParse(toolUse.input)
      if (!parsed.success) {
        throw new Error(`tool payload validation failed: ${parsed.error.message}`)
      }

      const filtered = parsed.data.clusters.filter((c) => c.confidence >= minConfidence)
      return {
        clusters: filtered,
        totalTokens: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
        },
      }
    } catch (err) {
      lastError = err
      if (attempt === 1) break
    }
  }
  throw new Error(`proposeTagClusters failed after 2 attempts: ${String(lastError)}`)
}
