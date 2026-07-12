import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isCloudflareChallenge } from "@/lib/external/flaresolverr"

// Fixtures capturadas AO VIVO (2026-07-12), os dois lados do detector:
//  - comix-detail-ok: 200, com o objeto da obra — mas contém o script de
//    bot-management PASSIVO do Cloudflare (challenge-platform/scripts/jsd/main.js).
//  - *-challenge: 403 + `cf-mitigated: challenge` (interstitial de verdade).
// O detector precisa separar os dois: tratar o script passivo como bloqueio fazia
// o app descartar HTML válido e jogar todo o comix no FlareSolverr.
const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "tests/fixtures/cloudflare", `${name}.html`), "utf8")

describe("isCloudflareChallenge", () => {
  it("NÃO trata a página boa do comix como desafio (ela traz o script passivo jsd)", () => {
    const html = fixture("comix-detail-ok")
    // pré-condições da fixture: é a página boa E tem o marcador que enganava o detector
    expect(html).toMatch(/challenge-platform\/scripts\/jsd\/main\.js/i)
    expect(html).toContain('"queries"')

    expect(isCloudflareChallenge(html)).toBe(false)
  })

  it.each(["animeplanet-challenge", "mangago-challenge", "comick-challenge"])(
    "detecta o interstitial real (%s)",
    (name) => {
      expect(isCloudflareChallenge(fixture(name))).toBe(true)
    },
  )

  it("detecta os marcadores canônicos de bloqueio", () => {
    expect(isCloudflareChallenge("<title>Just a moment...</title>")).toBe(true)
    expect(isCloudflareChallenge("window._cf_chl_opt={}")).toBe(true)
    expect(isCloudflareChallenge("cf-mitigated: challenge")).toBe(true)
    expect(isCloudflareChallenge("/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1")).toBe(true)
  })

  it("não acusa HTML comum", () => {
    expect(isCloudflareChallenge("<html><body><h1>Solo Leveling</h1></body></html>")).toBe(false)
  })
})
