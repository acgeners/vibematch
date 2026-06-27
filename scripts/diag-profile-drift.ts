/**
 * DIAGNÓSTICO de DRIFT do perfil de gosto (Frente otimização, $0, 0 escrita, 0 LLM).
 * Quanto o perfil LLM SALVO está distante do "real" (gosto atual), por causa das
 * mudanças acumuladas desde que foi gerado. Dois ângulos:
 *   (A) HEURÍSTICO×HEURÍSTICO (method-free): heurístico AGORA vs heurístico SEM as obras
 *       mudadas/adicionadas desde o perfil → isola o IMPACTO das mudanças acumuladas.
 *   (B) HEURÍSTICO×LLM: heurístico AGORA vs o perfil LLM salvo (inclui ruído de método —
 *       upper bound da divergência).
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { loadCurrentTasteProfile, computeInputHash } from "@/lib/ai-recommendation/taste-profile"
import { buildTasteProfileHeuristic } from "@/lib/ai-recommendation/taste-profile-heuristic"
import { getRatedWorksForProfile } from "@/server/queries/recommendations"
import type { ProfileTag, TasteProfilePayload } from "@/lib/ai-recommendation/types"

const names = (ts: ProfileTag[] | undefined) => new Set((ts ?? []).map((t) => t.name.toLowerCase()))
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}
function tagDiff(a: ProfileTag[] | undefined, b: ProfileTag[] | undefined) {
  const A = names(a), B = names(b)
  const onlyA = [...A].filter((x) => !B.has(x))
  const onlyB = [...B].filter((x) => !A.has(x))
  return { jac: jaccard(A, B), onlyA, onlyB }
}
function critKeys(p: TasteProfilePayload) {
  return new Set(Object.entries(p.criterion_preferences ?? {}).filter(([, v]) => v != null).map(([k]) => k))
}

async function main() {
  const sb = createAdminClient()
  const prof = await loadCurrentTasteProfile()
  if (!prof) { console.log("Sem perfil salvo."); return }
  const llm = prof.profile as TasteProfilePayload
  const createdAt = (prof as { created_at?: string }).created_at ?? null
  const nUsed = (prof as { n_works_used?: number }).n_works_used ?? null
  const storedHash = (prof as { input_hash?: string }).input_hash ?? null
  const version = (prof as { version?: number }).version ?? "?"
  const isStub = (prof as { is_stub?: boolean }).is_stub ?? false

  const rated = await getRatedWorksForProfile()
  const curHash = computeInputHash(rated)
  const stale = storedHash !== curHash

  // updated_at das rotuladas (pra detectar mudança DESDE o perfil)
  const { data: upd } = await sb.from("works").select("id, updated_at").not("user_score", "is", null).limit(2000)
  const updById = new Map((upd ?? []).map((r) => [(r as { id: string }).id, (r as { updated_at: string }).updated_at]))
  const changedSince = createdAt
    ? rated.filter((w) => { const u = updById.get(w.id); return u && u > createdAt }).length
    : null
  const addedSince = nUsed != null ? Math.max(0, rated.length - nUsed) : null

  // heurísticos
  const hNow = buildTasteProfileHeuristic(rated)
  const stableRated = createdAt ? rated.filter((w) => { const u = updById.get(w.id); return !(u && u > createdAt) }) : rated
  const hPre = buildTasteProfileHeuristic(stableRated)

  console.log("\n=== PERFIL SALVO ===")
  console.log(`versão v${version} · is_stub=${isStub} · n_works_used=${nUsed} · criado=${createdAt ?? "?"}`)
  console.log(`input_hash bate com o atual? ${stale ? "NÃO (stale)" : "sim (fresh)"}`)

  console.log("\n=== MUDANÇAS ACUMULADAS desde o perfil ===")
  console.log(`obras rotuladas AGORA: ${rated.length} · usadas no perfil: ${nUsed} · adicionadas desde: ${addedSince ?? "?"}`)
  console.log(`obras rotuladas EDITADAS desde o perfil (updated_at>criado): ${changedSince ?? "?"} de ${rated.length}` +
    (changedSince != null ? ` (${((100 * changedSince) / rated.length).toFixed(1)}%)` : ""))

  console.log("\n=== (A) DISTÂNCIA method-free (heurístico AGORA vs heurístico SEM as mudanças) ===")
  console.log("  → quanto as mudanças acumuladas moveram o gosto (proxy determinístico):")
  const aLoved = tagDiff(hNow.loved_tags, hPre.loved_tags)
  const aAvoid = tagDiff(hNow.avoided_tags, hPre.avoided_tags)
  console.log(`  loved_tags: Jaccard=${aLoved.jac.toFixed(3)} (1=idêntico) · entraram=${aLoved.onlyA.length} saíram=${aLoved.onlyB.length}`)
  console.log(`  avoided_tags: Jaccard=${aAvoid.jac.toFixed(3)} · entraram=${aAvoid.onlyA.length} saíram=${aAvoid.onlyB.length}`)
  if (aLoved.onlyA.length) console.log(`    loved que ENTRARAM: ${aLoved.onlyA.slice(0, 8).join(", ")}`)
  if (aLoved.onlyB.length) console.log(`    loved que SAÍRAM:   ${aLoved.onlyB.slice(0, 8).join(", ")}`)

  console.log("\n=== (B) DIVERGÊNCIA heurístico-AGORA vs perfil LLM SALVO (inclui ruído de método) ===")
  const bLoved = tagDiff(hNow.loved_tags, llm.loved_tags)
  const bAvoid = tagDiff(hNow.avoided_tags, llm.avoided_tags)
  const ck = critKeys(hNow), cl = critKeys(llm)
  console.log(`  loved_tags: Jaccard=${bLoved.jac.toFixed(3)} (heurístico tem ${names(hNow.loved_tags).size}, LLM tem ${names(llm.loved_tags).size})`)
  console.log(`  avoided_tags: Jaccard=${bAvoid.jac.toFixed(3)}`)
  console.log(`  critérios com preferência: heurístico=${ck.size} LLM=${cl.size} · Jaccard=${jaccard(ck, cl).toFixed(3)}`)

  // Índice de drift simples (0=igual, 1=tudo mudou) — média de (1-Jaccard) do bloco (A)
  const drift = 1 - (aLoved.jac + aAvoid.jac) / 2
  console.log(`\n=== ÍNDICE DE DRIFT (A, method-free) = ${(drift * 100).toFixed(1)}% ===`)
  console.log(`  (0% = mudanças não moveram o gosto → regen de ~$0,40 desnecessário; alto = vale regenerar)`)
  console.log("\n(read-only, 0 escrita, 0 LLM)")
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : e); process.exit(1) })
