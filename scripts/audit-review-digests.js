// @ts-check
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Audita (e opcionalmente cura) digests de reviews corrompidos.
 *
 * Contexto: até a blindagem em lib/ai-recommendation/review-summarizer.ts, um
 * tool-call mal-serializado pelo modelo (fechando o parâmetro com a tag errada)
 * fazia o campo `divergence` engolir o bloco `salient_traits` inteiro em JSON cru.
 * O resultado ia direto pro JSONB works.review_digest sem validação e era
 * renderizado como "texto técnico" na página da obra, sem os chips de traço.
 *
 * Uso:
 *   node scripts/audit-review-digests.js          # só LISTA (read-only)
 *   node scripts/audit-review-digests.js --fix    # zera os corrompidos p/ regerar
 *
 * O --fix apaga review_digest/_at/_n/_version das linhas corrompidas. Ele NÃO
 * chama a IA: o digest volta a ser gerado sob demanda (botão "Regerar" na obra
 * ou a cascata de geração), então nada é cobrado aqui.
 */

const { createClient } = require("@supabase/supabase-js")
const path = require("path")

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local") })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Espelha LEAKED_MARKUP_RE de lib/ai-recommendation/digest-integrity.ts (script é
// JS puro e não importa TS — se mudar lá, mude aqui).
const LEAKED_MARKUP_RE =
  /<\/?(?:parameter|antml:[a-z_]+|invoke|function_calls|function_results|consensus|divergence|salient_traits|content_warnings|execution)\b/i

const FIX = process.argv.includes("--fix")

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em .env.local")
    process.exit(1)
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

  const { data, error } = await sb
    .from("works")
    .select("id, title, review_digest, review_digest_n")
    .not("review_digest", "is", null)

  if (error) {
    console.error("Erro ao ler works:", error.message)
    process.exit(1)
  }

  const rows = data ?? []
  const leaked = []
  const noTraits = []

  for (const w of rows) {
    const d = w.review_digest
    if (!d || typeof d !== "object") continue
    const texts = [d.consensus, d.divergence, d.execution].filter((t) => typeof t === "string")
    if (texts.some((t) => LEAKED_MARKUP_RE.test(t))) leaked.push(w)
    else if (!Array.isArray(d.salient_traits) || d.salient_traits.length === 0) noTraits.push(w)
  }

  console.log(`\nDigests analisados: ${rows.length}`)
  console.log(`  corrompidos (markup vazado): ${leaked.length}`)
  console.log(`  suspeitos (sem salient_traits): ${noTraits.length}\n`)

  for (const w of leaked) console.log(`  [markup]  ${w.id}  ${w.title}`)
  for (const w of noTraits) console.log(`  [s/traço] ${w.id}  ${w.title}`)

  const bad = [...leaked, ...noTraits]
  if (bad.length === 0) {
    console.log("\nNada a curar.")
    return
  }

  if (!FIX) {
    console.log(`\nRead-only. Rode com --fix para zerar os ${bad.length} digest(s) e permitir a regeração.`)
    return
  }

  // .in() com centenas de ids devolve 400 no PostgREST — vai em lotes.
  const CHUNK = 50
  for (let i = 0; i < bad.length; i += CHUNK) {
    const ids = bad.slice(i, i + CHUNK).map((w) => w.id)
    const { error: updErr } = await sb
      .from("works")
      .update({ review_digest: null, review_digest_at: null, review_digest_n: null, review_digest_version: null })
      .in("id", ids)
    if (updErr) {
      console.error("Erro ao zerar digests:", updErr.message)
      process.exit(1)
    }
  }
  console.log(`\n${bad.length} digest(s) zerado(s). Serão regerados sob demanda (nenhuma chamada de IA feita aqui).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
