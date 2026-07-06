import puppeteer from "puppeteer-core"

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const id = process.argv[2]
const out = process.argv[3] ?? "/tmp/bussola.png"
const url = `http://localhost:3001/titles/${id}`

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1280, height: 1600, deviceScaleFactor: 2 },
})
try {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 })

  // clicar na aba "scores" (2ª aba). Radix precisa de eventos de mouse REAIS →
  // usar o click nativo do puppeteer (não o .click() do DOM, que não dispara).
  await page.waitForSelector('[role="tab"]', { timeout: 15000 })
  const tabs = await page.$$('[role="tab"]')
  const clicked = await tabs[1].evaluate((el) => el.textContent?.trim())
  await tabs[1].click()
  await page.waitForFunction(
    () => [...document.querySelectorAll("*")].some((n) => (n.textContent || "").includes("Bússola de leitura")),
    { timeout: 12000 },
  )
  await new Promise((r) => setTimeout(r, 500))

  // localizar o card da Bússola e recortar
  const rect = await page.evaluate(() => {
    const title = [...document.querySelectorAll("div,h3,span,p")]
      .filter((n) => (n.textContent || "").includes("Bússola de leitura"))
      .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0]
    if (!title) return null
    // sobe até o Card específico da Bússola (className="max-w-3xl")
    let card = title
    for (let i = 0; i < 8 && card.parentElement; i++) {
      card = card.parentElement
      if (typeof card.className === "string" && card.className.includes("max-w-3xl")) break
    }
    card.scrollIntoView({ block: "center" })
    const r = card.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  await new Promise((r) => setTimeout(r, 400))

  if (rect) {
    const pad = 12
    await page.screenshot({
      path: out,
      clip: {
        x: Math.max(0, rect.x - pad),
        y: Math.max(0, rect.y - pad),
        width: Math.min(1280, rect.w + pad * 2),
        height: rect.h + pad * 2,
      },
    })
    console.log(`aba clicada: "${clicked}" · card ${Math.round(rect.w)}×${Math.round(rect.h)} → ${out}`)
  } else {
    await page.screenshot({ path: out })
    console.log(`aba clicada: "${clicked}" · card NÃO encontrado (screenshot cheio) → ${out}`)
  }
} finally {
  await browser.close()
}
