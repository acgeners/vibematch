/**
 * DIAGNÓSTICO de materialidade da obsolescência do INTERESSE (Frente 1, $0, 0 escrita).
 * Mede quão sensível é a assinatura de entrada hoje a mudanças COSMÉTICAS vs MATERIAIS,
 * e o quanto um regen de perfil OVER-invalida (vs o conjunto que de fato muda).
 *
 * ALVO: LOCAL — só LÊ, então o `.env.analysis` (que vem DEPOIS e vence) o manda pro clone
 * local e o egress fica em zero. Sem ele, roda contra a NUVEM em silêncio.
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-staleness.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeInterestInputSignature } from "@/lib/orchestration/integrations/synopsis-interest"
import { computeProfileSignature } from "@/lib/ai-recommendation/taste-profile"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"

// normalização proposta (materialidade): colapsa whitespace interno, lowercase, tira pontuação
function normHard(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim()
}

async function main() {
  const supabase = createAdminClient()
  const { data: worksData, error: worksErr } = await supabase
    .from("works")
    .select("id, title, canonical_synopsis, work_tags(tags(name))")
    .eq("is_archived", false)
    .not("canonical_synopsis", "is", null)
    .limit(2000)
  if (worksErr) throw new Error(worksErr.message)
  const works = (worksData ?? []).map((w) => {
    const rec = w as Record<string, unknown>
    const tags = ((rec.work_tags as Array<{ tags?: { name?: string } }>) ?? [])
      .map((wt) => wt?.tags?.name).filter((n): n is string => Boolean(n))
    return { id: rec.id as string, title: (rec.title as string) ?? "", synopsis: (rec.canonical_synopsis as string) ?? "", tags }
  }).filter((w) => w.synopsis.trim().length > 0)

  const prof = await loadCurrentTasteProfile()
  const profile: TasteProfilePayload = prof?.profile ?? { loved_tags: [], avoided_tags: [], loved_themes: [], avoided_themes: [], criterion_preferences: {}, narrative_patterns: [], summary: "" }
  const profSig = computeProfileSignature(profile)

  const sig = (title: string, synopsis: string, tags: string[], pSig = profSig) =>
    computeInterestInputSignature({ workId: "W", profileSignature: pSig, title, synopsis, synopsisSource: "canonical", tags, model: "m", promptVersion: "v", schemaVersion: "v" })

  // assinatura "materialidade" proposta: sinopse normalizada-hard
  const sigMat = (title: string, synopsis: string, tags: string[], pSig = profSig) =>
    sig(normHard(title), normHard(synopsis), tags, pSig)

  const N = works.length
  const count = (pred: (w: typeof works[number]) => boolean) => works.filter(pred).length
  const pct = (n: number) => `${((100 * n) / N).toFixed(1)}%`

  console.log(`\n=== Materialidade do Interesse · n=${N} obras (com sinopse) ===`)
  console.log(`(flip = a edição muda a assinatura ⇒ marcaria stale ⇒ re-prevê LLM)\n`)

  // --- COSMÉTICAS (idealmente NÃO deviam invalidar) ---
  const cosmetic: Array<[string, (s: string) => string]> = [
    ["espaço duplo interno", (s) => s.replace(/ /g, "  ")],
    ["CAIXA alterada", (s) => s.toUpperCase()],
    ["pontuação extra (… !!)", (s) => s + " …!!"],
    ["trim já coberto (espaço nas pontas)", (s) => `   ${s}   `],
  ]
  console.log("COSMÉTICAS (flip hoje → flip c/ materialidade proposta):")
  for (const [name, f] of cosmetic) {
    const flipNow = count((w) => sig(w.title, f(w.synopsis), w.tags) !== sig(w.title, w.synopsis, w.tags))
    const flipMat = count((w) => sigMat(w.title, f(w.synopsis), w.tags) !== sigMat(w.title, w.synopsis, w.tags))
    console.log(`  ${name.padEnd(34)} hoje=${pct(flipNow).padStart(6)}  →  materialidade=${pct(flipMat).padStart(6)}`)
  }

  // --- TAGS: 1 tag de N ---
  const drop1 = count((w) => w.tags.length > 1 && sig(w.title, w.synopsis, w.tags.slice(1)) !== sig(w.title, w.synopsis, w.tags))
  console.log(`\nTAG (remover 1 de N): flip hoje=${pct(drop1)} (sem limiar Jaccard, 1 tag sempre invalida)`)

  // --- MATERIAL (DEVE invalidar) — sanity de que materialidade não over-merge ---
  const addSentence = count((w) => sigMat(w.title, w.synopsis + " Uma reviravolta sombria muda tudo no final.", w.tags) !== sigMat(w.title, w.synopsis, w.tags))
  console.log(`MATERIAL (append de frase): flip c/ materialidade=${pct(addSentence)} (deve ser ~100% — não pode over-merge)`)

  // --- PERFIL: over-invalidação ---
  // Tweak mínimo (regen do perfil que muda 1 tag de força) → assinatura do perfil muda → TODAS invalidam.
  const profTweak = { ...profile, summary: profile.summary + " " }
  const profSig2 = computeProfileSignature({ ...profTweak, loved_tags: [...(profile.loved_tags ?? [])] })
  // força mudança real: muda strength da 1ª loved tag (se houver) por 0.01
  const loved = profile.loved_tags ?? []
  const profSigStrength = loved.length
    ? computeProfileSignature({ ...profile, loved_tags: loved.map((t, i) => (i === 0 ? { ...t, strength: t.strength + 0.01 } : t)) })
    : profSig
  const flipAll = count((w) => sig(w.title, w.synopsis, w.tags, profSigStrength) !== sig(w.title, w.synopsis, w.tags))
  // conjunto MATERIAL: obras cuja tag-set intersecta a tag mudada no perfil
  const changedTag = loved[0]?.name?.toLowerCase()
  const materialSet = changedTag ? count((w) => w.tags.map((t) => t.toLowerCase()).includes(changedTag)) : 0
  console.log(`\nPERFIL (regen muda força de 1 loved-tag "${loved[0]?.name ?? "—"}" em 0.01):`)
  console.log(`  invalida HOJE = ${pct(flipAll)} das obras (perfil é hash global)`)
  console.log(`  conjunto MATERIAL (obras que têm essa tag) = ${pct(materialSet)}  → over-invalidação = ${flipAll - materialSet} obras desnecessárias`)
  console.log(`  (summary-only tweak invalida? ${sig(works[0].title, works[0].synopsis, works[0].tags, profSig2) !== sig(works[0].title, works[0].synopsis, works[0].tags) ? "SIM" : "não"} — summary não deveria contar)`)

  console.log("\n(read-only, 0 escrita, 0 LLM)")
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : e); process.exit(1) })
