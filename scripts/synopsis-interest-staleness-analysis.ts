/**
 * Análise do churn de staleness das previsões de Interesse na Sinopse
 * (Plano 3 Fase B §7). READ-ONLY, dry-run, SEM chamada paga e SEM alterar o gate
 * de produção. Compara, ao longo das versões históricas do taste_profile:
 *   - assinatura ATUAL (computeProfileSignature — produção); vs
 *   - assinatura CANDIDATA estreita (relevantSynopsisSignature — só tags/temas).
 * Mede quantas invalidações históricas seriam evitadas e estima a economia.
 *
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/synopsis-interest-staleness-analysis.ts
 */
import { createClient } from "@supabase/supabase-js"
import { computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
import { relevantSynopsisSignature, analyzeStalenessTransitions } from "@/lib/synopsis-interest/staleness"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const COST_PER_CALL = 0.00971 // medido no diagnóstico (Sonnet, synopsis_quality_predict)

async function main() {
  const { data, error } = await sb.from("taste_profile").select("version, is_stub, profile").order("version", { ascending: true })
  if (error) throw new Error(error.message)
  const versions = (data ?? [])
    .filter((r) => !(r as { is_stub: boolean }).is_stub && (r as { profile: unknown }).profile)
    .map((r) => {
      const profile = (r as { profile: TasteProfilePayload }).profile
      return { fullSig: computeProfileSignature(profile), relevantSig: relevantSynopsisSignature(profile) }
    })

  console.log(`Versões de taste_profile (não-stub): ${versions.length}`)
  const a = analyzeStalenessTransitions(versions)
  console.log(`  transições=${a.transitions} | assinatura ATUAL mudou=${a.fullChanges} | CANDIDATA mudou=${a.relevantChanges}`)
  console.log(`  invalidações EVITÁVEIS (atual mudou, candidata não)=${a.avoidedInvalidations} (${a.avoidedRate != null ? (100 * a.avoidedRate).toFixed(0) : "—"}% das invalidações atuais)`)

  // Tamanho do backfill por invalidação ≈ obras com previsão ativa.
  const { count: predWorks } = await sb.from("synopsis_quality_predictions").select("work_id", { count: "exact", head: true })
  const catalog = predWorks ?? 0
  const upper = a.avoidedInvalidations * catalog * COST_PER_CALL
  console.log(`\nEstimativa (LIMITE SUPERIOR — re-predict é sob demanda, não eager):`)
  console.log(`  obras com previsão ≈ ${catalog} | custo/chamada $${COST_PER_CALL}`)
  console.log(`  economia potencial ≈ $${upper.toFixed(2)} (${a.avoidedInvalidations} invalidações evitáveis × ${catalog} × $${COST_PER_CALL})`)
  console.log(`  — independente de Sonnet→Haiku (plano §7); é redução de RE-EXECUÇÃO, não de preço unitário.`)
}

main().catch((err) => { console.error("[staleness] erro:", err); process.exit(1) })
