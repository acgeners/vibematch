/**
 * A Comix responde? Read-only, zero LLM, zero escrita.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-comix-probe.ts
 *   COMIX_RENDER_URL= FLARESOLVERR_URL= npx tsx … scripts/diag-comix-probe.ts   # simula prod
 *
 * Existe porque a Comix falha de um jeito que some do relatório: `searchComix` devolve `[]`
 * (não erro) quando o circuito de auth abre, então ela não aparece nem em `failedSources`. Num
 * diagnóstico agregado isso é indistinguível de "a obra não está na Comix".
 *
 * Separa os DOIS caminhos, que têm respostas diferentes:
 *   1. BUSCA por título   — é o que uma obra nova usa pra ganhar o vínculo
 *   2. REVIEWS por hid    — é o que toda avaliação seguinte usa
 */
import { searchComix, fetchComixReviews } from "@/lib/external/comix"

const HIDS: Array<[string, string]> = [
  ["The Duke's Obsession With His Wife", "kl6nv"],
  ["Your Ultimate Love Rival", "pqx9"],
]

const bypass = [
  process.env.COMIX_RENDER_URL?.trim() ? "sidecar" : null,
  process.env.FLARESOLVERR_URL?.trim() ? "flaresolverr" : null,
].filter(Boolean)

async function main() {
  console.log(`bypass ativo: ${bypass.length ? bypass.join(" + ") : "NENHUM (simula produção hoje)"}\n`)

  console.log("1. BUSCA por título (o caminho da obra nova)")
  for (const [titulo] of HIDS) {
    const t0 = Date.now()
    const r = await searchComix(titulo)
    console.log(
      `   "${titulo.slice(0, 40)}" → ${r.length} resultado(s)  (${((Date.now() - t0) / 1000).toFixed(1)}s)` +
        (r[0] ? `  hid=${r[0].id}` : "")
    )
  }

  console.log("\n2. REVIEWS por hid (o caminho de toda avaliação seguinte)")
  for (const [titulo, hid] of HIDS) {
    const t0 = Date.now()
    const r = await fetchComixReviews(hid)
    console.log(
      `   "${titulo.slice(0, 40)}" hid=${hid} → ${r.length} review(s)  (${((Date.now() - t0) / 1000).toFixed(1)}s)`
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
