/**
 * Export para rotulagem CEGA da golden sample (Plano 3 Fase B).
 *
 * READ-ONLY (busca só a sinopse canônica das obras da fixture). NÃO chama
 * provider. Gera, na ordem embaralhada:
 *   - labeling-sheet.pilot-1.html  → leitura confortável (slot opaco + SINOPSE)
 *   - labeling-sheet.pilot-1.csv   → preencher (slot_key,label) — SEM a sinopse,
 *                                     parsing trivial na importação.
 *
 * Esconde TUDO menos a sinopse: sem previsão, candidato, user_score, scores,
 * ranking, tags, capa, dados externos, título, work_id, estrato.
 *
 * Uso: npx tsx --env-file=.env.local scripts/synopsis-interest-export.ts
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

interface Slot { slotKey: string; workId: string; shuffleOrder: number }

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

async function main() {
  const dir = resolve(process.cwd(), "lib/synopsis-interest")
  const fixture = JSON.parse(readFileSync(resolve(dir, "golden-sample.pilot-1.json"), "utf8")) as { sample_version: string; slots: Slot[] }
  const slots = [...fixture.slots].sort((a, b) => a.shuffleOrder - b.shuffleOrder)

  // Busca SOMENTE a sinopse canônica (read-only).
  const ids = [...new Set(slots.map((s) => s.workId))]
  const synByWork = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("works").select("id, canonical_synopsis").in("id", ids.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const w of data ?? []) synByWork.set((w as { id: string }).id, (w as { canonical_synopsis: string | null }).canonical_synopsis ?? "")
  }

  // HTML (leitura) — só slot opaco + sinopse.
  const cards = slots.map((s) => {
    const syn = synByWork.get(s.workId) ?? "(sem sinopse)"
    return `<div class="card"><div class="slot">${esc(s.slotKey)}</div><div class="syn">${esc(syn)}</div></div>`
  }).join("\n")
  const html = `<!doctype html><meta charset="utf-8"><title>Rotulagem cega — ${fixture.sample_version}</title>
<style>body{font:15px/1.5 system-ui;max-width:760px;margin:2rem auto;padding:0 1rem}.card{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}.slot{font-weight:700;font-family:monospace;color:#555}.syn{margin-top:.5rem;white-space:pre-wrap}h1{font-size:1.1rem}code{background:#f0f0f0;padding:0 .3em;border-radius:3px}</style>
<h1>Interesse na Sinopse — rotulagem cega (${fixture.sample_version})</h1>
<p>Leia cada sinopse e preencha o nível no CSV pelo <code>slot_key</code>. Níveis: <code>♥</code> / <code>♥♥</code> / <code>♥♥♥</code> / <code>♥♥♥♥</code>. Veja a rúbrica (RUBRIC.md). Itens repetidos são propositais — rotule cada um de forma independente.</p>
${cards}`
  writeFileSync(resolve(dir, "labeling-sheet.pilot-1.html"), html)

  // CSV (preencher) — slot_key,label SEM sinopse (parsing trivial).
  const csv = ["slot_key,label", ...slots.map((s) => `${s.slotKey},`)].join("\n") + "\n"
  writeFileSync(resolve(dir, "labeling-sheet.pilot-1.csv"), csv)

  console.log(`Export gerado (${slots.length} slots, ordem embaralhada):`)
  console.log(`  lib/synopsis-interest/labeling-sheet.pilot-1.html  (ler)`)
  console.log(`  lib/synopsis-interest/labeling-sheet.pilot-1.csv   (preencher slot_key,label)`)
}

main().catch((err) => { console.error("[export] erro:", err); process.exit(1) })
