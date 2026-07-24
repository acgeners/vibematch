import { describe, it, expect } from "vitest"
import {
  addCover,
  archiveCover,
  restoreCover,
  setPrimaryCover,
} from "@/lib/cover-entries"
import type { CoverLists } from "@/lib/cover-entries"

// Estas transições são compartilhadas por DUAS telas — a grade compacta e o
// diálogo avançado. O risco não é uma delas quebrar: é uma delas passar a
// divergir da outra (arquivar num caminho e não no outro), e aí a capa apagada
// volta no "Atualizar dados" sem que nada acuse erro.
//
// As duas invariantes travadas aqui:
//   1. uma URL NUNCA está nas duas listas ao mesmo tempo;
//   2. havendo capa ativa, EXATAMENTE uma é a primária.

const lists = (): CoverLists => ({
  covers: [
    { url: "https://a/1.jpg", source: "anilist", isPrimary: true },
    { url: "https://a/2.jpg", source: "comix", isPrimary: false },
  ],
  archived: [{ url: "https://a/velha.jpg", source: "kitsu" }],
})

const primaries = (l: CoverLists) => l.covers.filter((c) => c.isPrimary).length
const inBoth = (l: CoverLists) =>
  l.covers.filter((c) => l.archived.some((a) => a.url === c.url)).map((c) => c.url)

describe("arquivar", () => {
  it("tira das ativas e põe nas arquivadas", () => {
    const next = archiveCover(lists(), "https://a/2.jpg")
    expect(next.covers.map((c) => c.url)).toEqual(["https://a/1.jpg"])
    expect(next.archived.map((a) => a.url)).toContain("https://a/2.jpg")
    expect(inBoth(next)).toEqual([])
  })

  it("promove outra primária quando a arquivada era a principal", () => {
    const next = archiveCover(lists(), "https://a/1.jpg")
    // Sem isto a obra fica com capas e NENHUMA principal — os cards caem no
    // fallback silenciosamente.
    expect(primaries(next)).toBe(1)
    expect(next.covers[0].url).toBe("https://a/2.jpg")
  })

  it("arquivar a última capa não inventa uma primária", () => {
    let l = archiveCover(lists(), "https://a/1.jpg")
    l = archiveCover(l, "https://a/2.jpg")
    expect(l.covers).toEqual([])
    expect(l.archived).toHaveLength(3)
  })
})

describe("restaurar", () => {
  it("devolve pra lista de ativas e sai do arquivo", () => {
    const next = restoreCover(lists(), "https://a/velha.jpg")
    expect(next.covers.map((c) => c.url)).toContain("https://a/velha.jpg")
    expect(next.archived).toEqual([])
    expect(inBoth(next)).toEqual([])
    expect(primaries(next)).toBe(1)
  })

  it("restaurar numa obra sem capa nenhuma torna a capa a principal", () => {
    const l: CoverLists = { covers: [], archived: [{ url: "https://a/x.jpg", source: null }] }
    const next = restoreCover(l, "https://a/x.jpg")
    expect(next.covers[0].isPrimary).toBe(true)
    // `source` nulo vira "manual": o CHECK de `work_covers.source` recusa vazio.
    expect(next.covers[0].source).toBe("manual")
  })
})

describe("adicionar", () => {
  it("adicionar uma URL ARQUIVADA a desarquiva", () => {
    const next = addCover(lists(), "https://a/velha.jpg", "manual")
    expect(next.ok).toBe(true)
    if (!next.ok) return
    // Ficar nas duas listas faria o save gravar a capa E bloqueá-la ao mesmo tempo.
    expect(inBoth(next.lists)).toEqual([])
    expect(next.lists.archived).toEqual([])
  })

  it("recusa URL vazia, não-http e duplicada", () => {
    expect(addCover(lists(), "  ", "")).toMatchObject({ ok: false })
    expect(addCover(lists(), "ftp://a/x.jpg", "")).toMatchObject({ ok: false })
    expect(addCover(lists(), "https://a/1.jpg", "")).toMatchObject({ ok: false })
  })

  it("a primeira capa de uma obra vazia entra como principal", () => {
    const next = addCover({ covers: [], archived: [] }, "https://a/x.jpg", "Meu Pinterest")
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.added.isPrimary).toBe(true)
    // Nome digitado à mão é normalizado — o CHECK do banco só aceita [a-z0-9-].
    expect(next.added.source).toBe("meu-pinterest")
  })
})

describe("definir principal", () => {
  it("move a marca sem duplicar", () => {
    const next = setPrimaryCover(lists().covers, "https://a/2.jpg")
    expect(next.filter((c) => c.isPrimary).map((c) => c.url)).toEqual(["https://a/2.jpg"])
  })
})
