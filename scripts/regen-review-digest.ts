/**
 * Regera o digest de UMA obra pelo pipeline real (ensureReviewDigest → Claude) e
 * valida o que foi persistido. Existe pra fechar a única ponta que os testes
 * unitários não cobrem: o loop de tentativas contra a API de verdade
 * (stop_reason, retry, rejeição de markup vazado).
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/regen-review-digest.ts <workId>
 *
 * Custo: 1 chamada Sonnet (~US$0,02–0,05). PAGO — não rode sem querer.
 */
import { createClient } from "@supabase/supabase-js"
import { isDigestCorrupted } from "@/lib/ai-recommendation/digest-integrity"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

const workId = process.argv[2]
if (!workId) {
  console.error("uso: regen-review-digest.ts <workId>")
  process.exit(1)
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { data: before } = await sb
    .from("works")
    .select("title, review_digest")
    .eq("id", workId)
    .single()

  console.log(`Obra: ${before?.title}`)
  console.log(`Digest antes: ${before?.review_digest ? "presente" : "null (zerado pela cura)"}\n`)

  const { ensureReviewDigest } = await import("@/lib/orchestration/integrations/reviews")
  const t0 = Date.now()
  const out = await ensureReviewDigest(workId, { supabase: sb, allowPaid: true, force: true })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)

  console.log(`ensureReviewDigest → ${out.status} (${secs}s)`)
  if (out.status === "succeeded") console.log(`  ranLlm=${out.ranLlm} custo=US$${out.costUsd.toFixed(4)}`)
  if (out.status === "failed") console.log(`  erro: ${out.error}`)
  if (out.status === "not_ready") console.log(`  motivo: ${out.reason}`)

  const { data: after } = await sb
    .from("works")
    .select("review_digest, review_digest_n")
    .eq("id", workId)
    .single()

  const d = after?.review_digest as ReviewDigest | null
  console.log("\n--- digest persistido ---")
  if (!d) {
    console.log("NENHUM (nada foi gravado)")
    return
  }
  const corrupted = isDigestCorrupted(d)
  console.log(`  corrompido (markup vazado)? ${corrupted ? "SIM ❌" : "não ✅"}`)
  console.log(`  salient_traits: ${d.salient_traits?.length ?? 0}`)
  console.log(`  reviews usadas: ${after?.review_digest_n}`)
  console.log(`  consensus: ${(d.consensus ?? "").slice(0, 120)}…`)
  console.log(`  divergence: ${(d.divergence ?? "(vazio)").slice(0, 120)}…`)
  for (const t of d.salient_traits ?? []) console.log(`    · [${t.polarity}] ${t.trait} (${t.axis})`)

  if (corrupted) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
