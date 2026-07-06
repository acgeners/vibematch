import puppeteer from "puppeteer-core"

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const out = process.argv[2] ?? "/tmp/ranking.png"

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1400, height: 1600, deviceScaleFactor: 2 },
})
try {
  const page = await browser.newPage()
  // seta viewMode=cards ANTES do load (roda a cada navegação, antes dos scripts
  // da página) — evita a corrida de reload que destacava o frame.
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("ranking_view_mode_v1", "cards") } catch { /* noop */ }
  })
  await page.goto("http://localhost:3001/ranking", { waitUntil: "networkidle2", timeout: 60000 })

  // esperar um card com as 3 forças renderizar
  await page.waitForFunction(
    () => [...document.querySelectorAll("*")].some((n) => (n.textContent || "").includes("Chance")),
    { timeout: 20000 },
  )
  await new Promise((r) => setTimeout(r, 600))

  // recortar o 1º card (ancestral do 1º "Chance de gostar" com border rounded-xl)
  const rect = await page.evaluate(() => {
    const label = [...document.querySelectorAll("span")].find(
      (n) => (n.textContent || "").trim() === "Chance",
    )
    if (!label) return null
    let card = label
    for (let i = 0; i < 12 && card.parentElement; i++) {
      card = card.parentElement
      if (typeof card.className === "string" && card.className.includes("rounded-xl")) break
    }
    card.scrollIntoView({ block: "center" })
    const r = card.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await new Promise((r) => setTimeout(r, 300))

  if (rect) {
    const pad = 10
    await page.screenshot({
      path: out,
      clip: { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2 },
    })
    console.log(`card ${Math.round(rect.w)}×${Math.round(rect.h)} → ${out}`)
  } else {
    await page.screenshot({ path: out })
    console.log(`card NÃO encontrado (screenshot cheio) → ${out}`)
  }
} finally {
  await browser.close()
}
