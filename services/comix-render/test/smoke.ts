// Smoke ao vivo (opt-in, FORA do CI): resolve a obra conhecida contra o comix.to
// REAL e exige o hid `3ezr0` no topo. Roda `npm run smoke` pra checar rápido se o
// Comix mudou algo (rota, param sort=relevance:desc, shape do payload).
import { resolveWork } from "../src/resolve.js"
import { closeBrowser } from "../src/browser.js"

const KNOWN_TITLE = "I Adopted the Protagonist, and the Genre Changed"
const KNOWN_HID = "3ezr0"

async function main(): Promise<void> {
  const title = process.argv[2] ?? KNOWN_TITLE
  const res = await resolveWork({ title }, 12, "smoke")
  console.log(JSON.stringify(res, null, 2))
  await closeBrowser()

  if (!res.ok) {
    console.error(`SMOKE FAIL: ${res.error}`)
    process.exit(1)
  }
  if (title === KNOWN_TITLE && !res.items.some((i) => i.hid === KNOWN_HID)) {
    console.error(`SMOKE FAIL: hid ${KNOWN_HID} não veio entre os ${res.items.length} candidatos`)
    process.exit(1)
  }
  console.log(`SMOKE OK: ${res.items.length} itens; rank#1 = ${res.items[0]?.hid} (${res.items[0]?.title})`)
}

main().catch((err) => {
  console.error("SMOKE ERROR:", err)
  process.exit(1)
})
