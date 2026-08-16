/**
 * Prepara as artes dos 9 atributos para a web: fundo fora, três tamanhos, WebP.
 *
 *   node scripts/preparar-artes-atributos.mjs [--dry-run]
 *
 * ALVO: nenhum — não toca o banco. Lê `Imagens/Atributos/Fundo Branco/<slug>.png`
 * (1254², fora do build) e grava `public/attributes/<slug>-<tamanho>.webp`.
 *
 * Roda UMA vez, à mão, quando a arte muda. Nada disto acontece em runtime: com
 * `output: "standalone"` o otimizador de imagem do Next roda no servidor do Fly, e estas
 * artes são imutáveis — pagar CPU por elas a cada request seria trocar 400 KB de disco por
 * latência permanente.
 *
 * 🔴 **A ENTRADA não está no git** — `Imagens/` está no `.gitignore` e no `.dockerignore`
 * (são 13 MB de PNG que o app nunca serve). Quem sai daqui é a SAÍDA: `public/attributes/`
 * é versionado, e é ele que o deploy leva. Consequência: num clone novo este script FALHA
 * por falta da pasta, e isso é o certo — regenerar exige o original. Se as artes de origem
 * se perderem, o que existe são os WebP de 480px, não a fonte.
 *
 * ## Por que existem três etapas, todas medidas (2026-08-16)
 *
 * 1. **O xadrez de transparência está RASTERIZADO nas nove.** A pasta chama-se "Fundo
 *    Branco" e o fundo não é branco: são dois cinzas neutros alternando (rgb 253 e 246,
 *    2,7% de diferença). Some num pixel isolado e aparece em bloco. Sem limpar, a etapa 2
 *    o transforma em VÉU semitransparente — medido: 26–38% da imagem ficava parcialmente
 *    opaca, pintando um retângulo leitoso sobre o fundo escuro do app.
 *
 * 2. **O fundo sai por preenchimento a partir da BORDA, nunca por limiar global.** Só o
 *    branco ligado ao exterior vira transparente; os brancos INTERNOS ficam — os dentes do
 *    emoji do Humor, os brilhos das gemas da coroa. Um limiar global comeria todos eles.
 *
 * 3. **A curva no alfa (γ=1,8) existe porque o glow era quase branco.** Sobre fundo escuro
 *    ele voltava como névoa cinza em vez de brilho. Elevar a potência dissolve o véu fraco
 *    e preserva o que tem corpo. Conferido sobre quatro fundos (escuro do app, card escuro,
 *    claro e um gradiente saturado).
 *
 * WebP q85 foi escolhido por medição, não por hábito: nas nove artes de 480px dá 366 KB
 * contra 2.217 KB do PNG (6,1×), indistinguível a olho nu ao lado do original. q75 economiza
 * mais 76 KB e começa a marcar banding nos degradês do glow.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ENTRADA = path.join(RAIZ, "Imagens/Atributos/Fundo Branco")
const SAIDA = path.join(RAIZ, "public/attributes")

/**
 * Tamanhos de exibição × 2 (telas retina). O verbete desenha 232px, o índice 76px e a
 * célula da tabela 26px.
 */
const TAMANHOS = [480, 160, 64]
const QUALIDADE = 0.85

/** Cinza neutro e claro = xadrez. Exigir r≈g≈b é o que protege o glow, que é colorido. */
const XADREZ_MIN = 238
const XADREZ_TOLERANCIA_NEUTRA = 8
/** Limiar do preenchimento: aceita o quase-branco da borda antialiasada. */
const FUNDO_MIN = 225
const GAMA_ALFA = 1.8

const seco = process.argv.includes("--dry-run")

// O Chromium do sidecar é o único navegador do repo — e ele codifica WebP com alfa, o que
// dispensa sharp/cwebp/imagemagick só para uma conversão que roda uma vez por ano.
const PLAYWRIGHT = path.join(RAIZ, "services/comix-render/node_modules/playwright/index.mjs")
if (!fs.existsSync(PLAYWRIGHT)) {
  console.error(`FATAL: playwright não encontrado em ${PLAYWRIGHT}`)
  console.error("Rode `npm install` dentro de services/comix-render primeiro.")
  process.exit(1)
}
const { chromium } = await import(PLAYWRIGHT)

if (!fs.existsSync(ENTRADA)) {
  console.error(`FATAL: ${ENTRADA} não existe.`)
  process.exit(1)
}

const arquivos = fs.readdirSync(ENTRADA).filter((f) => f.endsWith(".png")).sort()
if (arquivos.length === 0) {
  console.error(`FATAL: nenhum .png em ${ENTRADA}`)
  process.exit(1)
}

console.log(`${arquivos.length} artes em ${path.relative(RAIZ, ENTRADA)}${seco ? "  (ensaio, nada será gravado)" : ""}\n`)

const navegador = await chromium.launch()
const pagina = await navegador.newPage()
let totalEntrada = 0
let totalSaida = 0

