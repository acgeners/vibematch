/**
 * Pacote CEGO de rotulagem (Plano 3 Fase B2.1C). PURO: gera o HTML offline + o
 * template CSV a partir do SNAPSHOT-BASE (nunca de dados live), e valida
 * estruturalmente a ausência de leakage. Sem banco, sem rede, sem `server-only`.
 *
 * O avaliador vê SOMENTE `slot_key` + a sinopse canônica congelada. Slots
 * repetidos (mesma obra) mostram conteúdo idêntico, SEM marca de repetição.
 */

import { createHash } from "node:crypto"

export const LABEL_DOMAIN = ["♥", "♥♥", "♥♥♥", "♥♥♥♥"] as const

export interface BlindSlot {
  slotKey: string
  /** Sinopse canônica congelada (vinda do snapshot-base). */
  synopsis: string
  /** Ordem de apresentação congelada. */
  shuffleOrder: number
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

/**
 * HTML 100% offline: sem `<script>`, sem recursos externos, sem work_id/outputs.
 * Estilo inline mínimo. A sinopse vai escapada dentro de `.syn` (região marcada
 * `data-syn`, usada pelo validador para ignorar falsos positivos do texto).
 */
export function buildBlindHtml(slots: BlindSlot[], meta: { experimentVersion: string; goldenVersion: string; snapshotVersion: string }): string {
  const ordered = [...slots].sort((a, b) => a.shuffleOrder - b.shuffleOrder)
  const cards = ordered
    .map(
      (s) =>
        `<div class="card"><div class="slot">${escapeHtml(s.slotKey)}</div><div class="syn" data-syn>${escapeHtml(
          s.synopsis || "(sem sinopse)",
        )}</div></div>`,
    )
    .join("\n")
  // Sem charset via <meta http-equiv> que aponte rede; charset utf-8 é local.
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Rotulagem cega — ${escapeHtml(meta.goldenVersion)}/${escapeHtml(meta.snapshotVersion)}</title>
<style>
body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#111}
.card{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
.slot{font-weight:700;font-family:monospace;color:#555}
.syn{margin-top:.5rem;white-space:pre-wrap}
h1{font-size:1.1rem}.k{font-family:monospace;background:#f0f0f0;padding:0 .3em;border-radius:3px}
</style></head><body>
<h1>Interesse na Sinopse — rotulagem cega</h1>
<p>Leia cada sinopse e escolha o nível (rúbrica em RUBRIC.md). Preencha no CSV pelo <span class="k">slot_key</span>. Níveis: <span class="k">♥</span> / <span class="k">♥♥</span> / <span class="k">♥♥♥</span> / <span class="k">♥♥♥♥</span>. Avalie cada item de forma independente.</p>
${cards}
</body></html>
`
}

/** Template CSV vazio (slot_key,label). Determinístico na ordem de apresentação. */
export function buildLabelsTemplateCsv(slots: BlindSlot[]): string {
  const ordered = [...slots].sort((a, b) => a.shuffleOrder - b.shuffleOrder)
  return ["slot_key,label", ...ordered.map((s) => `${s.slotKey},`)].join("\n") + "\n"
}

// ── Validação estrutural de offline / anti-leakage ───────────────────────────

const FORBIDDEN_SHELL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /https?:\/\//i, label: "URL externa (http/https)" },
  { re: /<script/i, label: "<script>" },
  { re: /\ssrc\s*=/i, label: "atributo src" },
  { re: /<link/i, label: "<link>" },
  { re: /<iframe/i, label: "<iframe>" },
  { re: /@import/i, label: "@import" },
  { re: /url\(\s*['"]?\s*https?:/i, label: "url(http…)" },
  { re: /\son[a-z]+\s*=/i, label: "handler inline on*=" },
  { re: /fetch\s*\(/i, label: "fetch(" },
  { re: /XMLHttpRequest/i, label: "XMLHttpRequest" },
  { re: /WebSocket/i, label: "WebSocket" },
  { re: /\b(candidate|prediction|alignment|personal_fit|expected_score|calc_score|review_digest)\b/i, label: "token de output proibido" },
]

/** Remove as regiões de sinopse (`.syn` com `data-syn`) p/ evitar falso positivo do texto. */
function stripSynopsisRegions(html: string): string {
  return html.replace(/<div class="syn" data-syn>[\s\S]*?<\/div>/g, '<div class="syn"></div>')
}

export interface OfflineValidation {
  ok: boolean
  issues: string[]
}

/**
 * Valida ESTRUTURALMENTE (não pelo texto da sinopse) que o HTML é offline e sem
 * leakage. Recebe os `workIds` p/ garantir que nenhum aparece no HTML inteiro.
 */
export function assertBlindHtmlOffline(html: string, opts: { workIds: string[] }): OfflineValidation {
  const issues: string[] = []
  const shell = stripSynopsisRegions(html)
  for (const { re, label } of FORBIDDEN_SHELL_PATTERNS) {
    if (re.test(shell)) issues.push(`shell contém ${label}`)
  }
  // work_id em QUALQUER lugar do HTML (inclui regiões de sinopse — UUID nunca deve vazar).
  for (const id of opts.workIds) {
    if (id && html.includes(id)) issues.push(`work_id vazado: ${id}`)
  }
  return { ok: issues.length === 0, issues }
}

// ── Assinaturas do pacote ─────────────────────────────────────────────────────

export function sha256Hex(s: string): string {
  return sha256(s)
}

export interface LabelingPackageSignatureInput {
  experimentVersion: string
  goldenVersion: string
  snapshotVersion: string
  snapshotBaseSignature: string
  slotKeys: string[]
  blindHtmlSha256: string
  labelsTemplateSha256: string
}

export function computeLabelingPackageSignature(input: LabelingPackageSignatureInput): string {
  return sha256(
    JSON.stringify({
      experimentVersion: input.experimentVersion,
      goldenVersion: input.goldenVersion,
      snapshotVersion: input.snapshotVersion,
      snapshotBaseSignature: input.snapshotBaseSignature,
      slotKeys: [...input.slotKeys].sort(),
      blindHtmlSha256: input.blindHtmlSha256,
      labelsTemplateSha256: input.labelsTemplateSha256,
    }),
  )
}
