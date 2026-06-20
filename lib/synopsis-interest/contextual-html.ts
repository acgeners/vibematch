/**
 * Pacote CEGO CONTEXTUAL de rotulagem (Plano 3 Fase B2.2C). PURO: gera o HTML
 * offline + o template CSV a partir do snapshot ENRIQUECIDO (`enriched-1`), e
 * valida estruturalmente a ausência de leakage. Sem banco, sem rede, sem
 * `server-only`.
 *
 * O avaliador vê, por slot: SINOPSE + ELEMENTOS DA OBRA (tags contextuais) +
 * CONTEXTO DE LEITORES (digest sanitizado ou `no_reviews_available`). NUNCA:
 * título, work_id, capa, fonte, nº de reviews, candidato, previsão, scores,
 * versões técnicas, assinaturas.
 */

import { createHash } from "node:crypto"
import type { TagContextType } from "./experiment"
import type { SanitizedDigest } from "./contextual-package"
import type { EnrichedReviewContext } from "./enriched"

export const CONTEXTUAL_LABEL_DOMAIN = ["♥", "♥♥", "♥♥♥", "♥♥♥♥"] as const

/** Rúbrica CONTEXTUAL (corrige a synopsis-only): mede a OBRA, não só a sinopse. */
export const CONTEXTUAL_RUBRIC_HTML = `
<div class="rubric">
<h2>Potencial de Interesse na Obra</h2>
<p>Avalie <strong>quanto esta obra desperta seu interesse pessoal de leitura</strong>, considerando <strong>em conjunto</strong>: a <strong>sinopse</strong>, os <strong>elementos da obra</strong> (tags) e o <strong>contexto de leitores</strong> disponível. Não é "apelo da sinopse" isolado nem qualidade literária.</p>
<table>
<tr><td><strong>♥</strong></td><td>Fraca — não me atrai / cai em elementos que evito. Pouca ou nenhuma vontade.</td></tr>
<tr><td><strong>♥♥</strong></td><td>Regular — interesse morno; sinais mistos. Na dúvida entre ♥♥ e ♥♥♥, fique em ♥♥.</td></tr>
<tr><td><strong>♥♥♥</strong></td><td>Boa — alinhamento claro com meu gosto; provavelmente testaria. Faixa padrão de uma obra que combina.</td></tr>
<tr><td><strong>♥♥♥♥</strong></td><td>Ótima — RESERVADA; alinhamento excepcional. Minoria. Na dúvida entre ♥♥♥ e ♥♥♥♥, fique em ♥♥♥.</td></tr>
</table>
<p>Seja conservador no topo. Preencha o nível no CSV pelo <span class="k">slot_key</span>. Avalie cada item de forma independente.</p>
</div>`

export const NO_REVIEWS_MESSAGE = "Nenhum contexto agregado de leitores está disponível para esta obra no snapshot atual."
export const NO_TAGS_MESSAGE = "Não há elementos categorizados disponíveis no snapshot desta obra."

export interface ContextualCard {
  slotKey: string
  shuffleOrder: number
  synopsis: string
  tagContextType: TagContextType
  contextualTags: string[]
  reviewContext: EnrichedReviewContext
  sanitizedDigest: SanitizedDigest | null
}

function esc(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}
export function contextualSha256Hex(s: string): string {
  return sha256(s)
}

const POLARITY_PT: Record<string, string> = { positive: "positivo", negative: "negativo", mixed: "misto" }

function renderElements(c: ContextualCard): string {
  if (c.tagContextType === "missing_recoverable_frozen_empty") return `<p class="muted">${esc(NO_TAGS_MESSAGE)}</p>`
  if (c.contextualTags.length === 0) return `<p class="muted">—</p>`
  return `<div class="tags">${c.contextualTags.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</div>`
}

function renderContext(c: ContextualCard): string {
  if (c.reviewContext === "no_reviews_available" || !c.sanitizedDigest) return `<p class="muted">${esc(NO_REVIEWS_MESSAGE)}</p>`
  const d = c.sanitizedDigest
  const parts: string[] = []
  if (d.consensus.trim()) parts.push(`<p><strong>Consenso:</strong> ${esc(d.consensus)}</p>`)
  if (d.divergence.trim()) parts.push(`<p><strong>Divergências:</strong> ${esc(d.divergence)}</p>`)
  if (d.traits.length > 0) {
    parts.push(`<p><strong>Traços recorrentes:</strong></p><ul>${d.traits.map((t) => `<li>${esc(t.trait)} <span class="pol">(${esc(POLARITY_PT[t.polarity] ?? t.polarity)})</span></li>`).join("")}</ul>`)
  }
  if (d.execution.trim()) parts.push(`<p><strong>Execução:</strong> ${esc(d.execution)}</p>`)
  if (d.contentWarnings.length > 0) parts.push(`<p><strong>Avisos:</strong> ${d.contentWarnings.map(esc).join("; ")}</p>`)
  return parts.join("\n")
}

