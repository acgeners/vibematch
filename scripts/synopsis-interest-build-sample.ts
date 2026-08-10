/**
 * Gera a GOLDEN SAMPLE congelada de Interesse na Sinopse (Plano 3 Fase B).
 *
 * READ-ONLY no banco + escreve a fixture local (NÃO grava no banco; NÃO chama
 * provider). A amostra é FIXA: rodar de novo com os mesmos dados dá a mesma
 * fixture (determinístico). Estratifica pelo label atual só p/ cobrir os 4 níveis.
 *
 * Uso: npx tsx --env-file=.env.local --env-file=.env.analysis scripts/synopsis-interest-build-sample.ts
 * Saída: lib/synopsis-interest/golden-sample.pilot-1.json
 */
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"
import { buildGoldenSample, summarizeSample, type SampleCandidate } from "@/lib/synopsis-interest/sample"
import type { SynopsisQuality } from "@/types/domain"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const SAMPLE_VERSION = "pilot-1"

async function main() {
  // Candidatos rotuláveis: têm label (estrato) + sinopse canônica + não arquivados.
  const cands: SampleCandidate[] = []
  let from = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await sb
      .from("works")
      .select("id, synopsis_quality, canonical_synopsis, is_archived")
      .not("synopsis_quality", "is", null)
      .eq("is_archived", false)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    for (const w of data ?? []) {
      const syn = (w as { canonical_synopsis: string | null }).canonical_synopsis
      if (syn && syn.trim().length > 0) {
        cands.push({ workId: (w as { id: string }).id, stratum: (w as { synopsis_quality: SynopsisQuality }).synopsis_quality })
      }
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }

  const byLevel: Record<string, number> = {}
  for (const c of cands) byLevel[c.stratum] = (byLevel[c.stratum] ?? 0) + 1
  console.log(`Candidatos rotuláveis (label + sinopse canônica + não-arquivados): ${cands.length}`)
  console.log(`  por nível: ${JSON.stringify(byLevel)}`)

  const slots = buildGoldenSample(cands, { sampleVersion: SAMPLE_VERSION })
  const summary = summarizeSample(slots)
  console.log(`\nAmostra: ${summary.uniqueWorks} únicas + ${summary.repeats} repetições = ${slots.length} slots`)
  console.log(`  estratos × split: ${JSON.stringify(summary.byStratum)}`)

  const fixture = {
    sample_version: SAMPLE_VERSION,
    generated_note: "FROZEN — não regenerar após observar outputs candidatos (Plano 3 Fase B §2).",
    candidate_pool: cands.length,
    summary,
    slots,
  }
  const out = resolve(process.cwd(), "lib/synopsis-interest/golden-sample.pilot-1.json")
  writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n")
  console.log(`\nFixture escrita: ${out}`)
}

main().catch((err) => {
  console.error("[build-sample] erro:", err)
  process.exit(1)
})
