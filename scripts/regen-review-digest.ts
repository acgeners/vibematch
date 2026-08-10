/**
 * Regera o digest de reviews pelo pipeline real (ensureReviewDigest → Claude) e
 * VALIDA o que foi persistido. Duas formas de uso:
 *
 *   # uma obra (foi assim que a blindagem foi verificada end-to-end)
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/regen-review-digest.ts <workId>
 *
 *   # todas as obras de um manifesto (pula as que já regeraram)
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local \
 *     scripts/regen-review-digest.ts --from scripts/manifests/digest-zeroed-2026-07-12.json
 *
 * ⚠️ PAGO: 1 chamada Sonnet por obra (~US$0,014 medido). O modo --from é sequencial
 *    e imprime o custo acumulado; Ctrl+C entre obras é seguro.
 * ⚠️ Rode só com a blindagem de review-summarizer.ts ativa (PR #103) — senão o
 *    mesmo tool-call mal-serializado pode voltar a ser gravado.
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { isDigestCorrupted } from "@/lib/ai-recommendation/digest-integrity"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

interface ManifestEntry {
  id: string
  title?: string
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

function parseArgs(): { ids: ManifestEntry[] } {
  const argv = process.argv.slice(2)
  const fromIdx = argv.indexOf("--from")
  if (fromIdx >= 0) {
    const path = argv[fromIdx + 1]
    if (!path) throw new Error("--from exige o caminho do manifesto")
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { works: ManifestEntry[] }
    return { ids: manifest.works }
  }
  const workId = argv[0]
  if (!workId) throw new Error("uso: regen-review-digest.ts <workId> | --from <manifesto.json>")
  return { ids: [{ id: workId }] }
}

/** Regera uma obra e devolve o veredito do que ficou persistido. */
async function regenOne(entry: ManifestEntry): Promise<{ skipped: boolean; costUsd: number; ok: boolean }> {
  const { data: before } = await sb
    .from("works")
    .select("title, review_digest")
    .eq("id", entry.id)
    .single()

  const title = before?.title ?? entry.title ?? entry.id

  // Já tem digest? Não paga de novo (o manifesto é acumulativo entre execuções).
  if (before?.review_digest) {
    console.log(`⏭  ${title} — já tem digest, pulando`)
    return { skipped: true, costUsd: 0, ok: true }
  }

  const { ensureReviewDigest } = await import("@/lib/orchestration/integrations/reviews")
  const t0 = Date.now()
  const out = await ensureReviewDigest(entry.id, { supabase: sb, allowPaid: true, force: true })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)

  if (out.status !== "succeeded") {
    const detalhe =
      out.status === "failed" ? out.error : out.status === "not_ready" ? out.reason : out.status
    console.log(`❌ ${title} — ${out.status}: ${detalhe} (${secs}s)`)
    return { skipped: false, costUsd: 0, ok: false }
  }

  const { data: after } = await sb
    .from("works")
    .select("review_digest, review_digest_n")
    .eq("id", entry.id)
    .single()

  const d = after?.review_digest as ReviewDigest | null
  if (!d) {
    console.log(`❌ ${title} — nada foi gravado (${secs}s)`)
    return { skipped: false, costUsd: out.costUsd, ok: false }
  }
  if (isDigestCorrupted(d)) {
    console.log(`❌ ${title} — CORROMPIDO DE NOVO (markup vazado) — a blindagem está ativa? (${secs}s)`)
    return { skipped: false, costUsd: out.costUsd, ok: false }
  }

  const nTraits = d.salient_traits?.length ?? 0
  console.log(
    `✅ ${title} — ${nTraits} traço(s), ${after?.review_digest_n} reviews, ` +
    `US$${out.costUsd.toFixed(4)} (${secs}s)`,
  )
  return { skipped: false, costUsd: out.costUsd, ok: true }
}

async function main() {
  const { ids } = parseArgs()
  console.log(`Regerando ${ids.length} obra(s)…\n`)

  let total = 0
  let ok = 0
  let skipped = 0
  let failed = 0

  for (const entry of ids) {
    const r = await regenOne(entry)
    total += r.costUsd
    if (r.skipped) skipped++
    else if (r.ok) ok++
    else failed++
  }

  console.log(`\n— regeradas: ${ok} | puladas: ${skipped} | falhas: ${failed}`)
  console.log(`— custo total: US$${total.toFixed(4)}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