for (const arquivo of arquivos) {
  const slug = arquivo.replace(/\.png$/, "")
  const origem = path.join(ENTRADA, arquivo)
  const bytesEntrada = fs.statSync(origem).size
  totalEntrada += bytesEntrada

  const src = "data:image/png;base64," + fs.readFileSync(origem).toString("base64")
  const resultado = await pagina.evaluate(
    async ({ src, tamanhos, qualidade, xadrezMin, tolerancia, fundoMin, gama }) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const L = img.naturalWidth
      const A = img.naturalHeight
      const tela = document.createElement("canvas")
      tela.width = L
      tela.height = A
      const ctx = tela.getContext("2d")
      ctx.drawImage(img, 0, 0)
      const dados = ctx.getImageData(0, 0, L, A)
      const px = dados.data

      // 1. xadrez → branco puro
      for (let i = 0; i < px.length; i += 4) {
        const max = Math.max(px[i], px[i + 1], px[i + 2])
        const min = Math.min(px[i], px[i + 1], px[i + 2])
        if (min >= xadrezMin && max - min <= tolerancia) {
          px[i] = px[i + 1] = px[i + 2] = 255
        }
      }

      // 2. preenchimento a partir da borda
      const fundo = new Uint8Array(L * A)
      const fila = new Int32Array(L * A)
      let cabeca = 0
      let cauda = 0
      const claro = (i) => Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) >= fundoMin
      const empurra = (i) => {
        if (!fundo[i] && claro(i)) {
          fundo[i] = 1
          fila[cauda++] = i
        }
      }
      for (let x = 0; x < L; x++) {
        empurra(x)
        empurra((A - 1) * L + x)
      }
      for (let y = 0; y < A; y++) {
        empurra(y * L)
        empurra(y * L + L - 1)
      }
      while (cabeca < cauda) {
        const i = fila[cabeca++]
        const x = i % L
        const y = (i / L) | 0
        if (x > 0) empurra(i - 1)
        if (x < L - 1) empurra(i + 1)
        if (y > 0) empurra(i - L)
        if (y < A - 1) empurra(i + L)
      }

      // 3. alfa proporcional ao branco que havia, com a cor desmultiplicada
      let apagados = 0
      for (let i = 0; i < L * A; i++) {
        if (!fundo[i]) continue
        const o = i * 4
        const lum = Math.min(px[o], px[o + 1], px[o + 2])
        const a = (255 - lum) / 255
        if (a < 0.02) {
          px[o + 3] = 0
          apagados++
          continue
        }
        for (let k = 0; k < 3; k++) {
          px[o + k] = Math.max(0, Math.min(255, Math.round((px[o + k] - 255 * (1 - a)) / a)))
        }
        px[o + 3] = Math.round(Math.pow(a, gama) * 255)
      }
      ctx.putImageData(dados, 0, 0)

      const saidas = tamanhos.map((t) => {
        const alvo = document.createElement("canvas")
        alvo.width = t
        alvo.height = t
        const actx = alvo.getContext("2d")
        actx.imageSmoothingQuality = "high"
        actx.drawImage(tela, 0, 0, t, t)
        return alvo.toDataURL("image/webp", qualidade)
      })
      return { pctFundo: Math.round((apagados * 1000) / (L * A)) / 10, saidas, lado: L }
    },
    {
      src,
      tamanhos: TAMANHOS,
      qualidade: QUALIDADE,
      xadrezMin: XADREZ_MIN,
      tolerancia: XADREZ_TOLERANCIA_NEUTRA,
      fundoMin: FUNDO_MIN,
      gama: GAMA_ALFA,
    }
  )

  const partes = []
  TAMANHOS.forEach((tamanho, i) => {
    const url = resultado.saidas[i]
    // O Chromium devolve PNG EM SILÊNCIO quando não sabe codificar o formato pedido.
    // Sem esta checagem, gravaríamos .webp que é PNG — o dobro do peso, e nada acusa.
    if (!url.startsWith("data:image/webp")) {
      throw new Error(`este Chromium não codifica WebP (devolveu ${url.slice(5, 20)})`)
    }
    const bytes = Buffer.from(url.split(",")[1], "base64")
    totalSaida += bytes.length
    partes.push(`${tamanho}px ${String(Math.round(bytes.length / 1024)).padStart(3)} KB`)
    if (!seco) {
      fs.mkdirSync(SAIDA, { recursive: true })
      fs.writeFileSync(path.join(SAIDA, `${slug}-${tamanho}.webp`), bytes)
    }
  })

  console.log(
    `${slug.padEnd(18)} ${resultado.lado}² · fundo apagado ${String(resultado.pctFundo).padStart(5)}%  →  ${partes.join(" · ")}`
  )
}

await navegador.close()

console.log(
  `\n${arquivos.length} artes: ${Math.round(totalEntrada / 1024)} KB → ${Math.round(totalSaida / 1024)} KB em ${arquivos.length * TAMANHOS.length} arquivos (${(totalEntrada / totalSaida).toFixed(1)}× menor)`
)
if (seco) console.log("ensaio — nada foi gravado. Rode sem --dry-run para valer.")
else console.log(`gravado em ${path.relative(RAIZ, SAIDA)}/`)