export function buildContextualHtml(
  cards: ContextualCard[],
  meta: { experimentVersion: string; goldenVersion: string; enrichedVersion: string },
): string {
  const ordered = [...cards].sort((a, b) => a.shuffleOrder - b.shuffleOrder)
  const cardHtml = ordered
    .map(
      (c) => `<div class="card">
<div class="slot">${esc(c.slotKey)}</div>
<section><h3>SINOPSE</h3><div class="syn" data-syn>${esc(c.synopsis || "(sem sinopse)")}</div></section>
<section><h3>ELEMENTOS DA OBRA</h3><div class="elem" data-elem>${renderElements(c)}</div></section>
<section><h3>CONTEXTO DE LEITORES</h3><div class="ctx" data-ctx>${renderContext(c)}</div></section>
</div>`,
    )
    .join("\n")
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Rotulagem contextual — ${esc(meta.goldenVersion)}/${esc(meta.enrichedVersion)}</title>
<style>
body{font:15px/1.6 system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;color:#111}
.rubric{border:1px solid #bbb;border-radius:8px;padding:1rem;margin-bottom:1.5rem;background:#fafafa}
.rubric table{border-collapse:collapse;margin:.5rem 0}.rubric td{border:1px solid #ddd;padding:.3rem .6rem;vertical-align:top}
.card{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
.slot{font-weight:700;font-family:monospace;color:#555;margin-bottom:.5rem}
section{margin:.6rem 0}h3{font-size:.8rem;letter-spacing:.05em;color:#666;margin:.2rem 0;text-transform:uppercase}
.syn{white-space:pre-wrap}.muted{color:#888}.tags{display:flex;flex-wrap:wrap;gap:.3rem}
.tag{background:#eef;border:1px solid #ccd;border-radius:999px;padding:.05rem .55rem;font-size:.85rem}
.pol{color:#777;font-size:.85rem}ul{margin:.3rem 0 .3rem 1.2rem}.k{font-family:monospace;background:#eee;padding:0 .3em;border-radius:3px}
h1{font-size:1.15rem}h2{font-size:1rem}
</style></head><body>
<h1>Golden contextual — rotulagem cega</h1>
${CONTEXTUAL_RUBRIC_HTML}
${cardHtml}
</body></html>
`
}

export function buildContextualLabelsTemplateCsv(cards: ContextualCard[]): string {
  const ordered = [...cards].sort((a, b) => a.shuffleOrder - b.shuffleOrder)
  return ["slot_key,label", ...ordered.map((c) => `${c.slotKey},`)].join("\n") + "\n"
}

// ── Validação estrutural offline / anti-leakage ──────────────────────────────

const FORBIDDEN_SHELL: Array<{ re: RegExp; label: string }> = [
  { re: /https?:\/\//i, label: "URL externa" },
  { re: /<script/i, label: "<script>" },
  { re: /\ssrc\s*=/i, label: "atributo src" },
  { re: /<link/i, label: "<link>" },
  { re: /<iframe/i, label: "<iframe>" },
  { re: /@import/i, label: "@import" },
  { re: /url\(\s*['"]?\s*https?:/i, label: "url(http…)" },
  { re: /\son[a-z]+\s*=/i, label: "handler inline" },
  { re: /fetch\s*\(/i, label: "fetch(" },
  { re: /XMLHttpRequest/i, label: "XMLHttpRequest" },
  { re: /WebSocket/i, label: "WebSocket" },
  { re: /\b(candidate|prediction|alignment|personal_fit|review_digest_version|prompt_version|taste_profile)\b/i, label: "token técnico/output" },
]

/** Remove as regiões de conteúdo (sinopse/elementos/contexto) para evitar falsos
 * positivos do texto. Mantém só o "shell" estrutural + a rúbrica. */
function stripContentRegions(html: string): string {
  return html
    .replace(/<div class="syn" data-syn>[\s\S]*?<\/div>/g, '<div class="syn"></div>')
    .replace(/<div class="elem" data-elem>[\s\S]*?<\/div>\n<\/section>/g, '<div class="elem"></div>\n</section>')
    .replace(/<div class="ctx" data-ctx>[\s\S]*?<\/div>\n<\/div>/g, '<div class="ctx"></div>\n</div>')
}

export interface ContextualOfflineValidation { ok: boolean; issues: string[] }

export function assertContextualHtmlOffline(html: string, opts: { workIds: string[] }): ContextualOfflineValidation {
  const issues: string[] = []
  const shell = stripContentRegions(html)
  for (const { re, label } of FORBIDDEN_SHELL) if (re.test(shell)) issues.push(`shell contém ${label}`)
  for (const id of opts.workIds) if (id && html.includes(id)) issues.push(`work_id vazado: ${id}`)
  return { ok: issues.length === 0, issues }
}

export interface ContextualPackageSignatureInput {
  experimentVersion: string
  goldenVersion: string
  enrichedSnapshotVersion: string
  contextualPackageVersion: string
  enrichedSnapshotSignature: string
  sanitizedDigestCorpusSignature: string
  slotKeys: string[]
  contextualHtmlSha256: string
  contextualLabelsTemplateSha256: string
}

export function computeContextualPackageSignature(input: ContextualPackageSignatureInput): string {
  return sha256(
    JSON.stringify({
      experimentVersion: input.experimentVersion,
      goldenVersion: input.goldenVersion,
      enrichedSnapshotVersion: input.enrichedSnapshotVersion,
      contextualPackageVersion: input.contextualPackageVersion,
      enrichedSnapshotSignature: input.enrichedSnapshotSignature,
      sanitizedDigestCorpusSignature: input.sanitizedDigestCorpusSignature,
      slotKeys: [...input.slotKeys].sort(),
      contextualHtmlSha256: input.contextualHtmlSha256,
      contextualLabelsTemplateSha256: input.contextualLabelsTemplateSha256,
    }),
  )
}
