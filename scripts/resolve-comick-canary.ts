/**
 * Resolve um hid canário do ComicK pra o gate de saúde (lib/external/comick-health.ts).
 * O hid do ComicK não aparece na URL (a URL usa slug), então precisa vir da API.
 *
 *   npm run comick:canary            # busca "Solo Leveling"
 *   npm run comick:canary "One Piece"
 *
 * Precisa de FlareSolverr no ar (.env.local FLARESOLVERR_URL) — o ComicK tenta
 * fetch direto primeiro e cai no FlareSolverr quando o Cloudflare desafia.
 * Cole o hid impresso em COMICK_CANARY_HID no .env.local.
 */
import { searchComicK, fetchComicKByHid, fetchComicKReviews } from "@/lib/external/comick"

async function main() {
  const query = process.argv[2] ?? "Solo Leveling"
  console.log(`[comick:canary] buscando "${query}"…`)

  const results = await searchComicK(query).catch((e) => {
    console.error(`[comick:canary] busca falhou (FlareSolverr fora?): ${e?.message ?? e}`)
    return []
  })
  if (!results.length) {
    console.error("[comick:canary] sem resultados. Cheque FLARESOLVERR_URL e a rede.")
    process.exit(1)
  }

  for (const r of results.slice(0, 3)) {
    const hid = r.id.split(":")[1]
    const detail = await fetchComicKByHid(hid)
    const reviews = await fetchComicKReviews(hid)
    const ok = !!detail?.title && reviews.length > 0
    console.log(
      `  hid=${hid}  title="${r.title}"  detail=${!!detail?.title}  reviews=${reviews.length}  ${ok ? "✅ VÁLIDO" : "⚠️ sem reviews"}`,
    )
    if (ok) {
      console.log(`\nDefina no .env.local:\n\n  COMICK_CANARY_HID=${hid}\n`)
      return
    }
  }
  console.error("\n[comick:canary] nenhum candidato válido (detalhe+reviews). Tente outro título.")
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
