/**
 * Quanto uma obra NOVA perde sem bypass de Cloudflare? Read-only, zero LLM, zero escrita.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-bypass-value.ts
 *   COMIX_RENDER_URL= FLARESOLVERR_URL= npx tsx … scripts/diag-bypass-value.ts   # simula prod
 *
 * Por que existe: a decisão de pagar (ou não) por um bypass em produção vinha sendo tomada com o
 * número ERRADO — "72% das reviews do acervo vêm de fontes atrás de Cloudflare". Esse é um fato
 * sobre o que já foi colhido (em dev, COM sidecar), não sobre o que uma obra nova colheria HOJE em
 * produção. São coisas diferentes e podem divergir muito.
 *
 * O experimento tem UMA variável: as duas envs de bypass. Mesma máquina, mesmo código, mesmos
 * títulos. Rode duas vezes (com e sem) e compare. O cache de contexto é por PROCESSO (TTL ~5min),
 * então rodadas separadas não se contaminam.
 *
 * ⚠️ O que ele NÃO isola: o IP. Aqui é residencial brasileiro; a Fly é datacenter. O fetch direto
 * falha por fingerprint de TLS antes de o IP importar, então "sem bypass" daqui é boa aproximação
 * de "sem bypass lá" — mas não é prova. O que decide isso é subir e medir.
 */
import { searchAllSourcesWithStatus, fetchExternalEvaluationContextForWork } from "@/lib/external"
import { createAdminClient } from "@/lib/supabase/admin"

const ALVOS = Number(process.env.ALVOS ?? 4)

const bypass = [
  process.env.COMIX_RENDER_URL?.trim() ? "sidecar" : null,
  process.env.FLARESOLVERR_URL?.trim() ? "flaresolverr" : null,
].filter(Boolean)

function porFonte(itens: ReadonlyArray<{ source: string }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of itens) out[i.source] = (out[i.source] ?? 0) + 1
  return out
}

const fmt = (r: Record<string, number>) =>
  Object.entries(r)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(" ") || "(nenhuma)"

async function main() {
  console.log(`bypass ativo: ${bypass.length ? bypass.join(" + ") : "NENHUM (simula produção hoje)"}`)

  const sb = createAdminClient()
  // Obras reais do catálogo, as mais recentes — é o perfil de "obra que eu acabei de adicionar".
  const { data } = await sb
    .from("works")
    .select("id, title")
    .eq("is_archived", false)
    .order("created_at", { ascending: false })
    .limit(ALVOS)

  const obras = data ?? []
  if (!obras.length) throw new Error("nenhuma obra no banco apontado pelo .env")

  const totalBusca: Record<string, number> = {}
  const totalReviews: Record<string, number> = {}

  for (const obra of obras) {
    const t0 = Date.now()
    const busca = await searchAllSourcesWithStatus(obra.title)
    // Fontes que devolveram ao menos um candidato — é isto que vira `work_external_ids` na
    // criação, e é o que TODA avaliação futura da obra vai usar. Perder fonte aqui é dano
    // permanente, não só uma coleta fraca de uma vez.
    const fontesBusca = new Set<string>()
    for (const c of busca.candidates) for (const s of c.sources ?? []) fontesBusca.add(s)

    const ctx = await fetchExternalEvaluationContextForWork({ title: obra.title })
    const reviews = porFonte(ctx.allReviews ?? [])
    const ms = Date.now() - t0

    for (const f of fontesBusca) totalBusca[f] = (totalBusca[f] ?? 0) + 1
    for (const [f, n] of Object.entries(reviews)) totalReviews[f] = (totalReviews[f] ?? 0) + n

    console.log(`\n▸ ${obra.title}  (${(ms / 1000).toFixed(1)}s)`)
    console.log(`   busca  : ${[...fontesBusca].sort().join(" ") || "(nenhuma fonte respondeu)"}`)
    if (busca.failedSources?.length) console.log(`   falhou : ${busca.failedSources.join(" ")}`)
    console.log(`   reviews: ${fmt(reviews)}  → TOTAL ${ctx.allReviews?.length ?? 0}`)
  }

  console.log(`\n${"═".repeat(70)}`)
  console.log(`AGREGADO (${obras.length} obras) — bypass: ${bypass.length ? bypass.join("+") : "NENHUM"}`)
  console.log(`  fontes na busca : ${fmt(totalBusca)}`)
  console.log(`  reviews colhidas: ${fmt(totalReviews)}`)
  console.log(`  TOTAL de reviews: ${Object.values(totalReviews).reduce((a, b) => a + b, 0)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
