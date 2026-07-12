import { test } from "node:test"
import assert from "node:assert/strict"
import { isAllowedUrl, isChallengeHtml } from "../src/contract.js"

const ALLOWED = ["comix.to", "anime-planet.com", "mangago.me", "comick.io", "comick.dev", "comick.app"]

test("isAllowedUrl: aceita os hosts das fontes e seus subdomínios", () => {
  assert.equal(isAllowedUrl("https://comix.to/title/003kd", ALLOWED), true)
  assert.equal(isAllowedUrl("https://www.anime-planet.com/manga/solo-leveling", ALLOWED), true)
  // O ComicK rotaciona entre .dev/.io/.app e usa subdomínio de API — todos precisam passar,
  // senão a fonte some silenciosamente como se estivesse bloqueada.
  assert.equal(isAllowedUrl("https://api.comick.dev/comic/00-solo-leveling", ALLOWED), true)
  assert.equal(isAllowedUrl("https://api.comick.app/comic/x", ALLOWED), true)
})

test("isAllowedUrl: barra SSRF (o sidecar roda na rede interna)", () => {
  // Endpoint de metadata da cloud — o alvo clássico de SSRF.
  assert.equal(isAllowedUrl("http://169.254.169.254/latest/meta-data/", ALLOWED), false)
  assert.equal(isAllowedUrl("http://localhost:8790/render", ALLOWED), false)
  assert.equal(isAllowedUrl("file:///etc/passwd", ALLOWED), false)
  assert.equal(isAllowedUrl("não-é-url", ALLOWED), false)
  // Sufixo tem que casar no LIMITE do rótulo, não como substring solta.
  assert.equal(isAllowedUrl("https://comix.to.evil.com/x", ALLOWED), false)
  assert.equal(isAllowedUrl("https://evilcomick.dev/x", ALLOWED), false)
})

test("isChallengeHtml: separa o interstitial real do script passivo do CF", () => {
  // Página BOA que traz o script de bot-management passivo (jsd) — NÃO é bloqueio.
  const good = `<html><head><title>Jinx</title></head><body>
    <script>a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'</script>
    <script>{"queries":{"[\\"manga\\",\\"detail\\",\\"003kd\\"]":{"hid":"003kd"}}}</script></body></html>`
  assert.equal(isChallengeHtml(good), false)

  // Interstitial de verdade.
  assert.equal(isChallengeHtml("<title>Just a moment...</title>"), true)
  assert.equal(isChallengeHtml("window._cf_chl_opt={cvId:'3'}"), true)
  assert.equal(isChallengeHtml("/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"), true)
})
