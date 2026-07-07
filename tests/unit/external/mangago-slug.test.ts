import { describe, expect, it } from "vitest"
import { extractMangagoSlug } from "@/lib/external/mangago-slug"

describe("extractMangagoSlug — casos válidos", () => {
  it("slug cru", () => {
    expect(extractMangagoSlug("solo_leveling")).toBe("solo_leveling")
    expect(extractMangagoSlug("kingdom_hearts_358_2_days")).toBe("kingdom_hearts_358_2_days")
  })

  it("normaliza para minúsculas + apara espaços", () => {
    expect(extractMangagoSlug("  SOLO_Leveling  ")).toBe("solo_leveling")
  })

  it("URL absoluta com barra final", () => {
    expect(extractMangagoSlug("https://www.mangago.me/read-manga/solo_leveling/")).toBe("solo_leveling")
  })

  it("URL sem barra final", () => {
    expect(extractMangagoSlug("https://www.mangago.me/read-manga/one_piece")).toBe("one_piece")
  })

  it("URL com querystring e hash", () => {
    expect(extractMangagoSlug("https://www.mangago.me/read-manga/solo_leveling/?ref=x#top")).toBe("solo_leveling")
  })

  it("URL de capítulo → slug é o 1º segmento após /read-manga/", () => {
    expect(extractMangagoSlug("https://www.mangago.me/read-manga/solo_leveling/v2/c10/")).toBe("solo_leveling")
  })

  it("host sem protocolo e subdomínios de mangago.me", () => {
    expect(extractMangagoSlug("www.mangago.me/read-manga/one_piece/")).toBe("one_piece")
    expect(extractMangagoSlug("//m.mangago.me/read-manga/one_piece/")).toBe("one_piece")
    expect(extractMangagoSlug("http://mangago.me/read-manga/one_piece/")).toBe("one_piece")
  })
})

describe("extractMangagoSlug — casos inválidos (→ null)", () => {
  it("vazio / lixo", () => {
    expect(extractMangagoSlug("")).toBeNull()
    expect(extractMangagoSlug("   ")).toBeNull()
    // @ts-expect-error entrada não-string defensiva
    expect(extractMangagoSlug(null)).toBeNull()
    expect(extractMangagoSlug("has spaces")).toBeNull()
    expect(extractMangagoSlug("solo-leveling")).toBeNull() // hífen não é slug do Mangago (usa _)
  })

  it("URL de outro host, mesmo em /read-manga/", () => {
    expect(extractMangagoSlug("https://example.com/read-manga/solo_leveling/")).toBeNull()
    expect(extractMangagoSlug("evil.com/read-manga/solo_leveling/")).toBeNull()
  })

  it("URL do Mangago fora de /read-manga/", () => {
    expect(extractMangagoSlug("https://www.mangago.me/")).toBeNull()
    expect(extractMangagoSlug("https://www.mangago.me/genre/Yaoi/")).toBeNull()
    expect(extractMangagoSlug("https://www.mangago.me/read-manga/")).toBeNull() // sem slug
  })
})
