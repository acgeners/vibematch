/**
 * Qual camada de bypass recupera o ComicK? Read-only, zero LLM, zero escrita.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-comick-probe.ts
 *
 * Existe porque a medição agregada deu resultado CONTRADITÓRIO — o ComicK apareceu em 1 de 4
 * buscas com FlareSolverr sozinho e em 4 de 4 com as duas camadas, o que não se explica se o
 * sidecar não ajuda. Ou há variância (rate limit, sessão quente), ou a leitura estava errada.
 * Uma decisão de gasto não se apoia num número desses: repete e conta.
 */
import { searchComicK } from "@/lib/external/comick"

const TITULOS = ["The Duke's Obsession With His Wife", "Your Ultimate Love Rival", "Berserk"]
const REPETICOES = Number(process.env.REPETICOES ?? 2)

const bypass = [
  process.env.COMIX_RENDER_URL?.trim() ? "sidecar" : null,
  process.env.FLARESOLVERR_URL?.trim() ? "flaresolverr" : null,
].filter(Boolean)

async function main() {
  console.log(`bypass: ${bypass.length ? bypass.join(" + ") : "NENHUM"}`)
  let ok = 0
  let tentativas = 0
  for (let r = 0; r < REPETICOES; r++) {
    for (const t of TITULOS) {
      tentativas++
      const t0 = Date.now()
      let n = -1
      try {
        n = (await searchComicK(t)).length
      } catch {
        n = -1
      }
      if (n > 0) ok++
      console.log(
        `  ${n >= 0 ? String(n).padStart(2) : " ✗"} resultado(s)  ${((Date.now() - t0) / 1000).toFixed(1)}s  "${t.slice(0, 38)}"`
      )
    }
  }
  console.log(`  → ${ok}/${tentativas} buscas com resultado`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
