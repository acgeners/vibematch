import puppeteer from "puppeteer-core"

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const out = process.argv[2] ?? "/tmp/bussola-view.png"

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1300, height: 1200, deviceScaleFactor: 2 },
})
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("ranking_view_mode_v1", "bussola") } catch { /* noop */ }
  })
  await page.goto("http://localhost:3001/ranking", { waitUntil: "networkidle2", timeout: 60000 })
  await page.waitForFunction(
    () => [...document.querySelectorAll("*")].some((n) => (n.textContent || "").includes("Chance de você gostar")),
    { timeout: 20000 },
  )
  await new Promise((r) => setTimeout(r, 900))

  // marca a raiz do BussolaPlane com um id pra pegar o ElementHandle e usar
  // element.screenshot() (recorta o elemento sozinho, mesmo maior que o viewport).
  const found = await page.evaluate(() => {
    const anchor = [...document.querySelectorAll("span")].find((n) => (n.textContent || "").trim() === "Eixos")
    if (!anchor) return false
    let root = anchor
    for (let i = 0; i < 6 && root.parentElement; i++) {
      root = root.parentElement
      if ((root.textContent || "").includes("Aposta segura") && (root.textContent || "").includes("tamanho =")) break
    }
    root.setAttribute("data-shot", "bussola-root")
    return true
  })

  if (found) {
    const handle = await page.$('[data-shot="bussola-root"]')
    const dots = await page.evaluate(() => document.querySelectorAll('[data-shot="bussola-root"] a[href^="/catalog/"]').length)
    await handle.screenshot({ path: out })
    console.log(`plano capturado · ${dots} pontos (links) no DOM → ${out}`)
  } else {
    await page.screenshot({ path: out })
    console.log(`raiz NÃO encontrada (screenshot cheio) → ${out}`)
  }
} finally {
  await browser.close()
}
